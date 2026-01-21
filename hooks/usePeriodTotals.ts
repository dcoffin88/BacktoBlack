import { useMemo, useCallback } from 'react';
import { Asset, Expense, IncomeSource, Liability, UserSettings, PaycheckOccurrence } from '../types';
import { generatePaychecks, getPerCheckExpenseAmount, getPerCheckLiabilityAmount } from '../utils/paycheckLogic';
import { getAnnualizedIncomeAmount, getMinPayment } from '../server/liabilityAlgorithms';

interface PeriodTotalsProps {
    liabilities: Liability[];
    expenses: Expense[];
    incomes: IncomeSource[];
    assets: Asset[]; // kept for potential future net worth calc, though not strictly needed for current breakdown
    extraPayments: any[]; // exact type defined in components commonly
    periodStart: Date;
    periodEnd: Date;
    userSettings: UserSettings;
    monthlyBudget: number; // needed for cash out calc
    amortizationSchedules?: Record<string, any>;
}

export const usePeriodTotals = ({
    liabilities,
    expenses,
    incomes,
    extraPayments,
    periodStart,
    periodEnd,
    userSettings,
    monthlyBudget,
    amortizationSchedules = {},
}: PeriodTotalsProps) => {

    const budgetStartDate = useMemo(() => {
        if (!userSettings?.startDate) return null;
        const parsed = new Date(userSettings.startDate);
        if (Number.isNaN(parsed.getTime())) return null;
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }, [userSettings?.startDate]);

    const budgetedIncomes = useMemo(
        () => incomes.filter((i) => i.includeInPlanner !== false),
        [incomes]
    );

    const paychecks = useMemo(() => {
        return generatePaychecks(budgetedIncomes, periodStart, periodEnd, {
            budgetStartDate
        });
    }, [budgetStartDate, budgetedIncomes, periodStart, periodEnd]);

    // Ensure we only look at paychecks strictly within the requested window
    const paychecksInPeriod = useMemo(
        () =>
            paychecks.filter(
                (paycheck) => paycheck.date >= periodStart && paycheck.date <= periodEnd
            ),
        [paychecks, periodStart, periodEnd]
    );

    const userSplitRatio = useMemo(() => {
        if (!userSettings?.enablePartner) return 1;
        if (userSettings.expenseSplitMethod === 'PERCENTAGE') {
            return (userSettings.userSplitPercentage || 50) / 100;
        }
        if (userSettings.expenseSplitMethod === 'INCOME') {
            const mine = budgetedIncomes
                .filter((i) => !i.isPartner && !i.excludeFromSplitting)
                .reduce((sum, source) => sum + getAnnualizedIncomeAmount(source), 0);
            const partner = budgetedIncomes
                .filter((i) => i.isPartner && !i.excludeFromSplitting)
                .reduce((sum, source) => sum + getAnnualizedIncomeAmount(source), 0);
            const total = mine + partner;
            if (total <= 0) return 0.5;
            return mine / total;
        }
        return 0.5;
    }, [budgetedIncomes, userSettings]);

    const getMonthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

    const monthPaychecksByKey = useMemo(() => {
        const buckets = new Map<string, PaycheckOccurrence[]>();
        paychecks.forEach((paycheck) => {
            const key = getMonthKey(paycheck.date);
            const existing = buckets.get(key);
            if (existing) {
                existing.push(paycheck);
                return;
            }
            buckets.set(key, [paycheck]);
        });
        return buckets;
    }, [paychecks]);

    const getMonthPaychecksFor = useCallback(
        (date: Date) => monthPaychecksByKey.get(getMonthKey(date)) || [],
        [monthPaychecksByKey]
    );

    const getPerCheckExpenseFor = useCallback((expense: Expense, currentPaycheck: PaycheckOccurrence | null, monthPaychecksForCheck: PaycheckOccurrence[]) => {
        return getPerCheckExpenseAmount(expense, currentPaycheck, monthPaychecksForCheck, budgetedIncomes, userSplitRatio);
    }, [userSplitRatio, budgetedIncomes]);

    // Checkbox explicitly forced to false for Reports consistency
    const getPerCheckLiabilityFor = useCallback((liability: Liability & { plannedPayment?: number }, currentPaycheck: PaycheckOccurrence | null, monthPaychecksForCheck: PaycheckOccurrence[]) => {
        return getPerCheckLiabilityAmount(
            liability,
            currentPaycheck,
            monthPaychecksForCheck,
            budgetedIncomes,
            extraPayments,
            userSplitRatio,
            { includeUnchecked: false }
        );
    }, [userSplitRatio, budgetedIncomes, extraPayments]);

    // Prepare liabilities with calculated planned payments (similar to Reports.tsx logic)
    const activeLiabilities = useMemo(() => {
        const rangeEnd = new Date(periodEnd);
        rangeEnd.setHours(0, 0, 0, 0);
        return liabilities.filter((liability) => {
            if (!liability.startDate) return true;
            const start = new Date(`${liability.startDate}T12:00:00`);
            if (Number.isNaN(start.getTime())) return true;
            start.setHours(0, 0, 0, 0);
            return start <= rangeEnd;
        });
    }, [liabilities, periodEnd]);

    const scheduleBalanceById = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const next: Record<string, number> = {};
        liabilities.forEach((liability) => {
            const schedule = amortizationSchedules[liability.id];
            if (!schedule?.timeline?.length) {
                next[liability.id] = liability.balance;
                return;
            }
            let latestDate: Date | null = null;
            let latestBalance: number | null = null;
            schedule.timeline.forEach((row: any) => {
                // Basic date parsing logic duplicated for safety
                const val = row.actualDate;
                const parsed = !val ? null : (val.includes('T') ? new Date(val) : new Date(`${val}T12:00:00`));

                if (!parsed || parsed > today) return;
                if (!latestDate || parsed > latestDate) {
                    latestDate = parsed;
                    latestBalance = row.remainingBalance;
                }
            });
            if (latestBalance !== null) {
                next[liability.id] = latestBalance;
                return;
            }
            // Fallback to historical check same as Reports... omitted for brevity/simplicity as we mostly care about totals
            next[liability.id] = liability.balance;
        });
        return next;
    }, [amortizationSchedules, liabilities]);

    const liabilityWithMins = useMemo(() => {
        return activeLiabilities.map((liability) => {
            const currentBalance = scheduleBalanceById[liability.id] ?? liability.balance;
            const monthlyInterest = currentBalance * (liability.interestRate / 100 / 12);
            const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
            return {
                ...liability,
                plannedPayment: getMinPayment(liability, currentBalance, monthlyInterest, estFee),
                scheduledFrequency: liability.paymentFrequency || 'MONTHLY',
            };
        });
    }, [activeLiabilities, scheduleBalanceById]);

    const getExpensePeriodTotal = useCallback(
        (expense: Expense) => {
            return paychecksInPeriod.reduce((sum, paycheck) => {
                const monthPaychecksForCheck = getMonthPaychecksFor(paycheck.date);
                return sum + getPerCheckExpenseFor(expense, paycheck, monthPaychecksForCheck);
            }, 0);
        },
        [getMonthPaychecksFor, getPerCheckExpenseFor, paychecksInPeriod]
    );

    const getLiabilityPeriodTotal = useCallback(
        (liability: typeof liabilityWithMins[number]) => {
            return paychecksInPeriod.reduce((sum, paycheck) => {
                const monthPaychecksForCheck = getMonthPaychecksFor(paycheck.date);
                return sum + getPerCheckLiabilityFor(liability, paycheck, monthPaychecksForCheck);
            }, 0);
        },
        [getMonthPaychecksFor, getPerCheckLiabilityFor, paychecksInPeriod]
    );

    const periodIncomeTotal = useMemo(
        () => paychecksInPeriod.reduce((sum, paycheck) => sum + paycheck.source.amount, 0),
        [paychecksInPeriod]
    );

    const periodExpenseTotal = useMemo(
        () => expenses.reduce((sum, expense) => sum + getExpensePeriodTotal(expense), 0),
        [expenses, getExpensePeriodTotal]
    );

    const periodLiabilityTotal = useMemo(
        () => liabilityWithMins.reduce((sum, liability) => sum + getLiabilityPeriodTotal(liability), 0),
        [getLiabilityPeriodTotal, liabilityWithMins]
    );

    // Calculate month count for budget multiplier (usually 1 if simple monthly view)
    const monthCount = useMemo(() => {
        const startY = periodStart.getFullYear();
        const startM = periodStart.getMonth();
        const endY = periodEnd.getFullYear();
        const endM = periodEnd.getMonth();
        return Math.max(1, (endY * 12 + endM) - (startY * 12 + startM) + 1);
    }, [periodStart, periodEnd]);

    const periodCashOut = useMemo(
        () => periodExpenseTotal + periodLiabilityTotal + (monthlyBudget * monthCount),
        [monthlyBudget, monthCount, periodExpenseTotal, periodLiabilityTotal]
    );

    const periodNet = useMemo(() => periodIncomeTotal - periodCashOut, [periodCashOut, periodIncomeTotal]);

    return {
        periodIncomeTotal,
        periodExpenseTotal,
        periodLiabilityTotal,
        periodNet,
        periodCashOut,
        paychecksInPeriod
    };
};
