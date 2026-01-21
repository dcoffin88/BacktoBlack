
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import { Database } from 'sqlite3';
import { Asset, Expense, IncomeSource, Liability, UserSettings, ExtraPayment } from '../types';
import { ReportGenerator } from './reports/reportGenerator';
import { generatePaychecks } from '../utils/paycheckLogic';

// --- Types ---
interface UserRow {
    id: number;
    email: string;
    household_id?: string | null;
}

// --- Helpers ---

// Duplicated from server.ts to avoid circular deps.
const normalizeIncomeSources = (
    sources: IncomeSource[] = [],
    userId: number,
    partnerId?: number | null,
    fallbackOwnerId?: number | null
) => {
    return sources.map((source) => {
        const existingOwnerId = (source as any).ownerId as number | undefined;
        const derivedOwnerId =
            existingOwnerId
            ?? ((source.isPartner && partnerId) ? partnerId : undefined)
            ?? (fallbackOwnerId ?? userId);
        const isPartner = derivedOwnerId !== userId;

        return { ...source, ownerId: derivedOwnerId, isPartner };
    });
};

const dbAllAsync = (db: Database, sql: string, params: any[] = []) =>
    new Promise<any[]>((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });

const dbGetAsync = (db: Database, sql: string, params: any[] = []) =>
    new Promise<any>((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

const parseLocalDate = (value?: string | null) => {
    if (!value) return null;
    const d = value.includes('T') ? new Date(value) : new Date(`${value}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
};

const toLocalDateString = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .split('T')[0];

const addDays = (date: Date, days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
};

const getDueDayForMonth = (year: number, monthIndex: number, dueDay: number) => {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    if (dueDay === 30) return lastDay;
    return Math.min(Math.max(1, dueDay), lastDay);
};

const getPaymentAnchorDate = (liability: Liability) => {
    const parsed = parseLocalDate(liability.nextDueDate);
    if (parsed) {
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    }
    const start = parseLocalDate(liability.startDate);
    const base = start || new Date();
    const dueDay = getDueDayForMonth(base.getFullYear(), base.getMonth(), liability.dueDate || 1);
    const anchor = new Date(base.getFullYear(), base.getMonth(), dueDay);
    anchor.setHours(0, 0, 0, 0);
    return anchor;
};

const getPeriodIndexFromDate = (liability: Liability, checkDate?: string | null) => {
    const target = parseLocalDate(checkDate);
    if (!target) return null;
    target.setHours(0, 0, 0, 0);
    let anchor = getPaymentAnchorDate(liability);
    const freq = liability.paymentFrequency || 'MONTHLY';

    if (freq === 'WEEKLY' || freq === 'BI_WEEKLY') {
        const intervalDays = freq === 'WEEKLY' ? 7 : 14;
        const start = parseLocalDate(liability.startDate);
        if (start && anchor < start) {
            let guard = 0;
            while (anchor < start && guard < 500) {
                anchor = addDays(anchor, intervalDays);
                guard++;
            }
        }
        const previousAnchor = addDays(anchor, -intervalDays);
        if (target >= previousAnchor && target < anchor) {
            return target.getTime() === previousAnchor.getTime() ? 0 : 1;
        }
        let period = 1;
        let cursor = new Date(anchor);
        let guard = 0;
        while (cursor < target && guard < 500) {
            cursor = addDays(cursor, intervalDays);
            period += 1;
            guard++;
        }
        while (cursor > target && guard < 1000) {
            cursor = addDays(cursor, -intervalDays);
            period -= 1;
            guard++;
        }
        return period;
    }

    const start = parseLocalDate(liability.startDate);
    if (start && anchor < start) {
        let guard = 0;
        while (anchor < start && guard < 120) {
            anchor = new Date(anchor.getFullYear(), anchor.getMonth() + 1, anchor.getDate());
            guard++;
        }
    }
    const previousAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, anchor.getDate());
    if (target >= previousAnchor && target < anchor) {
        return target.getTime() === previousAnchor.getTime() ? 0 : 1;
    }
    let period = 1;
    let cursor = new Date(anchor);
    let guard = 0;
    while (cursor < target && guard < 1200) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
        period += 1;
        guard++;
    }
    while (cursor > target && guard < 2400) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, cursor.getDate());
        period -= 1;
        guard++;
    }
    return period;
};

const getBalanceFromSchedule = (
    schedule: { timeline: any[] },
    liability?: Liability
) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let latestDate: Date | null = null;
    let latestBalance: number | null = null;

    schedule.timeline.forEach((row) => {
        const parsed = parseLocalDate(row.actualDate ?? null);
        if (!parsed || parsed > today) return;
        if (!latestDate || parsed > latestDate) {
            latestDate = parsed;
            latestBalance = row.remainingBalance;
        }
    });

    if (latestBalance !== null) return latestBalance;

    const historicalRows = schedule.timeline.filter((row) => {
        if (!(row.isHistorical || row.month <= 0)) return false;
        const parsed = parseLocalDate(row.actualDate ?? null);
        return !parsed || parsed <= today;
    });
    if (!historicalRows.length) {
        if (!liability) return null;
        const startDate = parseLocalDate(liability.startDate ?? null);
        const nextDueDate = parseLocalDate(liability.nextDueDate ?? null);
        const anchor = startDate || nextDueDate;
        if (!anchor) return null;
        anchor.setHours(0, 0, 0, 0);

        const firstRow = schedule.timeline.reduce<any | null>(
            (acc, cur) => {
                if (cur.month <= 0) return acc;
                if (!acc || cur.month < acc.month) return cur;
                return acc;
            },
            null
        );

        if (anchor > today) {
            if (!firstRow) {
                if (Number.isFinite(liability.startingBalance ?? NaN)) {
                    return liability.startingBalance as number;
                }
                return null;
            }
            const inferredStartingBalance =
                firstRow.remainingBalance + firstRow.principal - (firstRow.fees || 0);
            if (Number.isFinite(inferredStartingBalance) && inferredStartingBalance > 0) {
                return inferredStartingBalance;
            }
            if (Number.isFinite(liability.startingBalance ?? NaN)) {
                return liability.startingBalance as number;
            }
            return null;
        }

        // Liability is active; use the current period from the schedule even if actualDate is absent.
        const period = getPeriodIndexFromDate(liability, toLocalDateString(today));
        if (period !== null && period !== undefined) {
            const matchingRow = schedule.timeline.find((row) => row.month === period);
            if (matchingRow) return matchingRow.remainingBalance;
        }

        return null; // Fallback
    }

    const latestHistorical = historicalRows.reduce((acc, cur) =>
        cur.month > acc.month ? cur : acc
    );
    return latestHistorical.remainingBalance;
};

const fetchUserData = async (db: Database, user: UserRow) => {
    const scopeId = user.household_id || user.id;

    // 1. Settings
    let settings: UserSettings | null = null;
    let partnerId: number | null = null;

    // Fetch Settings & Partner ID logic similar to server.ts
    // We try to find settings for the household first
    const settingsRow = await dbGetAsync(
        db,
        "SELECT content, user_id FROM settings WHERE household_id = ? OR id = 'user_settings' ORDER BY household_id IS NULL LIMIT 1",
        [scopeId]
    );

    if (!settingsRow && !user.household_id) return null; // No settings found

    // Resolve Partner ID if household exists
    if (user.household_id) {
        const partnerRow = await dbGetAsync(db, 'SELECT id FROM users WHERE household_id = ? AND id != ? LIMIT 1', [user.household_id, user.id]);
        if (partnerRow) partnerId = partnerRow.id;
    }

    settings = settingsRow ? JSON.parse(settingsRow.content) : {};

    // Normalize settings
    if (settings) {
        // Defaults
        if (user.household_id) {
            settings.enablePartner = true;
            settings.householdId = user.household_id;
            settings.partnerLinked = true;
        }

        const rowOwnerId = settingsRow ? settingsRow.user_id : null;
        settings.incomeSources = normalizeIncomeSources(settings.incomeSources || [], user.id, partnerId, rowOwnerId);
    }

    if (!settings || !settings.emailReports) return null; // Abort if reports invalid or disabled

    // Check SMTP config
    if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
        console.warn(`[Scheduler] User ${user.email} has email reports enabled but missing SMTP config.`);
        return null;
    }

    // 2. Fetch Data
    const liabilitiesRows = await dbAllAsync(db, 'SELECT content FROM liabilities WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id]);
    const expensesRows = await dbAllAsync(db, 'SELECT content FROM expenses WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id]);
    const assetsRows = await dbAllAsync(db, 'SELECT content FROM assets WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id]);
    const incomesRows = await dbAllAsync(db, 'SELECT content FROM incomes WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id]);
    const extraPaymentsRows = await dbAllAsync(db, 'SELECT * FROM budget_extra_payments WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)', [scopeId, user.id]);

    const liabilitiesRaw = liabilitiesRows.map(r => {
        try { return JSON.parse(r.content) as Liability; } catch { return null; }
    }).filter((l): l is Liability => !!l);

    // Patch balances for liabilities
    const liabilities = await Promise.all(liabilitiesRaw.map(async (l) => {
        const summaryRow = await dbGetAsync(db, 'SELECT is_infinite FROM liability_amortization_summary WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)', [l.id, scopeId, user.id]);
        if (!summaryRow) return { ...l, balance: l.balance || l.startingBalance || 0 };

        const rows = await dbAllAsync(db, 'SELECT period, remaining_balance, actual_date, is_historical, principal, fees FROM liability_amortization WHERE liability_id = ? AND (household_id = ? OR user_id = ? OR household_id IS NULL)', [l.id, scopeId, user.id]);
        const timeline = rows.map(r => ({
            month: r.period,
            remainingBalance: r.remaining_balance,
            actualDate: r.actual_date,
            isHistorical: r.is_historical,
            principal: r.principal,
            fees: r.fees
        }));

        const derivedBalance = getBalanceFromSchedule({ timeline }, l);
        return {
            ...l,
            balance: derivedBalance !== null ? derivedBalance : (l.startingBalance || 0)
        };
    }));

    const expenses = expensesRows.map(r => {
        try { return JSON.parse(r.content) as Expense; } catch { return null; }
    }).filter((e): e is Expense => !!e);

    const assets = assetsRows.map(r => {
        try { return JSON.parse(r.content) as Asset; } catch { return null; }
    }).filter((a): a is Asset => !!a);

    // Re-fetch incomes from table to ensure we have all of them, normalizing carefully
    const incomesRaw = incomesRows.map(r => {
        try { return JSON.parse(r.content) as IncomeSource; } catch { return null; }
    }).filter((i): i is IncomeSource => !!i);

    // Merge settings incomes with table incomes? 
    // The app seems to source incomes from `incomes` table primarily now in server.ts GET /api/incomes.
    // settings.incomeSources might be legacy or syncd. Let's use the table ones + `normalize`.
    const incomes = normalizeIncomeSources(incomesRaw, user.id, partnerId);

    const extraPayments: ExtraPayment[] = extraPaymentsRows.map(row => ({
        id: row.id,
        liabilityId: row.liability_id,
        amount: row.amount,
        checkDate: row.check_date || null,
        isChecked: row.is_checked !== 0
    }));

    return {
        user,
        settings,
        data: {
            liabilities,
            expenses,
            incomes,
            assets,
            settings,
            extraPayments
        }
    };
};

const sendEmail = async (settings: UserSettings, recipientsStr: string | undefined, subject: string, html: string) => {
    try {
        const transporter = nodemailer.createTransport({
            host: settings.smtpHost,
            port: Number(settings.smtpPort),
            secure: settings.smtpSecure || false,
            auth: {
                user: settings.smtpUser,
                pass: settings.smtpPass,
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        await transporter.verify();

        // Use custom recipients or default to account email
        const recipients = recipientsStr && recipientsStr.trim() !== ''
            ? recipientsStr
            : settings.email;

        // If recipients has comma, it handles it automatically
        await transporter.sendMail({
            from: `"BacktoBlack" <${settings.smtpUser}>`,
            to: recipients,
            subject: subject,
            html: html,
        });

        console.log(`[Scheduler] Email sent to ${recipients}: ${subject}`);
        return true;
    } catch (error: any) {
        console.error(`[Scheduler] Failed to send email to ${settings.email}:`, error.message);
        return false;
    }
};


// --- Jobs ---

const runMonthlyBudgetJob = async (db: Database) => {
    console.log('[Scheduler] Running Monthly Budget Job...');
    const users = await dbAllAsync(db, 'SELECT id, email, household_id FROM users');

    for (const user of users) {
        try {
            const context = await fetchUserData(db, user);
            if (!context) continue; // Skip if no settings or disabled

            const { settings, data } = context;

            // Granular Check
            if (settings.enableMonthlyReport === false) continue; // Skip if specifically disabled

            const today = new Date();

            // Generate Report
            const html = await ReportGenerator.generateBudgetSummary(data, today);

            if (html) {
                await sendEmail(settings, settings.monthlyReportRecipients, `Monthly Budget - ${today.toLocaleString('default', { month: 'long' })}`, html);
            }
        } catch (err) {
            console.error(`[Scheduler] Error processing user ${user.id} for Monthly Budget:`, err);
        }
    }
};

const runIncomeTriggerJob = async (db: Database) => {
    console.log('[Scheduler] Running Income Trigger Job...');
    const users = await dbAllAsync(db, 'SELECT id, email, household_id FROM users');

    for (const user of users) {
        try {
            const context = await fetchUserData(db, user);
            if (!context) continue;

            const { settings, data } = context;

            // Granular Check
            if (settings.enableTransferReport === false) continue;

            const today = new Date();

            // Generate Report
            const html = await ReportGenerator.generateTransferReport(data, today);

            if (html) {
                await sendEmail(settings, settings.transferReportRecipients, `Money on the Move - ${today.toLocaleDateString()}`, html);
            }
        } catch (err) {
            console.error(`[Scheduler] Error processing user ${user.id} for Income Trigger:`, err);
        }
    }
};


export const startScheduler = (db: Database) => {
    console.log('[Scheduler] Starting Automated Report Scheduler...');

    // 1. Monthly Budget: 8:00 AM on the 1st of every month
    cron.schedule('0 8 1 * *', () => {
        runMonthlyBudgetJob(db);
    });

    // 2. Daily Income Check: 8:00 AM every day
    cron.schedule('0 8 * * *', () => {
        runIncomeTriggerJob(db);
    });

    // Debug: Run immediately on server start if needed (commented out)
    // runMonthlyBudgetJob(db);
    // runIncomeTriggerJob(db);
};

export const triggerMonthlyReportForUser = async (db: Database, userId: number) => {
    const users = await dbAllAsync(db, 'SELECT id, email, household_id FROM users WHERE id = ?', [userId]);
    const user = users[0];
    if (!user) return { success: false, error: 'User not found' };

    const context = await fetchUserData(db, user);
    if (!context) return { success: false, error: 'Reports disabled or SMTP not configured' };

    const { settings, data } = context;
    const today = new Date();
    const html = await ReportGenerator.generateBudgetSummary(data, today);

    if (html) {
        const sent = await sendEmail(settings, settings.monthlyReportRecipients, `Monthly Budget - ${today.toLocaleString('default', { month: 'long' })}`, html);
        return { success: sent, error: sent ? undefined : 'Failed to send email' };
    }
    return { success: false, error: 'Failed to generate report' };
};

export const triggerTransferReportForUser = async (db: Database, userId: number, dateString?: string) => {
    const users = await dbAllAsync(db, 'SELECT id, email, household_id FROM users WHERE id = ?', [userId]);
    const user = users[0];
    if (!user) return { success: false, error: 'User not found' };

    const context = await fetchUserData(db, user);
    if (!context) return { success: false, error: 'Reports disabled or SMTP not configured' };

    const { settings, data } = context;
    const reportDate = dateString ? parseLocalDate(dateString) : new Date();
    if (!reportDate) return { success: false, error: 'Invalid date provided' };

    const html = await ReportGenerator.generateTransferReport(data, reportDate);

    if (html) {
        const sent = await sendEmail(settings, settings.transferReportRecipients, `Money on the Move - ${reportDate.toLocaleDateString()}`, html);
        return { success: sent, error: sent ? undefined : 'Failed to send email' };
    }
    return { success: true, message: `No transfers for ${reportDate.toLocaleDateString()}, no email sent.` };
};

export const getAvailableCheckDates = async (db: Database, userId: number) => {
    const users = await dbAllAsync(db, 'SELECT id, email, household_id FROM users WHERE id = ?', [userId]);
    const user = users[0];
    if (!user) return [];

    const context = await fetchUserData(db, user);
    if (!context) return [];

    const { settings, data } = context;
    const { incomes } = data;

    // Window: 1 week ago to 3 months ahead to give plenty of selection
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const end = new Date();
    end.setMonth(end.getMonth() + 3);

    const budgetStartDate = settings.startDate ? parseLocalDate(settings.startDate) : null;
    const paychecks = generatePaychecks(incomes, start, end, { budgetStartDate });

    // Deduplicate dates
    const datesSet = new Set<string>();
    paychecks.forEach(p => datesSet.add(toLocalDateString(p.date)));

    return Array.from(datesSet).sort();
};
