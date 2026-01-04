import React, { useEffect, useMemo, useState } from "react";
import {
    Expense,
    IncomeSource,
    Liability,
    PayoffMonth,
    UserSettings,
    ExpenseSplitMethod,
} from "../types";
import {
    calculateMonthlyIncome,
    getMinPayment,
} from "../server/liabilityAlgorithms";
import {
    CheckSquare,
    Square,
    DollarSign,
    Calendar,
    TrendingUp,
    Plus,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";

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
};

type SavedSchedule = {
    strategy: string;
    strategyLabel: string;
    savedAt: string;
    monthlyBudget: number;
    timeline: PayoffMonth[];
};

const STORAGE_KEY = "budget-checklist";
const SCHEDULE_STORAGE_KEY = "budget-liability-plan";

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

    const [expenseChecksByCheck, setExpenseChecksByCheck] = useState<
        Record<string, Record<string, boolean>>
    >({});
    const [liabilityChecksByCheck, setLiabilityChecksByCheck] = useState<
        Record<string, Record<string, boolean>>
    >({});
    const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
    const [extraForm, setExtraForm] = useState<{
        liabilityId: string;
        amount: number;
    }>({ liabilityId: "", amount: 0 });
    const [currentPaycheckIndex, setCurrentPaycheckIndex] = useState(0);
    const [budgetSchedule, setBudgetSchedule] = useState<SavedSchedule | null>(
        null
    );
    const [scheduleMonthIndex, setScheduleMonthIndex] = useState<number | null>(
        null
    );

    useEffect(() => {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            setExpenseChecksByCheck(parsed.expenseChecksByCheck || {});
            setLiabilityChecksByCheck(parsed.liabilityChecksByCheck || {});
            setExtraPayments(parsed.extraPayments || []);
        } catch {
            /* ignore corrupt storage */
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                expenseChecksByCheck,
                liabilityChecksByCheck,
                extraPayments,
            })
        );
    }, [expenseChecksByCheck, liabilityChecksByCheck, extraPayments]);

    useEffect(() => {
        const rawSchedule = localStorage.getItem(SCHEDULE_STORAGE_KEY);
        if (!rawSchedule) {
            setBudgetSchedule(null);
            setScheduleMonthIndex(null);
            return;
        }
        try {
            const parsed = JSON.parse(rawSchedule) as SavedSchedule;
            if (!parsed?.timeline?.length) {
                setBudgetSchedule(null);
                setScheduleMonthIndex(null);
                return;
            }
            setBudgetSchedule(parsed);
            const savedDate = new Date(parsed.savedAt);
            const today = new Date();
            if (Number.isNaN(savedDate.getTime())) {
                setScheduleMonthIndex(1);
                return;
            }
            const savedMonthCount =
                savedDate.getFullYear() * 12 + savedDate.getMonth();
            const currentMonthCount =
                today.getFullYear() * 12 + today.getMonth();
            setScheduleMonthIndex(
                Math.max(1, currentMonthCount - savedMonthCount + 1)
            );
        } catch {
            setBudgetSchedule(null);
            setScheduleMonthIndex(null);
        }
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
            const mine = calculateMonthlyIncome(
                budgetedIncomes.filter((i) => !i.isPartner)
            );
            const partner = calculateMonthlyIncome(
                budgetedIncomes.filter((i) => i.isPartner)
            );
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
        const monthlyEquivalent = b.frequency === "BI_WEEKLY" ? b.amount * 2 : b.amount;
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

    const liabilityWithMins = liabilities.map((d) => {
        const monthlyInterest = d.balance * (d.interestRate / 100 / 12);
        const estFee = d.isFeeMonthly ? d.annualFee / 12 : 0;
        const rawMin = getMinPayment(d, d.balance, monthlyInterest, estFee);
        const minPayment = Number.isFinite(rawMin) ? rawMin : 0;
        return { ...d, minPayment };
    });

    const liabilityWithPlan = liabilityWithMins.map((d) => ({
        ...d,
        scheduledFrequency: getLiabilityFrequency(d),
        plannedPayment:
            plannedPaymentsByLiability[d.id] !== undefined
                ? plannedPaymentsByLiability[d.id]
                : d.minPayment,
    }));

    const totalLiabilityPayments = liabilityWithPlan.reduce(
        (sum, d) => sum + d.plannedPayment,
        0
    );

    const totalNeeded = totalExpenses + totalLiabilityPayments;
    const currencySymbol = userSettings?.currencySymbol || "$";

    const hasBiWeeklyExpense = expenses.some(
        (e) => e.frequency === "BI_WEEKLY"
    );
    const hasBiWeeklyLiability = liabilityWithPlan.some(
        (l) => l.scheduledFrequency === "BI_WEEKLY"
    );

    // Generate paychecks occurring in the current month
    const currentMonthPaychecks = useMemo(() => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        const getPayDates = (
            source: IncomeSource,
            startDate: Date,
            endDate: Date
        ): Date[] => {
            const dates: Date[] = [];
            const [y, m, d] = source.nextPayDate.split("-").map(Number);
            let current = new Date(y, m - 1, d);

            // Backtrack to ensure we have the current month's occurrence
            let iterations = 0;
            while (current > startDate && iterations < 500) {
                const prev = new Date(current);
                switch (source.frequency) {
                    case "WEEKLY":
                        prev.setDate(prev.getDate() - 7);
                        break;
                    case "BI_WEEKLY":
                        prev.setDate(prev.getDate() - 14);
                        break;
                    case "SEMI_MONTHLY":
                        prev.setDate(prev.getDate() - 15);
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
            while (current <= endDate && iterations < 1000) {
                iterations++;
                if (current >= startDate) {
                    dates.push(new Date(current));
                }

                switch (source.frequency) {
                    case "WEEKLY":
                        current.setDate(current.getDate() + 7);
                        break;
                    case "BI_WEEKLY":
                        current.setDate(current.getDate() + 14);
                        break;
                    case "SEMI_MONTHLY":
                        current.setDate(current.getDate() + 15);
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

        const occurrences: {
            date: Date;
            source: IncomeSource;
            eligible: boolean;
            eligibleMonthly: boolean;
            eligibleBiWeekly: boolean;
        }[] = [];
        budgetedIncomes.forEach((src) => {
            const dates = getPayDates(src, start, end).sort(
                (a, b) => a.getTime() - b.getTime()
            );
            dates.forEach((date, idx) =>
                occurrences.push({
                    date,
                    source: src,
                    eligibleMonthly:
						src.includeFirstTwoChecks === true ? idx < 2 : true,
                    eligibleBiWeekly: true,
                    eligible: true,
                })
            );
        });

        return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [budgetedIncomes, hasBiWeeklyExpense, hasBiWeeklyLiability]);

    const paycheckCount = currentMonthPaychecks.length || 1;
    useEffect(() => {
        if (currentMonthPaychecks.length === 0) {
            setCurrentPaycheckIndex(0);
            return;
        }
        const today = new Date();
        const nextIdx = currentMonthPaychecks.findIndex(
            (p) => p.date >= today
        );
        const idx =
            nextIdx >= 0 ? nextIdx : currentMonthPaychecks.length - 1;
        setCurrentPaycheckIndex(idx);
    }, [currentMonthPaychecks]);

    const currentPaycheck =
        currentMonthPaychecks[currentPaycheckIndex] || null;
    const currentCheckKey =
        currentPaycheck?.date.toISOString().split("T")[0] || "default-check";
    const expenseChecks = expenseChecksByCheck[currentCheckKey] || {};
    const liabilityChecks = liabilityChecksByCheck[currentCheckKey] || {};

    const currentOwnerIsPartner = currentPaycheck?.source.isPartner;
    const toggleExpense = (id: string) => {
        setExpenseChecksByCheck((prev) => {
            const nextForCheck = { ...(prev[currentCheckKey] || {}) };
            nextForCheck[id] = !nextForCheck[id];
            return { ...prev, [currentCheckKey]: nextForCheck };
        });
    };

    const applyLiabilityPayment = async (
        liability: Liability & { plannedPayment: number }
    ) => {
        if (!onUpdateLiability) return;
        const original = liabilities.find((l) => l.id === liability.id);
        if (!original) return;
        const portion = getPerCheckLiability(liability);
        if (portion <= 0) return;
        const updated: Liability = {
            ...original,
            balance: Math.max(0, original.balance - portion),
        };
        try {
            await onUpdateLiability(updated);
        } catch {
            /* silently ignore budget-only errors */
        }
    };

    const toggleLiability = (liability: Liability & { plannedPayment: number }) => {
        setLiabilityChecksByCheck((prev) => {
            const nextForCheck = { ...(prev[currentCheckKey] || {}) };
            nextForCheck[liability.id] = !nextForCheck[liability.id];
            const willCheck = nextForCheck[liability.id];
            if (willCheck) {
                applyLiabilityPayment(liability);
            }
            return { ...prev, [currentCheckKey]: nextForCheck };
        });
    };

    const clearBudgetSchedule = () => {
        localStorage.removeItem(SCHEDULE_STORAGE_KEY);
        setBudgetSchedule(null);
        setScheduleMonthIndex(null);
    };

    const addExtraPayment = (e: React.FormEvent) => {
        e.preventDefault();
        if (!extraForm.liabilityId || extraForm.amount <= 0) return;
        setExtraPayments((prev) => [
            ...prev,
            {
                id: Math.random().toString(36).slice(2, 9),
                liabilityId: extraForm.liabilityId,
                amount: extraForm.amount,
            },
        ]);
        setExtraForm({ liabilityId: "", amount: 0 });
    };

    const extraByLiability = extraPayments.reduce<Record<string, number>>(
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

    // Income-weighted allocation: monthly items use monthly-eligible income; bi-weekly items use all income
    const monthlyExpensesTotal = expenses
        .filter((e) => e.frequency !== "BI_WEEKLY")
        .reduce(
            (sum, e) => sum + e.amount * getExpenseShare(e),
            0
        );
    const biWeeklyExpensesTotal = expenses
        .filter((e) => e.frequency === "BI_WEEKLY")
        .reduce(
            (sum, e) => sum + e.amount * 2 * getExpenseShare(e),
            0
        );

    const monthlyLiabilityTotal = liabilityWithPlan
        .filter((l) => l.scheduledFrequency !== "BI_WEEKLY")
        .reduce((sum, l) => sum + l.plannedPayment, 0);
    const biWeeklyLiabilityTotal = liabilityWithPlan
        .filter((l) => l.scheduledFrequency === "BI_WEEKLY")
        .reduce((sum, l) => sum + l.plannedPayment, 0);

    const monthlyNeed = monthlyExpensesTotal + monthlyLiabilityTotal;
    const biWeeklyNeed = biWeeklyExpensesTotal + biWeeklyLiabilityTotal;

    const totalMonthlyIncomeIncluded = currentMonthPaychecks
        .filter((p) => p.eligibleMonthly !== false)
        .reduce((sum, p) => sum + p.source.amount, 0);
    const totalBiWeeklyIncomeIncluded = currentMonthPaychecks
        .filter((p) => p.eligibleBiWeekly !== false)
        .reduce((sum, p) => sum + p.source.amount, 0);
    const totalAnyIncomeIncluded = currentMonthPaychecks.reduce(
        (sum, p) => sum + p.source.amount,
        0
    );

    const monthlyPool =
        totalMonthlyIncomeIncluded > 0
            ? totalMonthlyIncomeIncluded
            : totalAnyIncomeIncluded;
    const biWeeklyPool =
        totalBiWeeklyIncomeIncluded > 0
            ? totalBiWeeklyIncomeIncluded
            : totalAnyIncomeIncluded;

    const monthlyPoolUser = currentMonthPaychecks
        .filter((p) => p.eligibleMonthly !== false && !p.source.isPartner)
        .reduce((sum, p) => sum + p.source.amount, 0);
    const monthlyPoolPartner = currentMonthPaychecks
        .filter((p) => p.eligibleMonthly !== false && p.source.isPartner)
        .reduce((sum, p) => sum + p.source.amount, 0);
    const biWeeklyPoolUser = currentMonthPaychecks
        .filter((p) => p.eligibleBiWeekly !== false && !p.source.isPartner)
        .reduce((sum, p) => sum + p.source.amount, 0);
    const biWeeklyPoolPartner = currentMonthPaychecks
        .filter((p) => p.eligibleBiWeekly !== false && p.source.isPartner)
        .reduce((sum, p) => sum + p.source.amount, 0);

    const monthlyRatio =
        (currentPaycheck?.eligibleMonthly !== false && monthlyPool > 0)
            ? (currentPaycheck?.source.amount || 0) / monthlyPool
            : 0;
    const biWeeklyRatio =
        (currentPaycheck?.eligibleBiWeekly !== false && biWeeklyPool > 0)
            ? (currentPaycheck?.source.amount || 0) / biWeeklyPool
            : 0;

    const monthlyRatioOwner =
        currentPaycheck?.eligibleMonthly === false
            ? 0
            : currentPaycheck?.source.isPartner
            ? monthlyPoolPartner > 0
                ? (currentPaycheck?.source.amount || 0) / monthlyPoolPartner
                : monthlyRatio
            : monthlyPoolUser > 0
            ? (currentPaycheck?.source.amount || 0) / monthlyPoolUser
            : monthlyRatio;

    const biWeeklyRatioOwner =
        currentPaycheck?.eligibleBiWeekly === false
            ? 0
            : currentPaycheck?.source.isPartner
            ? biWeeklyPoolPartner > 0
                ? (currentPaycheck?.source.amount || 0) / biWeeklyPoolPartner
                : biWeeklyRatio
            : biWeeklyPoolUser > 0
            ? (currentPaycheck?.source.amount || 0) / biWeeklyPoolUser
            : biWeeklyRatio;

    const perPaycheckSetAside =
        monthlyNeed * monthlyRatio + biWeeklyNeed * biWeeklyRatio;

    const getPerCheckExpense = (expense: Expense) => {
        const owner = expense.owner || "JOINT";
        const monthlyEquivalent =
            expense.frequency === "BI_WEEKLY"
                ? expense.amount * 2
                : expense.amount;

        if (owner === "PARTNER") {
            if (!currentPaycheck?.source.isPartner) return 0;
            return expense.frequency === "BI_WEEKLY"
                ? monthlyEquivalent * biWeeklyRatioOwner
                : monthlyEquivalent * monthlyRatioOwner;
        }

        if (owner === "USER") {
            if (currentPaycheck?.source.isPartner) return 0;
            return expense.frequency === "BI_WEEKLY"
                ? monthlyEquivalent * biWeeklyRatioOwner
                : monthlyEquivalent * monthlyRatioOwner;
        }

        // Joint: split by configured ratio and allocate only to the corresponding partner's paychecks
        const userPortion = monthlyEquivalent * userSplitRatio;
        const partnerPortion = monthlyEquivalent - userPortion;

        if (currentPaycheck?.source.isPartner) {
            return expense.frequency === "BI_WEEKLY"
                ? partnerPortion * biWeeklyRatioOwner
                : partnerPortion * monthlyRatioOwner;
        }

        return expense.frequency === "BI_WEEKLY"
            ? userPortion * biWeeklyRatioOwner
            : userPortion * monthlyRatioOwner;
    };

    const getPerCheckLiability = (
        liability: Liability & {
            plannedPayment: number;
            scheduledFrequency?: Liability["paymentFrequency"];
        }
    ) => {
        const frequency =
            liability.scheduledFrequency || getLiabilityFrequency(liability);
        if (frequency === "BI_WEEKLY") {
            return (liability.plannedPayment || 0) * biWeeklyRatio;
        }
        if (currentPaycheck?.eligibleMonthly === false) return 0;
        return (liability.plannedPayment || 0) * monthlyRatio;
    };

    const expensePortions = expenses
        .slice()
        .sort((a, b) => a.dueDate - b.dueDate)
        .map((expense) => ({
            expense,
            perCheck: getPerCheckExpense(expense),
        }))
        .filter(({ perCheck }) => perCheck > 0);

    const liabilityPortions = liabilityWithPlan
        .slice()
        .sort((a, b) => a.dueDate - b.dueDate)
        .map((liability) => ({
            liability,
            perCheck: getPerCheckLiability(liability),
        }))
        .filter(({ perCheck }) => perCheck > 0);

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">
                        Budget
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Plan each paycheck to cover expenses and minimum
                        payments, and track what’s done.
                    </p>
                </div>
            </div>

            {currentPaycheck && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wide">
                            Current Check
                        </p>
                        <p className="text-lg font-bold text-slate-900">
                            {currentPaycheck.source.name}
                        </p>
                        <p className="text-xs text-slate-500">
                            {formatDate(currentPaycheck.date)}
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-sm text-slate-500">Amount</p>
                        <p className="text-2xl font-bold text-emerald-700">
                            {currencySymbol}
                            {currentPaycheck.source.amount.toLocaleString()}
                        </p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <button
                            type="button"
                            onClick={() =>
                                setCurrentPaycheckIndex((idx) =>
                                    Math.max(0, idx - 1)
                                )
                            }
                            disabled={currentPaycheckIndex === 0}
                            className={`p-2 rounded-md border ${
                                currentPaycheckIndex === 0
                                    ? "text-slate-300 border-slate-200 cursor-not-allowed"
                                    : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                            }`}
                            aria-label="Previous paycheck"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                setCurrentPaycheckIndex((idx) =>
                                    Math.min(
                                        currentMonthPaychecks.length - 1,
                                        idx + 1
                                    )
                                )
                            }
                            disabled={
                                currentPaycheckIndex ===
                                currentMonthPaychecks.length - 1
                            }
                            className={`p-2 rounded-md border ${
                                currentPaycheckIndex ===
                                currentMonthPaychecks.length - 1
                                    ? "text-slate-300 border-slate-200 cursor-not-allowed"
                                    : "text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                            }`}
                            aria-label="Next paycheck"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center space-x-2">
                        <DollarSign size={18} className="text-slate-500" />
                        <h3 className="font-bold text-slate-800">Expenses</h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {expensePortions.length === 0 ? (
                            <div className="p-6 text-sm text-slate-400">
                                Nothing scheduled for this check.
                            </div>
                        ) : (
                            expensePortions.map(({ expense, perCheck }) => (
                                <label
                                    key={expense.id}
                                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center space-x-3">
                                        {expenseChecks[expense.id] ? (
                                            <CheckSquare className="text-green-600" />
                                        ) : (
                                            <Square className="text-slate-400" />
                                        )}
                                        <div>
                                            <p className="font-medium text-slate-900">
                                                {expense.name}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                Due {expense.dueDate} •{" "}
                                                {expense.frequency === "MONTHLY"
                                                    ? "Monthly"
                                                    : "Bi-Weekly"}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-semibold text-slate-900">
                                            {currencySymbol}
                                            {perCheck.toLocaleString(
                                                undefined,
                                                {
                                                    maximumFractionDigits: 2,
                                                }
                                            )}
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            This check portion
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={!!expenseChecks[expense.id]}
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
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center space-x-2">
                        <TrendingUp size={18} className="text-slate-500" />
                        <h3 className="font-bold text-slate-800">
                            Liability Minimums
                        </h3>
                        {budgetSchedule && (
                            <span className="ml-3 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                                {budgetSchedule.strategyLabel} • Month{" "}
                                {scheduleMonthIndex ?? 1}
                            </span>
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
                                Nothing scheduled for this check.
                            </div>
                        ) : (
                            liabilityPortions.map(({ liability, perCheck }) => (
                                <label
                                    key={liability.id}
                                    className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center space-x-3">
                                        {liabilityChecks[liability.id] ? (
                                            <CheckSquare className="text-green-600" />
                                        ) : (
                                            <Square className="text-slate-400" />
                                        )}
                                        <div>
                                            <p className="font-medium text-slate-900">
                                                {liability.name}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                Due {liability.dueDate} •{" "}
                                                {liability.interestRate}% APR
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-semibold text-slate-900">
                                            {currencySymbol}
                                            {perCheck.toFixed(2)}
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
                                        <p className="text-xs text-slate-400">
                                            This check portion
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={
                                            !!liabilityChecks[liability.id]
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
                            Extra Debt Payments
                        </h3>
                    </div>
                    <div className="text-sm text-slate-500">
                        Track additional payments without altering balances.
                    </div>
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
                            {liabilities.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
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
                {extraPayments.length > 0 && (
                    <div className="px-6 pb-6 space-y-3">
                        {extraPayments.map((p) => {
                            const liability =
                                liabilities.find((l) => l.id === p.liabilityId) ||
                                null;
                            return (
                                <div
                                    key={p.id}
                                    className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg"
                                >
                                    <div>
                                        <p className="font-medium text-slate-900">
                                            {liability?.name || "Liability"}
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            Extra payment
                                        </p>
                                    </div>
                                    <p className="font-semibold text-emerald-700">
                                        {currencySymbol}
                                        {p.amount.toFixed(2)}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Budget;
