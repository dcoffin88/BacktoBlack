import { useMemo, useCallback } from 'react';
import { Asset, Expense, IncomeSource, Liability, UserSettings, PaychequeOccurrence } from '../types';
import { generatePaycheques, getPerChequeExpenseAmount, getPerChequeLiabilityAmount } from '../utils/paychequeLogic';
import { getAnnualizedIncomeAmount, getMinPayment } from '../server/liabilityAlgorithms';

interface PeriodTotalsProps {
    liabilities: Liability[];
    expenses: Expense[];
    incomes: IncomeSource[];
    assets: Asset[];
    extraPayments: any[];
    periodStart: Date;
    periodEnd: Date;
    userSettings: UserSettings;
    monthlyBudget: number;
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

    const paycheques = useMemo(() => {
        return generatePaycheques(budgetedIncomes, periodStart, periodEnd, {
            budgetStartDate
        });
    }, [budgetStartDate, budgetedIncomes, periodStart, periodEnd]);

    const paychequesInPeriod = useMemo(
        () =>
            paycheques.filter(
                (paycheque) => paycheque.date >= periodStart && paycheque.date <= periodEnd
            ),
        [paycheques, periodStart, periodEnd]
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

    const monthPaychequesByKey = useMemo(() => {
        const buckets = new Map<string, PaychequeOccurrence[]>();
        paycheques.forEach((paycheque) => {
            const key = getMonthKey(paycheque.date);
            const existing = buckets.get(key);
            if (existing) {
                existing.push(paycheque);
                return;
            }
            buckets.set(key, [paycheque]);
        });
        return buckets;
    }, [paycheques]);

    const getMonthPaychequesFor = useCallback(
        (date: Date) => monthPaychequesByKey.get(getMonthKey(date)) || [],
        [monthPaychequesByKey]
    );

    const getPerChequeExpenseFor = useCallback((expense: Expense, currentPaycheque: PaychequeOccurrence | null, monthPaychequesForCheque: PaychequeOccurrence[]) => {
        return getPerChequeExpenseAmount(expense, currentPaycheque, monthPaychequesForCheque, budgetedIncomes, userSplitRatio);
    }, [userSplitRatio, budgetedIncomes]);

    const getPerChequeLiabilityFor = useCallback((liability: Liability & { plannedPayment?: number }, currentPaycheque: PaychequeOccurrence | null, monthPaychequesForCheque: PaychequeOccurrence[]) => {
        return getPerChequeLiabilityAmount(
            liability,
            currentPaycheque,
            monthPaychequesForCheque,
            budgetedIncomes,
            extraPayments,
            userSplitRatio,
            { includeUnchecked: false }
        );
    }, [userSplitRatio, budgetedIncomes, extraPayments]);

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
            return paychequesInPeriod.reduce((sum, paycheque) => {
                const monthPaychequesForCheque = getMonthPaychequesFor(paycheque.date);
                return sum + getPerChequeExpenseFor(expense, paycheque, monthPaychequesForCheque);
            }, 0);
        },
        [getMonthPaychequesFor, getPerChequeExpenseFor, paychequesInPeriod]
    );

    const getLiabilityPeriodTotal = useCallback(
        (liability: typeof liabilityWithMins[number]) => {
            return paychequesInPeriod.reduce((sum, paycheque) => {
                const monthPaychequesForCheque = getMonthPaychequesFor(paycheque.date);
                return sum + getPerChequeLiabilityFor(liability, paycheque, monthPaychequesForCheque);
            }, 0);
        },
        [getMonthPaychequesFor, getPerChequeLiabilityFor, paychequesInPeriod]
    );

    const periodIncomeTotal = useMemo(
        () => paychequesInPeriod.reduce((sum, paycheque) => sum + paycheque.source.amount, 0),
        [paychequesInPeriod]
    );

    const periodExpenseTotal = useMemo(
        () => expenses.reduce((sum, expense) => sum + getExpensePeriodTotal(expense), 0),
        [expenses, getExpensePeriodTotal]
    );

    const periodLiabilityTotal = useMemo(
        () => liabilityWithMins.reduce((sum, liability) => sum + getLiabilityPeriodTotal(liability), 0),
        [getLiabilityPeriodTotal, liabilityWithMins]
    );

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
        paychequesInPeriod
    };
};
