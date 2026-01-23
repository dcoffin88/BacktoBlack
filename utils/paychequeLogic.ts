import { IncomeSource, Expense, Liability, ExtraPayment, PaychequeOccurrence } from "../types";
import { getAnnualizedIncomeAmount } from "../server/liabilityAlgorithms";

export const getSemiMonthlyDates = (
    anchorDay: number,
    startDate: Date,
    endDate: Date
): Date[] => {
    const dates: Date[] = [];
    const day1Base = anchorDay <= 15 ? anchorDay : anchorDay - 15;
    const day2Base = anchorDay <= 15 ? anchorDay + 15 : anchorDay;
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    while (cursor <= endCursor) {
        const year = cursor.getFullYear();
        const month = cursor.getMonth();
        const lastDay = new Date(year, month + 1, 0).getDate();
        const day1 = Math.min(Math.max(day1Base, 1), lastDay);
        const day2 = Math.min(Math.max(day2Base, 1), lastDay);
        const first = new Date(year, month, day1);
        const second = new Date(year, month, day2);

        if (first >= startDate && first <= endDate) {
            dates.push(first);
        }
        if (second.getTime() !== first.getTime() && second >= startDate && second <= endDate) {
            dates.push(second);
        }

        cursor.setMonth(cursor.getMonth() + 1);
    }

    return dates.sort((a, b) => a.getTime() - b.getTime());
};

export const getPayDates = (source: IncomeSource, startDate: Date, endDate: Date): Date[] => {
    if (!source.nextPayDate) return [];
    const [y, m, d] = source.nextPayDate.split('-').map(Number);
    const seed = new Date(y, m - 1, d);
    if (Number.isNaN(seed.getTime())) return [];
    if (source.frequency === 'SEMI_MONTHLY') {
        return getSemiMonthlyDates(seed.getDate(), startDate, endDate);
    }

    let current = new Date(seed);
    const dates: Date[] = [];
    let iterations = 0;

    while (current > startDate && iterations < 5000) {
        const prev = new Date(current);
        switch (source.frequency) {
            case 'WEEKLY':
                prev.setDate(prev.getDate() - 7);
                break;
            case 'BI_WEEKLY':
                prev.setDate(prev.getDate() - 14);
                break;
            case 'MONTHLY':
                prev.setMonth(prev.getMonth() - 1);
                break;
            case 'ANNUAL':
                prev.setFullYear(prev.getFullYear() - 1);
                break;
            default:
                prev.setDate(prev.getDate() - 30);
        }
        if (prev < startDate) break;
        current = prev;
        iterations += 1;
    }

    iterations = 0;
    while (current <= endDate && iterations < 5000) {
        if (current >= startDate) {
            dates.push(new Date(current));
        }
        iterations += 1;
        switch (source.frequency) {
            case 'WEEKLY':
                current.setDate(current.getDate() + 7);
                break;
            case 'BI_WEEKLY':
                current.setDate(current.getDate() + 14);
                break;
            case 'MONTHLY':
                current.setMonth(current.getMonth() + 1);
                break;
            case 'ANNUAL':
                current.setFullYear(current.getFullYear() + 1);
                break;
            default:
                current.setDate(current.getDate() + 30);
        }
    }
    return dates;
};

export const generatePaycheques = (
    incomes: IncomeSource[],
    startDate: Date,
    endDate: Date,
    options: {
        budgetStartDate?: Date | null;
    } = {}
): PaychequeOccurrence[] => {
    const occurrences: PaychequeOccurrence[] = [];
    const monthCountsBySource: Record<string, Record<string, number>> = {};

    incomes.forEach((src) => {
        const startBoundary = options.budgetStartDate && options.budgetStartDate.getTime() > startDate.getTime()
            ? options.budgetStartDate
            : startDate;

        const dates = getPayDates(src, startBoundary, endDate).sort(
            (a, b) => a.getTime() - b.getTime()
        );

        monthCountsBySource[src.id] = monthCountsBySource[src.id] || {};

        dates.forEach((date) => {
            const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
            const currentCount = monthCountsBySource[src.id][monthKey] || 0;
            monthCountsBySource[src.id][monthKey] = currentCount + 1;

            const eligibleMonthly =
                src.includeFirstTwoCheques === true
                    ? currentCount < 2
                    : true;

            occurrences.push({
                date,
                source: src,
                eligibleMonthly,
                eligibleBiWeekly: true,
            });
        });
    });

    return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
};

export const getAnnualizedShareMap = (sources: IncomeSource[]) => {
    const totalShare = sources.reduce(
        (sum, source) => sum + getAnnualizedIncomeAmount(source),
        0
    );
    const shareById = new Map<string, number>();
    if (totalShare > 0) {
        sources.forEach((source) => {
            shareById.set(source.id, getAnnualizedIncomeAmount(source) / totalShare);
        });
    }
    return { totalShare, shareById };
};

export const getPerChequeRatio = (
    currentPaycheque: PaychequeOccurrence | null,
    monthPaychequesForCheque: PaychequeOccurrence[],
    budgetedIncomes: IncomeSource[],
    options: {
        useBiWeekly: boolean;
        excludedIds?: Set<string>;
        owner?: 'USER' | 'PARTNER' | 'ALL';
    }
) => {
    if (!currentPaycheque) return 0;
    const { useBiWeekly, excludedIds = new Set<string>(), owner = 'ALL' } = options;

    const matchesOwner = (source: IncomeSource) =>
        owner === 'ALL'
            ? true
            : owner === 'PARTNER'
                ? source.isPartner
                : !source.isPartner;

    const isEligiblePaycheque = (paycheque: PaychequeOccurrence) => {
        const passesFrequency = useBiWeekly
            ? paycheque.eligibleBiWeekly !== false
            : paycheque.eligibleMonthly !== false;
        return (
            passesFrequency &&
            !excludedIds.has(paycheque.source.id) &&
            matchesOwner(paycheque.source)
        );
    };

    const eligiblePaycheques = monthPaychequesForCheque.filter(isEligiblePaycheque);
    if (eligiblePaycheques.length === 0) return 0;
    if (!isEligiblePaycheque(currentPaycheque)) return 0;

    const eligibleSources = budgetedIncomes.filter(
        (source) => !excludedIds.has(source.id) && matchesOwner(source)
    );

    const { totalShare, shareById } = getAnnualizedShareMap(eligibleSources);
    if (totalShare <= 0) return 1 / eligiblePaycheques.length;

    const perSource = new Map<string, { share: number; count: number }>();
    eligiblePaycheques.forEach((paycheque) => {
        const share = shareById.get(paycheque.source.id) || 0;
        const existing = perSource.get(paycheque.source.id) || {
            share,
            count: 0,
        };
        existing.share = share;
        existing.count += 1;
        perSource.set(paycheque.source.id, existing);
    });

    const totalShareInMonth = Array.from(perSource.values()).reduce(
        (sum, entry) => sum + entry.share,
        0
    );

    if (totalShareInMonth <= 0) return 1 / eligiblePaycheques.length;
    const current = perSource.get(currentPaycheque.source.id);
    if (!current || current.count <= 0) return 0;
    return (current.share / current.count) / totalShareInMonth;
};

export const getPerChequeExpenseAmount = (
    expense: Expense,
    currentPaycheque: PaychequeOccurrence | null,
    monthPaychequesForCheque: PaychequeOccurrence[],
    budgetedIncomes: IncomeSource[],
    userSplitRatio: number
) => {
    const excluded = new Set(expense.excludedIncomeSourceIds || []);
    if (currentPaycheque && excluded.has(currentPaycheque.source.id)) {
        return 0;
    }

    const rounded = (value: number) => Math.ceil(value * 100) / 100;
    const perChequeBase = expense.amount;

    if (expense.excludeFromSplitting) {
        const owner = expense.owner || "JOINT";
        const useBiWeekly =
            expense.frequency === "BI_WEEKLY" ||
            expense.frequency === "WEEKLY";
        const monthlyEquivalent =
            expense.frequency === "BI_WEEKLY"
                ? expense.amount * 2
                : expense.frequency === "WEEKLY"
                    ? expense.amount * (52 / 12)
                    : expense.frequency === "QUARTERLY"
                        ? expense.amount / 3
                        : expense.frequency === "ANNUAL"
                            ? expense.amount / 12
                            : expense.amount;

        const eligiblePool = monthPaychequesForCheque.filter((p) => {
            const passesFrequency = useBiWeekly
                ? p.eligibleBiWeekly !== false
                : p.eligibleMonthly !== false;
            if (!passesFrequency) return false;
            if (excluded.has(p.source.id)) return false;
            if (owner === "PARTNER") return p.source.isPartner;
            if (owner === "USER") return !p.source.isPartner;
            return true;
        });

        const isEligibleCurrent =
            currentPaycheque &&
            eligiblePool.some((p) => p === currentPaycheque) &&
            !excluded.has(currentPaycheque.source.id);

        if (!isEligibleCurrent) return 0;

        if (useBiWeekly) {
            return expense.amount;
        }

        const count = eligiblePool.length || 1;
        return monthlyEquivalent / count;
    }

    const useBiWeekly = expense.frequency === "BI_WEEKLY" || expense.frequency === "WEEKLY";
    const monthlyEquivalent =
        expense.frequency === "BI_WEEKLY"
            ? expense.amount * 2
            : expense.frequency === "WEEKLY"
                ? expense.amount * (52 / 12)
                : expense.frequency === "QUARTERLY"
                    ? expense.amount / 3
                    : expense.frequency === "ANNUAL"
                        ? expense.amount / 12
                        : expense.amount;

    const getRatio = (useBW: boolean, owner: 'USER' | 'PARTNER' | 'ALL' = 'ALL') =>
        getPerChequeRatio(currentPaycheque, monthPaychequesForCheque, budgetedIncomes, {
            useBiWeekly: useBW,
            excludedIds: excluded,
            owner,
        });

    const biWeeklyRatioOwnerEff = (() => {
        const ownerKey = currentPaycheque?.source.isPartner ? "PARTNER" : "USER";
        return getRatio(true, ownerKey);
    })();

    const monthlyRatioOwnerEff = (() => {
        const ownerKey = currentPaycheque?.source.isPartner ? "PARTNER" : "USER";
        return getRatio(false, ownerKey);
    })();

    if (useBiWeekly) {
        const monthSources = Array.from(
            new Map(monthPaychequesForCheque.map((p) => [p.source.id, p.source])).values()
        ).filter((s) => !excluded.has(s.id));

        const totalAnnualizedEquivalent = monthSources.reduce(
            (sum, source) => sum + getAnnualizedIncomeAmount(source),
            0
        );

        const biWeeklySources = monthSources.filter(
            (source) =>
                source.frequency === "BI_WEEKLY" ||
                source.frequency === "WEEKLY"
        );

        const isBiWeeklySource = biWeeklySources.some(
            (source) => source.id === currentPaycheque?.source.id
        );

        if (!isBiWeeklySource) return 0;

        if (totalAnnualizedEquivalent > 0) {
            const biWeeklyCount = biWeeklySources.length || 1;
            const monthlyOnlyShare = monthSources
                .filter(
                    (source) =>
                        source.frequency !== "BI_WEEKLY" &&
                        source.frequency !== "WEEKLY"
                )
                .reduce(
                    (sum, source) =>
                        sum + getAnnualizedIncomeAmount(source) / totalAnnualizedEquivalent,
                    0
                );
            const sourceShare =
                getAnnualizedIncomeAmount(currentPaycheque!.source) /
                totalAnnualizedEquivalent;

            const baseShare = sourceShare + monthlyOnlyShare / biWeeklyCount;
            const owner = expense.owner || "JOINT";

            if (owner === "PARTNER" && !currentPaycheque?.source.isPartner) return 0;
            if (owner === "USER" && currentPaycheque?.source.isPartner) return 0;

            return perChequeBase * baseShare;
        }
    }

    const owner = expense.owner || "JOINT";

    if (owner === "PARTNER") {
        if (!currentPaycheque?.source.isPartner) return 0;
        return useBiWeekly
            ? perChequeBase * biWeeklyRatioOwnerEff
            : monthlyEquivalent * monthlyRatioOwnerEff;
    }

    if (owner === "USER") {
        if (currentPaycheque?.source.isPartner) return 0;
        return useBiWeekly
            ? perChequeBase * biWeeklyRatioOwnerEff
            : monthlyEquivalent * monthlyRatioOwnerEff;
    }

    const userPortion = perChequeBase * userSplitRatio;
    const partnerPortion = perChequeBase - userPortion;

    if (currentPaycheque?.source.isPartner) {
        return useBiWeekly
            ? partnerPortion * biWeeklyRatioOwnerEff
            : partnerPortion * monthlyRatioOwnerEff;
    }

    return useBiWeekly
        ? userPortion * biWeeklyRatioOwnerEff
        : userPortion * monthlyRatioOwnerEff;
};


export const getPerChequeLiabilityAmount = (
    liability: Liability & { plannedPayment?: number },
    currentPaycheque: PaychequeOccurrence | null,
    monthPaychequesForCheque: PaychequeOccurrence[],
    budgetedIncomes: IncomeSource[],
    extraPayments: ExtraPayment[],
    userSplitRatio: number,
    options?: {
        includeUnchecked?: boolean;
        excludeExtras?: boolean;
    }
) => {
    if (!currentPaycheque) return 0;
    const frequency = liability.paymentFrequency || 'MONTHLY';
    const excluded = new Set<string>(liability.excludedIncomeSourceIds || []);
    if (excluded.has(currentPaycheque.source.id)) return 0;

    const { includeUnchecked = true, excludeExtras = false } = options || {};

    const toLocalYMD = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const chequeDateStr = toLocalYMD(currentPaycheque.date);
    const extraAmount = excludeExtras ? 0 : extraPayments
        .filter(p => {
            if (p.id.startsWith('min-')) return false;
            if (p.liabilityId !== liability.id) return false;
            if (p.chequeDate !== chequeDateStr) return false;
            if (p.incomeSourceId && p.incomeSourceId !== currentPaycheque.source.id) return false;
            if (!includeUnchecked) {
                return !!p.isChecked;
            }
            return p.isChecked !== false;
        })
        .reduce((sum, p) => sum + p.amount, 0);

    const useBiWeekly =
        frequency === "BI_WEEKLY" || frequency === "WEEKLY";
    const hasAdvanced =
        liability.excludeFromSplitting ||
        (liability.excludedIncomeSourceIds || []).length > 0;
    const owner = liability.owner || "JOINT";
    const rounded = (value: number) => Math.ceil(value * 100) / 100;

    const getRatio = (useBW: boolean, ownerFilter: 'USER' | 'PARTNER' | 'ALL' = 'ALL') =>
        getPerChequeRatio(currentPaycheque, monthPaychequesForCheque, budgetedIncomes, {
            useBiWeekly: useBW,
            excludedIds: excluded,
            owner: ownerFilter,
        });

    const monthlyRatioEff = getRatio(false);
    const biWeeklyRatioEff = getRatio(true);

    const ownerKey = currentPaycheque?.source.isPartner ? "PARTNER" : "USER";
    const monthlyRatioOwnerEff = getRatio(false, ownerKey);
    const biWeeklyRatioOwnerEff = getRatio(true, ownerKey);

    if (useBiWeekly) {
        if (currentPaycheque?.eligibleBiWeekly === false) return 0;
        if (owner === "PARTNER" && !currentPaycheque?.source.isPartner)
            return 0;
        if (owner === "USER" && currentPaycheque?.source.isPartner)
            return 0;

        const monthlyAmount = liability.plannedPayment ?? (liability.minPaymentAmount || 0);

        const perPeriod =
            frequency === "WEEKLY"
                ? monthlyAmount * (12 / 52)
                : monthlyAmount * (12 / 26);

        if (owner === "JOINT") {
            if (liability.excludeFromSplitting) {
                return rounded(perPeriod + extraAmount);
            }
            const splitRatio = currentPaycheque?.source.isPartner
                ? 1 - userSplitRatio
                : userSplitRatio;
            return rounded(perPeriod * splitRatio + extraAmount);
        }
        return rounded(perPeriod + extraAmount);
    }

    if (!hasAdvanced) {
        if (currentPaycheque.eligibleMonthly === false) return 0;
        const monthlyAmount = liability.plannedPayment ?? (liability.minPaymentAmount || 0);
        return rounded(
            monthlyAmount * monthlyRatioEff + extraAmount
        );
    }

    if (owner === "PARTNER" && !currentPaycheque?.source.isPartner) return 0;
    if (owner === "USER" && currentPaycheque?.source.isPartner) return 0;

    const ratioBase = useBiWeekly ? biWeeklyRatioEff : monthlyRatioEff;
    const ratioOwner = useBiWeekly ? biWeeklyRatioOwnerEff : monthlyRatioOwnerEff;
    const ratio = owner === "JOINT" ? ratioBase : ratioOwner;

    if (!useBiWeekly && currentPaycheque?.eligibleMonthly === false) return 0;

    const monthlyAmount = liability.plannedPayment ?? (liability.minPaymentAmount || 0);
    return (monthlyAmount * ratio) + extraAmount;
};
