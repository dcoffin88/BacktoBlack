
import { Asset, Expense, IncomeSource, Liability, UserSettings, PaycheckOccurrence, ExtraPayment } from '../../types';
import { calculateIndividualAmortization, getAnnualizedIncomeAmount, getMinPayment } from '../liabilityAlgorithms';
import { generatePaychecks, getPerCheckExpenseAmount, getPerCheckLiabilityAmount } from '../../utils/paycheckLogic';

// --- Types ---
interface ReportData {
    liabilities: Liability[];
    expenses: Expense[];
    incomes: IncomeSource[];
    assets: Asset[];
    settings: UserSettings;
    extraPayments: ExtraPayment[];
}

// --- Helpers ---
const formatCurrency = (value: number, symbol: string = '$') => {
    return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const getPeriodRange = (year: number, month: number) => {
    return {
        start: new Date(year, month - 1, 1),
        end: new Date(year, month, 0),
    };
};

// --- Monthly Budget Report Logic ---

const generateBudgetSummary = async (data: ReportData, date: Date) => {
    const { liabilities, expenses, incomes, assets, settings, extraPayments } = data;
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const { start, end } = getPeriodRange(year, month);
    const currencySymbol = settings.currencySymbol || '$';

    // 1. Calculate Period Income
    const budgetStartDate = settings.startDate ? new Date(settings.startDate) : null;
    const paychecks = generatePaychecks(incomes, start, end, { budgetStartDate });
    const paychecksInPeriod = paychecks.filter(p => p.date >= start && p.date <= end);
    const periodIncomeTotal = paychecksInPeriod.reduce((sum, p) => sum + p.source.amount, 0);

    // 2. Prepare Amortization Schedules needed for balance checks (approximated for server-side mostly to get current balances effectively)
    // Ideally we fetch real amortization from DB, but for this summary report we might just rely on current balances
    // or quickly recalc if needed. For simplicity and speed in this report, let's use current `liability.balance`.
    // If exact projected balance is needed, we'd run `calculateIndividualAmortization`.
    // Let's run it to be accurate with "Minimums" calculation which might depend on schedule context.
    const scheduleBalanceById: Record<string, number> = {};
    const liabilityWithMins = liabilities.map(l => {
        // Quick calc for "Plan" context - we perform a lightweight simulation or simple min calc
        // Since this is a monthly report, user likely wants to see "What is due this month".
        // We will stick to the logic: Min Payment + Extras.

        const currentBalance = l.balance || 0;
        const interestRate = l.interestRate || 0;
        const annualFee = l.annualFee || 0;
        const monthlyInterest = currentBalance * (interestRate / 100 / 12);
        const estFee = l.isFeeMonthly ? annualFee / 12 : 0;

        // Use server-side algo
        const plannedPayment = getMinPayment(l, currentBalance, monthlyInterest, estFee);

        return {
            ...l,
            plannedPayment, // This puts it in the format expected by getPerCheckLiabilityAmount
            scheduledFrequency: l.paymentFrequency || 'MONTHLY'
        };
    });

    // 3. User Split Ratio
    const budgetedIncomes = incomes.filter(i => i.includeInPlanner !== false);
    let userSplitRatio = 1;
    if (settings.enablePartner) {
        if (settings.expenseSplitMethod === 'PERCENTAGE') {
            userSplitRatio = (settings.userSplitPercentage || 50) / 100;
        } else if (settings.expenseSplitMethod === 'INCOME') {
            const mine = budgetedIncomes.filter(i => !i.isPartner && !i.excludeFromSplitting).reduce((sum, s) => sum + getAnnualizedIncomeAmount(s), 0);
            const partner = budgetedIncomes.filter(i => i.isPartner && !i.excludeFromSplitting).reduce((sum, s) => sum + getAnnualizedIncomeAmount(s), 0);
            const total = mine + partner;
            userSplitRatio = total <= 0 ? 0.5 : mine / total;
        } else {
            userSplitRatio = 0.5;
        }
    }

    // 4. Calculate Period Expenses & Liabilities
    // Helper to get month paychecks for a specific date (needed for per-check logic)
    const getMonthPaychecksFor = (d: Date) => {
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        return paychecks.filter(p => `${p.date.getFullYear()}-${p.date.getMonth()}` === key);
    };

    const getExpenseTotal = (expense: Expense) => {
        return paychecksInPeriod.reduce((sum, p) => {
            const monthPaychecks = getMonthPaychecksFor(p.date);
            return sum + getPerCheckExpenseAmount(expense, p, monthPaychecks, budgetedIncomes, userSplitRatio);
        }, 0);
    };

    const getLiabilityTotal = (liability: typeof liabilityWithMins[number]) => {
        return paychecksInPeriod.reduce((sum, p) => {
            const monthPaychecks = getMonthPaychecksFor(p.date);
            return sum + getPerCheckLiabilityAmount(liability, p, monthPaychecks, budgetedIncomes, extraPayments, userSplitRatio, { includeUnchecked: false });
        }, 0);
    };

    const periodExpenseTotal = expenses.reduce((sum, e) => sum + getExpenseTotal(e), 0);
    const periodLiabilityTotal = liabilityWithMins.reduce((sum, l) => sum + getLiabilityTotal(l), 0);
    const monthlyBudget = settings.monthlyBudget || 0;

    const periodCashOut = periodExpenseTotal + periodLiabilityTotal + monthlyBudget;
    const periodNet = periodIncomeTotal - periodCashOut;

    // 5. Generate Content
    // Group Expenses
    const expenseGroups = new Map<string, number>();
    expenses.forEach(e => {
        const amt = getExpenseTotal(e);
        if (amt > 0) {
            const cat = e.category || 'Uncategorized';
            expenseGroups.set(cat, (expenseGroups.get(cat) || 0) + amt);
        }
    });

    // Group Liabilities
    const liabilityGroups = new Map<string, number>();
    liabilityWithMins.forEach(l => {
        const amt = getLiabilityTotal(l);
        if (amt > 0) {
            const cat = l.category || 'Uncategorized';
            liabilityGroups.set(cat, (liabilityGroups.get(cat) || 0) + amt);
        }
    });

    return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #334155;">
        <div style="background-color: #f8fafc; padding: 24px; border-radius: 12px; margin-bottom: 24px;">
            <h1 style="margin: 0 0 8px 0; color: #0f172a; font-size: 24px;">Monthly Budget Overview</h1>
            <p style="margin: 0; color: #64748b;">${date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        </div>

        <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <!-- Income -->
            <div style="padding: 16px; border-bottom: 1px solid #e2e8f0;">
                <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b;">Income</p>
                <div style="display: flex; align-items: baseline;">
                   <span style="font-weight: 500;">Total Income</span>
                   <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #e2e8f0; height: 12px;"></div>
                   <span style="font-weight: 600; color: #16a34a;">+${formatCurrency(periodIncomeTotal, currencySymbol)}</span>
                </div>
            </div>

            <!-- Expenses -->
            <div style="padding: 16px; border-bottom: 1px solid #e2e8f0;">
                <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b;">Expenses</p>
                ${expenseGroups.size === 0 ? '<p style="margin:0; font-style:italic; color:#94a3b8; font-size:14px;">No expenses</p>' : ''}
                ${Array.from(expenseGroups.entries()).map(([cat, total]) => `
                    <div style="display: flex; align-items: baseline; margin-bottom: 4px;">
                        <span style="color: #475569;">${cat}</span>
                        <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #e2e8f0; height: 12px;"></div>
                        <span style="font-weight: 500;">-${formatCurrency(total, currencySymbol)}</span>
                    </div>
                `).join('')}
                 <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
                    <span style="font-weight: 500;">Total Expenses</span>
                    <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #e2e8f0; height: 12px;"></div>
                    <span style="font-weight: 600;">-${formatCurrency(periodExpenseTotal, currencySymbol)}</span>
                 </div>
            </div>

             <!-- Liabilities -->
            <div style="padding: 16px; border-bottom: 1px solid #e2e8f0;">
                <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b;">Liability Minimums</p>
                 ${liabilityGroups.size === 0 ? '<p style="margin:0; font-style:italic; color:#94a3b8; font-size:14px;">No liabilities</p>' : ''}
                ${Array.from(liabilityGroups.entries()).map(([cat, total]) => `
                    <div style="display: flex; align-items: baseline; margin-bottom: 4px;">
                        <span style="color: #475569;">${cat}</span>
                        <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #e2e8f0; height: 12px;"></div>
                        <span style="font-weight: 500;">-${formatCurrency(total, currencySymbol)}</span>
                    </div>
                `).join('')}
                 <div style="display: flex; align-items: baseline; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
                    <span style="font-weight: 500;">Total Liabilities</span>
                    <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #e2e8f0; height: 12px;"></div>
                    <span style="font-weight: 600;">-${formatCurrency(periodLiabilityTotal, currencySymbol)}</span>
                 </div>
            </div>
            
            <!-- Summary -->
             <div style="padding: 16px; background-color: #f8fafc;">
                 <div style="display: flex; align-items: baseline; font-size: 18px; margin-top: 12px; padding-top: 12px;">
                    <span style="font-weight: 700;">Remaining</span>
                    <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #e2e8f0; height: 12px;"></div>
                    <span style="font-weight: 700; color: ${periodNet >= 0 ? '#4f46e5' : '#dc2626'};">${formatCurrency(periodNet, currencySymbol)}</span>
                 </div>
             </div>
        </div>
        
        <p style="text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8;">
            Generated by BacktoBlack on ${new Date().toLocaleString()}
        </p>
    </div>
    `;
};


// --- Transfer Report Logic ---

const generateTransferReport = async (data: ReportData, date: Date) => {
    const { liabilities, expenses, incomes, settings, extraPayments } = data;
    const currencySymbol = settings.currencySymbol || '$';
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; // approximate comparison key

    // 1. Identify Today's Paychecks
    // We need to generate paychecks for a window around today to catch it properly ensuring date strings match
    const { start, end } = getPeriodRange(date.getFullYear(), date.getMonth() + 1);
    const budgetStartDate = settings.startDate ? new Date(settings.startDate) : null;

    const paychecks = generatePaychecks(incomes, start, end, { budgetStartDate });

    // Filter for ONLY checks happening exactly "today" (passed in date)
    // Use string comparison to avoid time drift issues
    const targetDateString = date.toLocaleDateString();
    const todaysPaychecks = paychecks.filter(p => p.date.toLocaleDateString() === targetDateString);

    if (todaysPaychecks.length === 0) return null; // No transfers to report if no paychecks

    // 2. Calculate Transfers for these paychecks
    // We will aggregate transfers across all paychecks triggering today (usually just 1, but could be multiple)
    // 2. Calculate Transfers and Manual Payments for these paychecks
    const transferGroups = new Map<string, { total: number; items: { name: string; amount: number; type: string }[] }>();
    const manualPayments: { name: string; subtitle?: string; amount: number; type: string; account?: string }[] = [];

    // Prepare Split Ratio
    const budgetedIncomes = incomes.filter(i => i.includeInPlanner !== false);
    let userSplitRatio = 0.5; // Default logic duplicated from above... 
    if (settings.enablePartner) {
        if (settings.expenseSplitMethod === 'PERCENTAGE') {
            userSplitRatio = (settings.userSplitPercentage || 50) / 100;
        } else if (settings.expenseSplitMethod === 'INCOME') {
            const mine = budgetedIncomes.filter(i => !i.isPartner && !i.excludeFromSplitting).reduce((sum, s) => sum + getAnnualizedIncomeAmount(s), 0);
            const partner = budgetedIncomes.filter(i => i.isPartner && !i.excludeFromSplitting).reduce((sum, s) => sum + getAnnualizedIncomeAmount(s), 0);
            const total = mine + partner;
            userSplitRatio = total <= 0 ? 0.5 : mine / total;
        }
    }

    // Helper functions need to sum across "Today's Checks"
    const getMonthPaychecksFor = (d: Date) => {
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        return paychecks.filter(p => `${p.date.getFullYear()}-${p.date.getMonth()}` === key);
    };

    // Iterate Logic
    todaysPaychecks.forEach(currentPaycheck => {
        const monthPaychecks = getMonthPaychecksFor(currentPaycheck.date);

        // Expenses
        expenses.forEach(e => {
            const amt = getPerCheckExpenseAmount(e, currentPaycheck, monthPaychecks, budgetedIncomes, userSplitRatio);
            if (amt > 0) {
                // If manual payment required, track it
                if (e.manualPaymentRequired) {
                    manualPayments.push({ name: e.name, subtitle: e.subtitle, amount: amt, type: 'Expense', account: e.transferAccount });
                }

                // If transfer account specified, group it
                if (e.transferAccount) {
                    const group = transferGroups.get(e.transferAccount) || { total: 0, items: [] };
                    group.total += amt;
                    group.items.push({ name: e.name, amount: amt, type: 'Expense' });
                    transferGroups.set(e.transferAccount, group);
                }
            }
        });

        // Liabilities
        liabilities.forEach(l => {
            // Must prepare the "Planned Payment" liability object
            const currentBalance = l.balance || 0;
            const interestRate = l.interestRate || 0;
            const annualFee = l.annualFee || 0;
            const monthlyInterest = currentBalance * (interestRate / 100 / 12);
            const estFee = l.isFeeMonthly ? annualFee / 12 : 0;
            const plannedPayment = getMinPayment(l, currentBalance, monthlyInterest, estFee);
            const liabilityWithMin = { ...l, plannedPayment, scheduledFrequency: l.paymentFrequency || 'MONTHLY' };

            const amt = getPerCheckLiabilityAmount(liabilityWithMin, currentPaycheck, monthPaychecks, budgetedIncomes, extraPayments, userSplitRatio, { includeUnchecked: false });
            if (amt > 0) {
                // If manual payment required, track it
                if (l.manualPaymentRequired) {
                    manualPayments.push({ name: l.name, subtitle: l.subtitle, amount: amt, type: 'Liability', account: l.transferAccount });
                }

                // If transfer account specified, group it
                if (l.transferAccount) {
                    const group = transferGroups.get(l.transferAccount) || { total: 0, items: [] };
                    group.total += amt;
                    group.items.push({ name: l.name, amount: amt, type: 'Liability' });
                    transferGroups.set(l.transferAccount, group);
                }
            }
        });
    });

    if (transferGroups.size === 0 && manualPayments.length === 0) return null;

    return `
     <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #334155;">
        <div style="background-color: #f8fafc; padding: 24px; border-radius: 12px; margin-bottom: 24px;">
            <h1 style="margin: 0 0 8px 0; color: #0f172a; font-size: 24px;">Money on the Move</h1>
             <p style="margin: 0; color: #64748b;">
                ${todaysPaychecks.map(p => `${p.source.name}`).join(' & ')} • ${date.toLocaleDateString()}
             </p>
        </div>

        ${transferGroups.size > 0 ? `
        <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
            <div style="padding: 12px 16px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #4338ca; text-transform: uppercase; letter-spacing: 0.025em;">Automated Transfers</h3>
            </div>
            ${Array.from(transferGroups.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([account, data]) => `
                <div style="border-bottom: 1px solid #e2e8f0; padding: 16px; display: flex; align-items: baseline;">
                     <span style="font-weight: 600; color: #334155;">To: ${account}</span>
                     <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #cbd5e1; height: 14px;"></div>
                     <span style="font-weight: 700; color: #0f172a;">${formatCurrency(data.total, currencySymbol)}</span>
                </div>
            `).join('')}
        </div>
        ` : ''}

        ${manualPayments.length > 0 ? `
        <div style="background-color: #ffffff; border: 1px solid #fecaca; border-radius: 12px; overflow: hidden;">
            <div style="padding: 12px 16px; background-color: #fef2f2; border-bottom: 1px solid #fecaca;">
                <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.025em;">⚠️ Manual Payments Required</h3>
            </div>
            <div style="padding: 12px 16px;">
                ${manualPayments.slice().sort((a, b) => a.name.localeCompare(b.name)).map(item => `
                    <div style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">
                        <div style="display: flex; align-items: baseline; margin-bottom: 2px;">
                            <span style="font-weight: 600; color: #0f172a;">${item.name}</span>
                            <div style="flex-grow: 1; margin: 0 8px; border-bottom: 1px dotted #fecaca; height: 12px;"></div>
                            <span style="font-weight: 700; color: #b91c1c;">${formatCurrency(item.amount, currencySymbol)}</span>
                        </div>
                        <div style="font-size: 12px; color: #64748b;">
                            ${item.subtitle ? `${item.subtitle} • ` : ''}${item.type} ${item.account ? `• From: ${item.account}` : ''}
                        </div>
                    </div>
                `).join('')}
                <div style="margin-top: 12px; padding: 8px; background-color: #fefce8; border-radius: 6px; border: 1px solid #fef08a;">
                    <p style="margin: 0; font-size: 12px; color: #854d0e; font-style: italic;">
                        These items are flagged as requiring manual payment (e.g. e-transfer, bill pay, etc.).
                    </p>
                </div>
            </div>
        </div>
        ` : ''}
         <p style="text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8;">
            Generated by BacktoBlack on ${new Date().toLocaleString()}
        </p>
    </div>
     `;
};

export const ReportGenerator = {
    generateBudgetSummary,
    generateTransferReport
};
