import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Expense,
    IncomeSource,
    Liability,
    BudgetSchedule,
    UserSettings,
    ExpenseSplitMethod,
} from "../types";
import {
    getAnnualizedIncomeAmount,
    getMinPayment,
} from "../server/liabilityAlgorithms";
import {
    getPerChequeExpenseAmount,
    getPerChequeLiabilityAmount,
} from "../utils/paychequeLogic";
import {
    CheckSquare,
    Square,
    Calculator,
    DollarSign,
    Calendar,
    TrendingUp,
    Plus,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { dbAPI } from "../server/db";

interface BudgetProps {
    expenses: Expense[];
    liabilities: Liability[];
    incomes: IncomeSource[];
    userSettings?: UserSettings;
    onUpdateLiability?: (liability: Liability) => void | Promise<void>;
}

type ExtraPayment = {
    id: string;
    liabilityId: string;
    amount: number;
    chequeDate?: string | null;
    isChecked?: boolean;
};

const Budget: React.FC<BudgetProps> = ({
    expenses,
    liabilities,
    incomes,
    userSettings,
    onUpdateLiability,
}) => {
    const getLiabilityFrequency = (
        liability: {
            frequency?: Liability["paymentFrequency"];
            paymentFrequency?: Liability["paymentFrequency"];
        } = {}
    ): Liability["paymentFrequency"] =>
        liability.frequency || liability.paymentFrequency || "MONTHLY";

    const [expenseChequesByCheque, setExpenseChequesByCheque] = useState<
        Record<string, Record<string, boolean>>
    >({});
    const [liabilityChequesByCheque, setLiabilityChequesByCheque] = useState<
        Record<string, Record<string, boolean>>
    >({});
    const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
    const [extraForm, setExtraForm] = useState<{
        liabilityId: string;
        amount: number;
    }>({ liabilityId: "", amount: 0 });
    const [currentPaychequeIndex, setCurrentPaychequeIndex] = useState(0);
    const [budgetSchedule, setBudgetSchedule] = useState<BudgetSchedule | null>(null);
    const [scheduleMonthIndex, setScheduleMonthIndex] = useState<number | null>(
        null
    );
    const isMinimumPaymentId = (id: string) => id.startsWith("min-");
    const getMinimumPaymentId = (liabilityId: string, chequeDate: string) =>
        `min-${liabilityId}-${chequeDate}`;
    const budgetStartDate = useMemo(() => {
        if (!userSettings?.startDate) return null;
        const parsed = new Date(userSettings.startDate);
        if (Number.isNaN(parsed.getTime())) return null;
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }, [userSettings?.startDate]);

    const persistCheques = useCallback(
        async (
            chequeDate: string,
            expenseCheques: Record<string, boolean>,
            liabilityCheques: Record<string, boolean>
        ) => {
            if (!chequeDate) return;
            try {
                await dbAPI.saveBudgetCheques({
                    chequeDate,
                    expenseCheques,
                    liabilityCheques,
                });
            } catch {
                /* if offline or unauthenticated, ignore */
            }
        },
        []
    );

    useEffect(() => {
        let active = true;
        const loadRemoteCheques = async () => {
            try {
                const remote = await dbAPI.getBudgetCheques();
                if (!active || !remote) return;
                setExpenseChequesByCheque((prev) => ({
                    ...prev,
                    ...(remote.expenseChequesByCheque || {}),
                }));
                setLiabilityChequesByCheque((prev) => ({
                    ...prev,
                    ...(remote.liabilityChequesByCheque || {}),
                }));
            } catch {
                /* ignore fetch errors */
            }
        };
        const loadExtras = async () => {
            try {
                const remote = await dbAPI.getExtraPayments();
                if (!active || !remote?.extras) return;
                setExtraPayments(remote.extras || []);
            } catch {
                /* ignore fetch errors */
            }
        };
        loadRemoteCheques();
        loadExtras();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        const loadSchedule = async () => {
            try {
                const remote = await dbAPI.getBudgetSchedule();
                if (!active) return;
                const schedule = remote?.schedule || null;
                setBudgetSchedule(schedule);
                if (schedule?.savedAt) {
                    const savedDate = new Date(schedule.savedAt);
                    const today = new Date();
                    if (Number.isNaN(savedDate.getTime())) {
                        setScheduleMonthIndex(null);
                        return;
                    }
                    const savedMonthCount =
                        savedDate.getFullYear() * 12 + savedDate.getMonth();
                    const currentMonthCount =
                        today.getFullYear() * 12 + today.getMonth();
                    const rawMonthIndex =
                        currentMonthCount - savedMonthCount + 1;
                    setScheduleMonthIndex(
                        rawMonthIndex >= 1
                            ? Math.min(
                                schedule.timeline?.length || 1,
                                rawMonthIndex
                            )
                            : null
                    );
                } else {
                    setScheduleMonthIndex(null);
                }
            } catch {
                if (active) {
                    setBudgetSchedule(null);
                    setScheduleMonthIndex(null);
                }
            }
        };
        loadSchedule();
        return () => {
            active = false;
        };
    }, [liabilities]);

    const budgetedIncomes = useMemo(
        () => incomes.filter((i) => i.includeInPlanner !== false),
        [incomes]
    );
    const userSplitRatio = useMemo(() => {
        if (!userSettings?.enablePartner) return 1;
        if (userSettings.expenseSplitMethod === ExpenseSplitMethod.PERCENTAGE) {
            return (userSettings.userSplitPercentage || 50) / 100;
        }
        if (userSettings.expenseSplitMethod === ExpenseSplitMethod.INCOME) {
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

    const getExpenseShare = (expense: Expense) => {
        if (!userSettings?.enablePartner) return 1;
        const owner = expense.owner || "JOINT";
        if (owner === "USER") return 1;
        if (owner === "PARTNER") return 0;
        return userSplitRatio;
    };

    const totalExpenses = expenses.reduce((sum, b) => {
        const monthlyEquivalent =
            b.frequency === "BI_WEEKLY"
                ? b.amount * 2
                : b.frequency === "WEEKLY"
                    ? b.amount * (52 / 12)
                    : b.frequency === "QUARTERLY"
                        ? b.amount / 3
                        : b.frequency === "ANNUAL"
                            ? b.amount / 12
                            : b.amount;
        return sum + monthlyEquivalent * getExpenseShare(b);
    }, 0);

    const activeScheduleRow = useMemo(() => {
        if (!budgetSchedule || !scheduleMonthIndex) return null;
        return (
            budgetSchedule.timeline.find(
                (row) => row.month === scheduleMonthIndex
            ) || null
        );
    }, [budgetSchedule, scheduleMonthIndex]);

    const plannedPaymentsByLiability = useMemo(() => {
        if (!activeScheduleRow?.breakdown) return {};
        return activeScheduleRow.breakdown.reduce<Record<string, number>>(
            (acc, row) => {
                acc[row.liabilityId] = row.payment;
                return acc;
            },
            {}
        );
    }, [activeScheduleRow]);

    const hasBiWeeklyExpense = expenses.some(
        (e) => e.frequency === "BI_WEEKLY" || e.frequency === "WEEKLY"
    );

    const currentMonthPaycheques = useMemo(() => {
        const today = new Date();
        const windowYears = 20;
        const start = new Date(today.getFullYear() - windowYears, 0, 1);
        const end = new Date(today.getFullYear() + windowYears, 11, 31);
        const startBoundary =
            budgetStartDate && budgetStartDate.getTime() > start.getTime()
                ? budgetStartDate
                : start;

        const getSemiMonthlyDates = (
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

        const getPayDates = (
            source: IncomeSource,
            startDate: Date,
            endDate: Date
        ): Date[] => {
            const dates: Date[] = [];
            const [y, m, d] = source.nextPayDate.split("-").map(Number);
            const seed = new Date(y, m - 1, d);
            if (Number.isNaN(seed.getTime())) return dates;
            if (source.frequency === "SEMI_MONTHLY") {
                return getSemiMonthlyDates(seed.getDate(), startDate, endDate);
            }
            let current = new Date(seed);

            let iterations = 0;
            while (current > startDate && iterations < 5000) {
                const prev = new Date(current);
                switch (source.frequency) {
                    case "WEEKLY":
                        prev.setDate(prev.getDate() - 7);
                        break;
                    case "BI_WEEKLY":
                        prev.setDate(prev.getDate() - 14);
                        break;
                    case "MONTHLY":
                        prev.setMonth(prev.getMonth() - 1);
                        break;
                    case "ANNUAL":
                        prev.setFullYear(prev.getFullYear() - 1);
                        break;
                    default:
                        prev.setDate(prev.getDate() - 30);
                }
                if (prev < startDate) break;
                current = prev;
                iterations++;
            }

            iterations = 0;
            while (current <= endDate && iterations < 5000) {
                if (current >= startDate) {
                    dates.push(new Date(current));
                }
                iterations++;

                switch (source.frequency) {
                    case "WEEKLY":
                        current.setDate(current.getDate() + 7);
                        break;
                    case "BI_WEEKLY":
                        current.setDate(current.getDate() + 14);
                        break;
                    case "MONTHLY":
                        current.setMonth(current.getMonth() + 1);
                        break;
                    case "ANNUAL":
                        current.setFullYear(current.getFullYear() + 1);
                        break;
                    default:
                        current.setDate(current.getDate() + 30);
                }
            }

            return dates;
        };

        const monthCountsBySource: Record<string, Record<string, number>> = {};
        const occurrences: {
            date: Date;
            source: IncomeSource;
            eligible: boolean;
            eligibleMonthly: boolean;
            eligibleBiWeekly: boolean;
        }[] = [];
        budgetedIncomes.forEach((src) => {
            const dates = getPayDates(src, startBoundary, end).sort(
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
                    eligible: true,
                });
            });
        });

        return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [budgetedIncomes, hasBiWeeklyExpense, budgetStartDate]);

    const paychequeCount = currentMonthPaycheques.length || 1;
    useEffect(() => {
        if (currentMonthPaycheques.length === 0) {
            setCurrentPaychequeIndex(0);
            return;
        }
        const today = new Date();
        const nextIdx = currentMonthPaycheques.findIndex(
            (p) => p.date >= today
        );
        const idx =
            nextIdx >= 0 ? nextIdx : currentMonthPaycheques.length - 1;
        setCurrentPaychequeIndex(idx);
    }, [currentMonthPaycheques]);

    const currentPaycheque =
        currentMonthPaycheques[currentPaychequeIndex] || null;

    const activeLiabilities = useMemo(() => {
        if (!currentPaycheque) return [];
        const a = new Date(currentPaycheque.date);
        a.setHours(0, 0, 0, 0);
        const y = a.getFullYear();
        const m = a.getMonth();
        const lastDay = new Date(y, m + 1, 0);

        return liabilities.filter((liability) => {
            if (!liability.startDate) return true;
            const start = new Date(`${liability.startDate}T12:00:00`);
            if (Number.isNaN(start.getTime())) return true;
            start.setHours(0, 0, 0, 0);
            return start <= lastDay;
        });
    }, [liabilities, currentPaycheque]);

    const liabilityWithMins = activeLiabilities.map((d) => {
        const monthlyInterest = d.balance * (d.interestRate / 100 / 12);
        const estFee = d.isFeeMonthly ? d.annualFee / 12 : 0;
        const rawMin = getMinPayment(d, d.balance, monthlyInterest, estFee);
        const minPayment = d.balance > 0 && Number.isFinite(rawMin) ? rawMin : 0;
        return { ...d, minPayment };
    });

    const liabilityWithPlan = liabilityWithMins.map((d) => {
        const scheduledPayment = plannedPaymentsByLiability[d.id];
        return {
            ...d,
            scheduledFrequency: getLiabilityFrequency(d),
            plannedPayment: d.minPayment,
            scheduledAmount: scheduledPayment,
        };
    });

    const hasBiWeeklyLiability = liabilityWithPlan.some(
        (l) => l.scheduledFrequency === "BI_WEEKLY" || l.scheduledFrequency === "WEEKLY"
    );

    const totalLiabilityPayments = liabilityWithPlan.reduce(
        (sum, d) => sum + d.plannedPayment,
        0
    );

    const totalNeeded = totalExpenses + totalLiabilityPayments;
    const currencySymbol = userSettings?.currencySymbol || "$";
    const currentChequeKey =
        currentPaycheque?.date.toISOString().split("T")[0] || "default-cheque";
    const expenseCheques = expenseChequesByCheque[currentChequeKey] || {};
    const liabilityCheques = liabilityChequesByCheque[currentChequeKey] || {};

    useEffect(() => {
        if (!budgetSchedule || !currentPaycheque) return;
        const savedDate = new Date(budgetSchedule.savedAt);
        if (Number.isNaN(savedDate.getTime())) return;
        const savedMonthCount = savedDate.getFullYear() * 12 + savedDate.getMonth();
        const selectedMonthCount =
            currentPaycheque.date.getFullYear() * 12 + currentPaycheque.date.getMonth();
        const rawMonthIndex = selectedMonthCount - savedMonthCount + 1;
        if (rawMonthIndex < 1) {
            setScheduleMonthIndex(null);
            return;
        }
        const clamped = Math.min(budgetSchedule.timeline.length, rawMonthIndex);
        setScheduleMonthIndex(clamped);
    }, [budgetSchedule, currentPaycheque]);

    const toInputDate = (d: Date) => d.toISOString().split("T")[0];
    const paychequeDateRange = useMemo(() => {
        if (currentMonthPaycheques.length === 0) {
            return {
                min: budgetStartDate ? toInputDate(budgetStartDate) : "",
                max: "",
            };
        }
        const first = currentMonthPaycheques[0].date;
        const last =
            currentMonthPaycheques[currentMonthPaycheques.length - 1].date;
        return {
            min: budgetStartDate ? toInputDate(budgetStartDate) : toInputDate(first),
            max: toInputDate(last),
        };
    }, [budgetStartDate, currentMonthPaycheques]);

    const jumpToDate = (value: string) => {
        if (!value || currentMonthPaycheques.length === 0) return;
        const [y, m, d] = value.split("-").map(Number);
        const target = new Date(y, (m || 1) - 1, d || 1);
        let bestIdx = 0;
        let bestDiff = Infinity;
        currentMonthPaycheques.forEach((p, idx) => {
            const diff = Math.abs(p.date.getTime() - target.getTime());
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIdx = idx;
            }
        });
        setCurrentPaychequeIndex(bestIdx);
    };

    const currentOwnerIsPartner = currentPaycheque?.source.isPartner;
    const toggleExpense = (id: string) => {
        setExpenseChequesByCheque((prev) => {
            const nextForCheque = { ...(prev[currentChequeKey] || {}) };
            nextForCheque[id] = !nextForCheque[id];
            const nextState = { ...prev, [currentChequeKey]: nextForCheque };
            persistCheques(
                currentChequeKey,
                nextForCheque,
                liabilityChequesByCheque[currentChequeKey] || {}
            );
            return nextState;
        });
    };

    const saveMinimumPayment = async (
        liability: Liability & { plannedPayment: number },
        amount: number
    ) => {
        const rounded = Math.max(0, Number(amount.toFixed(2)));
        if (rounded <= 0) return;
        const payload: ExtraPayment = {
            id: getMinimumPaymentId(liability.id, currentChequeKey),
            liabilityId: liability.id,
            amount: rounded,
            chequeDate: currentChequeKey,
            isChecked: true,
        };
        setExtraPayments((prev) => {
            const filtered = prev.filter((p) => p.id !== payload.id);
            return [...filtered, payload];
        });
        try {
            await dbAPI.saveExtraPayment(payload);
        } catch {
            /* silently ignore budget-only errors */
        }
    };

    const deleteMinimumPayment = async (liabilityId: string) => {
        const id = getMinimumPaymentId(liabilityId, currentChequeKey);
        setExtraPayments((prev) => prev.filter((p) => p.id !== id));
        try {
            await dbAPI.deleteExtraPayment(id);
        } catch {
            /* silently ignore budget-only errors */
        }
    };

    const toggleLiability = (liability: Liability & { plannedPayment: number }) => {
        setLiabilityChequesByCheque((prev) => {
            const nextForCheque = { ...(prev[currentChequeKey] || {}) };
            nextForCheque[liability.id] = !nextForCheque[liability.id];
            const willCheck = nextForCheque[liability.id];
            if (willCheck) {
                const extraAmount = extraByLiability[liability.id] || 0;
                const minimumPortion = Math.max(
                    0,
                    getPerChequeLiability(liability) - extraAmount
                );
                saveMinimumPayment(liability, minimumPortion);
            } else {
                deleteMinimumPayment(liability.id);
            }
            const nextState = { ...prev, [currentChequeKey]: nextForCheque };
            persistCheques(
                currentChequeKey,
                expenseChequesByCheque[currentChequeKey] || {},
                nextForCheque
            );
            return nextState;
        });
    };

    const clearBudgetSchedule = async () => {
        try {
            await dbAPI.deleteBudgetSchedule();
        } catch {
            /* ignore delete errors */
        }
        setBudgetSchedule(null);
        setScheduleMonthIndex(null);
    };

    const checkAllExpenses = (check: boolean) => {
        setExpenseChequesByCheque((prev) => {
            const nextForCheque = { ...(prev[currentChequeKey] || {}) };
            expensePortions.forEach(({ expense }) => {
                nextForCheque[expense.id] = check;
            });
            const nextState = { ...prev, [currentChequeKey]: nextForCheque };
            persistCheques(
                currentChequeKey,
                nextForCheque,
                liabilityChequesByCheque[currentChequeKey] || {}
            );
            return nextState;
        });
    };

    const checkAllLiabilities = async (check: boolean) => {
        // Optimistically update UI
        const nextForCheque: Record<string, boolean> = {
            ...(liabilityChequesByCheque[currentChequeKey] || {}),
        };
        liabilityPortions.forEach(({ liability }) => {
            nextForCheque[liability.id] = check;
        });

        setLiabilityChequesByCheque((prev) => ({
            ...prev,
            [currentChequeKey]: nextForCheque,
        }));

        persistCheques(
            currentChequeKey,
            expenseChequesByCheque[currentChequeKey] || {},
            nextForCheque
        );

        // Update database records for minimum payments
        if (check) {
            for (const { liability } of liabilityPortions) {
                const extraAmount = extraByLiability[liability.id] || 0;
                const minimumPortion = Math.max(
                    0,
                    getPerChequeLiability(liability) - extraAmount
                );
                await saveMinimumPayment(liability, minimumPortion);
            }
        } else {
            for (const { liability } of liabilityPortions) {
                await deleteMinimumPayment(liability.id);
            }
        }
    };

    const addExtraPayment = (e: React.FormEvent) => {
        e.preventDefault();
        if (!extraForm.liabilityId || extraForm.amount <= 0) return;
        const newPayment: ExtraPayment = {
            id: Math.random().toString(36).slice(2, 9),
            liabilityId: extraForm.liabilityId,
            amount: extraForm.amount,
            chequeDate: currentChequeKey,
            isChecked: false,
        };
        setExtraPayments((prev) => [...prev, newPayment]);
        setExtraForm({ liabilityId: "", amount: 0 });
        dbAPI.saveExtraPayment(newPayment).catch(() => {
            /* ignore failures; no local fallback */
        });
    };

    const deleteExtraPayment = (id: string) => {
        setExtraPayments((prev) => prev.filter((p) => p.id !== id));
        dbAPI.deleteExtraPayment(id).catch(() => {
            /* ignore failures; no local fallback */
        });
    };

    const toggleExtraPayment = async (extra: ExtraPayment) => {
        const nextState = !extra.isChecked;
        const updated = { ...extra, isChecked: nextState };
        setExtraPayments(prev => prev.map(p => p.id === extra.id ? updated : p));
        try {
            await dbAPI.saveExtraPayment(updated);
        } catch {
            /* ignore */
        }
    };

    const checkAllExtras = async (check: boolean) => {
        const updatedExtras = extrasForCurrentCheque.map(p => ({ ...p, isChecked: check }));
        setExtraPayments(prev => {
            const otherExtras = prev.filter(p => !extrasForCurrentCheque.some(e => e.id === p.id));
            return [...otherExtras, ...updatedExtras];
        });
        for (const extra of updatedExtras) {
            try {
                await dbAPI.saveExtraPayment(extra);
            } catch {
                /* ignore */
            }
        }
    };

    const extrasForCurrentCheque = useMemo(
        () =>
            extraPayments.filter(
                (p) =>
                    p.chequeDate &&
                    p.chequeDate === currentChequeKey &&
                    !isMinimumPaymentId(p.id)
            ),
        [extraPayments, currentChequeKey]
    );

    const extraByLiability = extrasForCurrentCheque.reduce<Record<string, number>>(
        (acc, p) => {
            acc[p.liabilityId] = (acc[p.liabilityId] || 0) + p.amount;
            return acc;
        },
        {}
    );

    const formatDate = (date: Date) =>
        date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            weekday: "short",
        });

    const monthlyExpensesTotal = expenses.reduce((sum, e) => {
        const multiplier =
            e.frequency === "QUARTERLY"
                ? 1 / 3
                : e.frequency === "MONTHLY"
                    ? 1
                    : 0;
        return sum + e.amount * multiplier * getExpenseShare(e);
    }, 0);
    const biWeeklyExpensesTotal = expenses
        .filter((e) => e.frequency === "BI_WEEKLY" || e.frequency === "WEEKLY")
        .reduce((sum, e) => {
            const multiplier = e.frequency === "WEEKLY" ? 52 / 12 : 2;
            return sum + e.amount * multiplier * getExpenseShare(e);
        }, 0);

    const monthlyLiabilityTotal = liabilityWithPlan
        .filter((l) => l.scheduledFrequency !== "BI_WEEKLY" && l.scheduledFrequency !== "WEEKLY")
        .reduce((sum, l) => sum + l.plannedPayment, 0);
    const biWeeklyLiabilityTotal = liabilityWithPlan
        .filter((l) => l.scheduledFrequency === "BI_WEEKLY" || l.scheduledFrequency === "WEEKLY")
        .reduce((sum, l) => sum + l.plannedPayment, 0);

    const monthlyNeed = monthlyExpensesTotal + monthlyLiabilityTotal;
    const biWeeklyNeed = biWeeklyExpensesTotal + biWeeklyLiabilityTotal;

    const displayedPaycheques = useMemo(() => {
        if (!currentPaycheque) return currentMonthPaycheques;
        const y = currentPaycheque.date.getFullYear();
        const m = currentPaycheque.date.getMonth();
        return currentMonthPaycheques.filter(
            (p) =>
                p.date.getFullYear() === y &&
                p.date.getMonth() === m
        );
    }, [currentPaycheque, currentMonthPaycheques]);

    const monthPaycheques =
        displayedPaycheques.length > 0 ? displayedPaycheques : currentMonthPaycheques;

    const getAnnualizedShareMap = (sources: IncomeSource[]) => {
        const total = sources.reduce(
            (sum, source) => sum + getAnnualizedIncomeAmount(source),
            0
        );
        const shareById = new Map<string, number>();
        if (total > 0) {
            sources.forEach((source) => {
                shareById.set(source.id, getAnnualizedIncomeAmount(source) / total);
            });
        }
        return { total, shareById };
    };

    const getPerChequeRatio = (
        currentPaycheque: typeof monthPaycheques[number] | null,
        monthPaychequesForCheque: typeof monthPaycheques,
        options: {
            useBiWeekly: boolean;
            excludedIds?: Set<string>;
            owner?: "USER" | "PARTNER" | "ALL";
        }
    ) => {
        if (!currentPaycheque) return 0;
        const { useBiWeekly, excludedIds = new Set<string>(), owner = "ALL" } =
            options;
        const matchesOwner = (source: IncomeSource) =>
            owner === "ALL"
                ? true
                : owner === "PARTNER"
                    ? source.isPartner
                    : !source.isPartner;
        const isEligiblePaycheque = (paycheque: (typeof monthPaycheques)[number]) => {
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
        const { total, shareById } = getAnnualizedShareMap(eligibleSources);
        if (total <= 0) return 1 / eligiblePaycheques.length;

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

    const monthlyRatio = getPerChequeRatio(currentPaycheque, monthPaycheques, {
        useBiWeekly: false,
    });
    const biWeeklyRatio = getPerChequeRatio(currentPaycheque, monthPaycheques, {
        useBiWeekly: true,
    });
    const ownerKey = currentPaycheque?.source.isPartner ? "PARTNER" : "USER";
    const monthlyRatioOwner = getPerChequeRatio(currentPaycheque, monthPaycheques, {
        useBiWeekly: false,
        owner: ownerKey,
    });
    const biWeeklyRatioOwner = getPerChequeRatio(currentPaycheque, monthPaycheques, {
        useBiWeekly: true,
        owner: ownerKey,
    });

    const perPaychequeSetAside =
        monthlyNeed * monthlyRatio + biWeeklyNeed * biWeeklyRatio;

    const getPerChequeExpense = (expense: Expense) => {
        if (!currentPaycheque) return 0;
        return getPerChequeExpenseAmount(
            expense,
            currentPaycheque,
            monthPaycheques,
            budgetedIncomes,
            userSplitRatio
        );
    };

    const getPerChequeLiability = (
        liability: Liability & {
            plannedPayment: number;
            scheduledFrequency?: Liability["paymentFrequency"];
        }
    ) => {
        if (!currentPaycheque) return 0;
        return getPerChequeLiabilityAmount(
            liability,
            currentPaycheque,
            monthPaycheques,
            budgetedIncomes,
            extraPayments,
            userSplitRatio
        );
    };

    const expensePortions = expenses
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((expense) => ({
            expense,
            perCheque: getPerChequeExpense(expense),
        }))
        .filter(({ perCheque }) => perCheque > 0);

    const liabilityPortions = liabilityWithPlan
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((liability) => ({
            liability,
            perCheque: getPerChequeLiability(liability),
        }))
        .filter(({ perCheque }) => perCheque > 0);

    const currentExpenseTotal = useMemo(
        () =>
            expensePortions.reduce((sum, { perCheque }) => sum + perCheque, 0),
        [expensePortions]
    );

    const currentLiabilityTotal = useMemo(
        () =>
            liabilityPortions.reduce(
                (sum, { perCheque }) => sum + perCheque,
                0
            ),
        [liabilityPortions]
    );

    const currentLeftOver =
        (currentPaycheque?.source.amount || 0) -
        currentExpenseTotal -
        currentLiabilityTotal;

    return (
        <div className="space-y-8">
            <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-500 text-white rounded-lg">
                    <Calculator size={20} />
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">
                        Budget
                    </h1>
                </div>
            </div>

            {currentPaycheque && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2 flex flex-wrap items-center justify-between gap-4 md:p-4">
                    <div className="order-1">
                        <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wide">
                            Current Cheque
                        </p>
                        <p className="text-lg font-bold text-slate-900">
                            {currentPaycheque.source.name}
                        </p>
                        <p className="text-xs text-slate-500">
                            {formatDate(currentPaycheque.date)}{" "}
                            {currentPaycheque.date.getFullYear()}
                        </p>
                    </div>
                    <div className="order-3 md:order-2 w-full md:w-auto md:flex-1 flex flex-wrap items-center gap-2 md:justify-center lg:gap-6 justify-center">
                        <div className="text-center">
                            <p className="text-xs text-slate-500">
                                Amount
                            </p>
                            <p className="text-s sm:text-xl font-bold text-emerald-700">
                                {currencySymbol}
                                {currentPaycheque.source.amount.toLocaleString()}
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs font-bold text-slate-500">-</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500">
                                Expenses
                            </p>
                            <p className="text-s sm:text-xl font-bold text-slate-900">
                                {currencySymbol}
                                {currentExpenseTotal.toLocaleString(
                                    undefined,
                                    {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    }
                                )}
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs font-bold text-slate-500">-</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500">
                                Liabilities
                            </p>
                            <p className="text-s sm:text-xl font-bold text-slate-900">
                                {currencySymbol}
                                {currentLiabilityTotal.toLocaleString(
                                    undefined,
                                    {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    }
                                )}
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs font-bold text-slate-500">=</p>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-slate-500">
                                Remaining
                            </p>
                            <p
                                className={`text-s sm:text-xl font-bold ${currentLeftOver >= 0
                                    ? "text-emerald-700"
                                    : "text-red-600"
                                    }`}
                            >
                                {currencySymbol}
                                {currentLeftOver.toLocaleString(
                                    undefined,
                                    {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    }
                                )}
                            </p>
                        </div>
                    </div>
                    <div className="order-2 md:order-3 flex flex-col items-center md:items-end space-y-2 ml-auto md:ml-0">
                        <div className="flex items-center justify-center space-x-2">
                            <button
                                type="button"
                                onClick={() =>
                                    setCurrentPaychequeIndex((idx) =>
                                        Math.max(0, idx - 1)
                                    )
                                }
                                disabled={currentPaychequeIndex === 0}
                                className={`p-2 rounded-md border ${currentPaychequeIndex === 0
                                    ? "text-slate-300 border-slate-200 cursor-not-allowed"
                                    : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                    }`}
                                aria-label="Previous paycheque"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    setCurrentPaychequeIndex((idx) =>
                                        Math.min(
                                            currentMonthPaycheques.length - 1,
                                            idx + 1
                                        )
                                    )
                                }
                                disabled={
                                    currentPaychequeIndex ===
                                    currentMonthPaycheques.length - 1
                                }
                                className={`p-2 rounded-md border ${currentPaychequeIndex ===
                                    currentMonthPaycheques.length - 1
                                    ? "text-slate-300 border-slate-200 cursor-not-allowed"
                                    : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                                    }`}
                                aria-label="Next paycheque"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                        <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-4">
                            <label className="flex items-center space-x-2 text-xs text-slate-500">
                                <span>Jump to</span>
                                <input
                                    type="date"
                                    className="px-2 py-1 border border-slate-300 rounded-md text-xs focus:ring-2 focus:ring-indigo-500"
                                    min={paychequeDateRange.min || undefined}
                                    max={paychequeDateRange.max || undefined}
                                    onChange={(e) => jumpToDate(e.target.value)}
                                />
                            </label>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <DollarSign size={18} className="text-slate-500" />
                            <h3 className="font-bold text-slate-800">Expenses</h3>
                        </div>
                        {expensePortions.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    const allChecked = expensePortions.every(
                                        ({ expense }) => expenseCheques[expense.id]
                                    );
                                    checkAllExpenses(!allChecked);
                                }}
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                            >
                                {expensePortions.every(
                                    ({ expense }) => expenseCheques[expense.id]
                                )
                                    ? "Uncheck All"
                                    : "Check All"}
                            </button>
                        )}
                    </div>
                    <div className="divide-y divide-slate-100">
                        {expensePortions.length === 0 ? (
                            <div className="p-6 text-sm text-slate-400">
                                Nothing scheduled for this cheque.
                            </div>
                        ) : (
                            expensePortions.map(({ expense, perCheque }) => (
                                <label
                                    key={expense.id}
                                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center space-x-3">
                                        {expenseCheques[expense.id] ? (
                                            <CheckSquare className="text-green-600" />
                                        ) : (
                                            <Square className="text-slate-400" />
                                        )}
                                        <div>
                                            <p className="font-medium text-slate-900">
                                                {expense.name}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                {expense.category ? expense.category : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-semibold text-slate-900">
                                            {currencySymbol}
                                            {perCheque.toLocaleString(
                                                undefined,
                                                {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                }
                                            )}
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={!!expenseCheques[expense.id]}
                                        onChange={() =>
                                            toggleExpense(expense.id)
                                        }
                                    />
                                </label>
                            ))
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <TrendingUp size={18} className="text-slate-500" />
                            <h3 className="font-bold text-slate-800">
                                Liability Minimums
                            </h3>
                            {budgetSchedule && (
                                <span className="ml-auto inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                    Month{" "}
                                    {scheduleMonthIndex ?? 1}
                                </span>
                            )}
                        </div>
                        {liabilityPortions.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    const allChecked = liabilityPortions.every(
                                        ({ liability }) => liabilityCheques[liability.id]
                                    );
                                    checkAllLiabilities(!allChecked);
                                }}
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                            >
                                {liabilityPortions.every(
                                    ({ liability }) => liabilityCheques[liability.id]
                                )
                                    ? "Uncheck All"
                                    : "Check All"}
                            </button>
                        )}
                    </div>
                    {budgetSchedule && !activeScheduleRow && (
                        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 text-sm text-amber-800 flex items-center justify-between">
                            <span>
                                Saved schedule is out of range for this month, so we are showing your standard minimums.
                            </span>
                            <button
                                type="button"
                                onClick={clearBudgetSchedule}
                                className="text-amber-800 font-semibold underline text-xs"
                            >
                                Clear schedule
                            </button>
                        </div>
                    )}
                    {/* {budgetSchedule && activeScheduleRow && (
                        <div className="px-6 py-3 bg-indigo-50 border-b border-indigo-100 text-sm text-indigo-900 flex items-center justify-between">
                            <span>
                                Using saved {budgetSchedule.strategyLabel} schedule (Month {activeScheduleRow.month} of{" "}
                                {budgetSchedule.timeline.length}).
                            </span>
                            <button
                                type="button"
                                onClick={clearBudgetSchedule}
                                className="text-indigo-900 font-semibold underline text-xs"
                            >
                                Clear schedule
                            </button>
                        </div>
                    )} */}
                    <div className="divide-y divide-slate-100">
                        {liabilityPortions.length === 0 ? (
                            <div className="p-6 text-sm text-slate-400">
                                Nothing scheduled for this cheque.
                            </div>
                        ) : (
                            liabilityPortions.map(({ liability, perCheque }) => (
                                <label
                                    key={liability.id}
                                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center space-x-3">
                                        {liabilityCheques[liability.id] ? (
                                            <CheckSquare className="text-green-600" />
                                        ) : (
                                            <Square className="text-slate-400" />
                                        )}
                                        <div>
                                            <p className="font-medium text-slate-900">
                                                {liability.name}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                {liability.category ? `${liability.category}` : ''}
                                                {liability.subtitle ? ` • ${liability.subtitle}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-semibold text-slate-900">
                                            {currencySymbol}
                                            {perCheque.toFixed(2)}
                                        </p>
                                        {extraByLiability[liability.id] && (
                                            <p className="text-xs text-emerald-600 font-medium">
                                                +{currencySymbol}
                                                {extraByLiability[
                                                    liability.id
                                                ].toFixed(2)}{" "}
                                                extra
                                            </p>
                                        )}
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={
                                            !!liabilityCheques[liability.id]
                                        }
                                        onChange={() =>
                                            toggleLiability(liability)
                                        }
                                    />
                                </label>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <Calendar size={18} className="text-slate-500" />
                        <h3 className="font-bold text-slate-800">
                            Extra Payments
                        </h3>
                    </div>
                    {extrasForCurrentCheque.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                const allChecked = extrasForCurrentCheque.every(p => p.isChecked);
                                checkAllExtras(!allChecked);
                            }}
                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                            {extrasForCurrentCheque.every(p => p.isChecked)
                                ? "Uncheck All"
                                : "Check All"}
                        </button>
                    )}
                </div>
                <form
                    onSubmit={addExtraPayment}
                    className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Liability
                        </label>
                        <select
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                            value={extraForm.liabilityId}
                            onChange={(e) =>
                                setExtraForm({
                                    ...extraForm,
                                    liabilityId: e.target.value,
                                })
                            }
                        >
                            <option value="">Select liability</option>
                            {liabilities
                                .slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((l) => (
                                    <option key={l.id} value={l.id}>
                                        {l.name}
                                        {l.category ? ` • (${l.category})` : ""}
                                        {l.subtitle ? ` - ${l.subtitle}` : ""}
                                    </option>
                                ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            Amount
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            value={extraForm.amount}
                            onChange={(e) =>
                                setExtraForm({
                                    ...extraForm,
                                    amount: parseFloat(e.target.value),
                                })
                            }
                        />
                    </div>
                    <div className="flex items-end">
                        <button
                            type="submit"
                            className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition-colors"
                        >
                            <Plus size={16} className="mr-2" />
                            Add Extra Payment
                        </button>
                    </div>
                </form>
                {extrasForCurrentCheque.length > 0 && (
                    <div className="px-6 pb-6 space-y-3">
                        {extrasForCurrentCheque.map((p) => {
                            const liability =
                                liabilities.find((l) => l.id === p.liabilityId) ||
                                null;
                            return (
                                <label
                                    key={p.id}
                                    className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"
                                >
                                    <div className="flex items-center space-x-3">
                                        {p.isChecked ? (
                                            <CheckSquare className="text-green-600" />
                                        ) : (
                                            <Square className="text-slate-400" />
                                        )}
                                        <div>
                                            <p className="font-medium text-slate-900">
                                                {liability?.name || "Liability"}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                Extra payment
                                            </p>
                                        </div>
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={!!p.isChecked}
                                        onChange={() => toggleExtraPayment(p)}
                                    />
                                    <div className="flex items-center space-x-3">
                                        <p className="font-semibold text-emerald-700">
                                            {currencySymbol}
                                            {p.amount.toFixed(2)}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteExtraPayment(p.id);
                                            }}
                                            className="text-xs text-red-500 hover:text-red-700 font-semibold"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Budget;
