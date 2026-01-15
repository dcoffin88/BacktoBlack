import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Liability,
    Ownership,
    UserSettings,
    BudgetSchedule,
    IncomeSource,
} from "../types";
import {
    calculateIndividualAmortization,
    AmortizationRow,
    getMinPayment,
} from "../server/liabilityAlgorithms";
import {
    Plus,
    Trash2,
    Edit2,
    X,
    Save,
    FileText,
    AlertTriangle,
    DollarSign,
    Percent,
    Info,
    Calendar,
    GripVertical,
    ChevronDown,
    ChevronUp,
    User,
    Users,
    CheckCircle,
    Settings,
} from "lucide-react";
import { dbAPI } from "../server/db";

type ExtraPayment = {
    id: string;
    liabilityId: string;
    amount: number;
    checkDate?: string | null;
};

const parseLocalDate = (value?: string | null) => {
    if (!value) return null;
    const d = value.includes("T")
        ? new Date(value)
        : new Date(`${value}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
};

type AmortizationDataView = {
    isInfinite: boolean;
    timeline: AmortizationRow[];
    totalInterest: number;
    totalFees: number;
    months: number;
};

type AmortizationTableMemoProps = {
    amortizationData: AmortizationDataView;
    viewingLiability: Liability;
    paymentsByCheckDate: Map<string, ExtraPayment>;
    amortizationOverridesForViewing: Record<
        number,
        {
            payment: number;
            interest: number;
            purchase?: number;
            checkDate?: string | null;
        }
    >;
    minimumPaidByPeriod: Record<number, number>;
    editingAmortizationRow: number | null;
    amortizationEdit: { payment: string; interest: string };
    amortizationEditPurchase: string;
    amortizationEditDate: string;
    setAmortizationEditDate: React.Dispatch<React.SetStateAction<string>>;
    children: React.ReactNode;
};

const AmortizationTable = React.memo(
    ({ children }: AmortizationTableMemoProps) => <>{children}</>,
    (prev, next) =>
        prev.amortizationData === next.amortizationData &&
        prev.viewingLiability === next.viewingLiability &&
        prev.paymentsByCheckDate === next.paymentsByCheckDate &&
        prev.amortizationOverridesForViewing ===
            next.amortizationOverridesForViewing &&
        prev.minimumPaidByPeriod === next.minimumPaidByPeriod &&
        prev.editingAmortizationRow === next.editingAmortizationRow &&
        prev.amortizationEdit === next.amortizationEdit &&
        prev.amortizationEditPurchase === next.amortizationEditPurchase &&
        prev.amortizationEditDate === next.amortizationEditDate
);

interface LiabilityListProps {
    liabilities: Liability[];
    onSave: (liability: Liability) => void;
    onDelete: (id: string) => void;
    settings?: UserSettings;
    incomes?: IncomeSource[];
}

const LiabilityList: React.FC<LiabilityListProps> = ({
    liabilities,
    onSave,
    onDelete,
    settings,
    incomes = [],
}) => {
    // Modal States
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isAmortizationOpen, setIsAmortizationOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // UI Toggles for Form
    const [enablePercent, setEnablePercent] = useState(true);
    const [enableFixed, setEnableFixed] = useState(false);
    const [enableFloor, setEnableFloor] = useState(true);
    const [enableAnnualFee, setEnableAnnualFee] = useState(false);

    const openSection = (section: "details" | "min" | "fee", next: boolean) => {
        if (section === "details") {
            setExpandLiabilityDetails(next);
        }
        if (section === "min") {
            setExpandMinPayment(next);
        }
        if (section === "fee") {
            setExpandAnnualFee(next);
        }
        if (next) {
            // Close the others
            if (section !== "details") setExpandLiabilityDetails(false);
            if (section !== "min") setExpandMinPayment(false);
            if (section !== "fee") setExpandAnnualFee(false);
        }
    };
    // Collapsible Sections
    const [expandLiabilityDetails, setExpandLiabilityDetails] = useState(false);
    const [expandMinPayment, setExpandMinPayment] = useState(false);
    const [expandAnnualFee, setExpandAnnualFee] = useState(false);

    // Selection States
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewingLiability, setViewingLiability] = useState<Liability | null>(
        null
    );
    const [amortizationData, setAmortizationData] = useState<{
        isInfinite: boolean;
        timeline: AmortizationRow[];
        totalInterest: number;
        totalFees: number;
        months: number;
    } | null>(null);
    const historicalDateRef = useRef<HTMLInputElement | null>(null);
    const historicalAmountRef = useRef<HTMLInputElement | null>(null);
    const historicalPurchaseRef = useRef<HTMLInputElement | null>(null);
    const historicalInterestRef = useRef<HTMLInputElement | null>(null);
    const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
    const [historicalPaymentError, setHistoricalPaymentError] = useState<
        string | null
    >(null);
    const [editingPaymentId, setEditingPaymentId] = useState<string | null>(
        null
    );
    const [editPayment, setEditPayment] = useState<{
        amount: number;
        date: string;
    }>({
        amount: 0,
        date: "",
    });
    const [editPaymentInterest, setEditPaymentInterest] = useState(0);
    const [editPaymentPurchase, setEditPaymentPurchase] = useState(0);
    const [editingAmortizationRow, setEditingAmortizationRow] = useState<
        number | null
    >(null);
    const [amortizationEdit, setAmortizationEdit] = useState<{
        payment: string;
        interest: string;
    }>({
        payment: "",
        interest: "",
    });
    const [amortizationEditPurchase, setAmortizationEditPurchase] =
        useState("0");
    const [amortizationEditDate, setAmortizationEditDate] = useState("");
    const [amortizationOverrides, setAmortizationOverrides] = useState<
        Record<
            string,
            Record<
                number,
                {
                    payment: number;
                    interest: number;
                    purchase?: number;
                    checkDate?: string | null;
                }
            >
        >
    >({});
    const isMinimumPaymentId = (id: string) => id.startsWith("min-");
    const [savedSchedule, setSavedSchedule] = useState<BudgetSchedule | null>(
        null
    );
    const [priorityMap, setPriorityMap] = useState<Record<string, number>>({});
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        let active = true;
        const loadExtras = async () => {
            try {
                const remote = await dbAPI.getExtraPayments();
                if (!active || !remote?.extras) return;
                setExtraPayments(remote.extras || []);
            } catch {
                /* ignore fetch errors */
            }
        };
        loadExtras();
        const loadOverrides = async () => {
            try {
                const remote = await dbAPI.getAmortizationOverrides();
                if (!active || !remote?.overrides) return;
                const mapped = remote.overrides.reduce<
                    Record<
                        string,
                        Record<
                            number,
                            {
                                payment: number;
                                interest: number;
                                purchase?: number;
                                checkDate?: string | null;
                            }
                        >
                    >
                >((acc, row) => {
                    if (!acc[row.liabilityId]) {
                        acc[row.liabilityId] = {};
                    }
                    acc[row.liabilityId][row.period] = {
                        payment: row.payment,
                        interest: row.interest,
                        purchase: row.purchase ?? 0,
                        checkDate: row.checkDate ?? null,
                    };
                    return acc;
                }, {});
                setAmortizationOverrides(mapped);
            } catch {
                /* ignore override fetch errors */
            }
        };
        loadOverrides();
        const loadSchedule = async () => {
            try {
                const remote = await dbAPI.getBudgetSchedule();
                if (!active) return;
                setSavedSchedule(remote?.schedule || null);
            } catch {
                /* ignore schedule fetch errors */
            }
        };
        loadSchedule();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        setPriorityMap(() => {
            const next: Record<string, number> = {};
            liabilities.forEach((l, idx) => {
                next[l.id] = l.customOrder || idx + 1;
            });
            return next;
        });
    }, [liabilities]);

    const orderedPriorityIds = useMemo(() => {
        const enriched = liabilities.map((l, idx) => ({
            id: l.id,
            order: priorityMap[l.id] ?? idx + 1,
        }));
        enriched.sort((a, b) => a.order - b.order);
        return enriched.map((e) => e.id);
    }, [liabilities, priorityMap]);

    const addDays = (date: Date, days: number) => {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return d;
    };
    const addMonths = (date: Date, months: number) => {
        const d = new Date(date);
        d.setMonth(d.getMonth() + months);
        return d;
    };
    const getDueDayForMonth = (
        year: number,
        monthIndex: number,
        dueDay: number
    ) => {
        const lastDay = new Date(year, monthIndex + 1, 0).getDate();
        if (dueDay === 30) return lastDay;
        return Math.min(Math.max(1, dueDay), lastDay);
    };
    const getNextDueDateForDay = (dueDay: number) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let year = today.getFullYear();
        let month = today.getMonth();
        let target = new Date(
            year,
            month,
            getDueDayForMonth(year, month, dueDay)
        );
        if (target < today) {
            month += 1;
            if (month > 11) {
                month = 0;
                year += 1;
            }
            target = new Date(
                year,
                month,
                getDueDayForMonth(year, month, dueDay)
            );
        }
        return toLocalDateString(target);
    };

    const getScheduleAnchorDate = (liability: Liability) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = parseLocalDate(liability.startDate);
        if (start) {
            start.setHours(0, 0, 0, 0);
            if (start > today) return start;
        }
        return today;
    };

    const getPaymentAnchorDate = (liability: Liability) => {
        const parsed = parseLocalDate(liability.nextDueDate);
        if (parsed) {
            parsed.setHours(0, 0, 0, 0);
            return parsed;
        }
        const start = parseLocalDate(liability.startDate);
        const base = start || new Date();
        const dueDay = getDueDayForMonth(
            base.getFullYear(),
            base.getMonth(),
            liability.dueDate || 1
        );
        const anchor = new Date(base.getFullYear(), base.getMonth(), dueDay);
        anchor.setHours(0, 0, 0, 0);
        return anchor;
    };

    const getProjectedRowDate = (
        liability: Liability,
        rowIndex: number,
        today: Date
    ) => {
        const start = parseLocalDate(liability.startDate);
        if (start) start.setHours(0, 0, 0, 0);
        const useFutureStart = !!(start && start > today);
        const isBiWeekly = liability.paymentFrequency === "BI_WEEKLY";
        const isWeekly = liability.paymentFrequency === "WEEKLY";
        const intervalDays = isBiWeekly ? 14 : isWeekly ? 7 : null;
        let anchor = getPaymentAnchorDate(liability);

        if (intervalDays) {
            let guard = 0;
            if (useFutureStart) {
                while (anchor < (start || today) && guard < 500) {
                    anchor = addDays(anchor, intervalDays);
                    guard++;
                }
            }
            return addDays(anchor, (rowIndex - 1) * intervalDays);
        }

        let guard = 0;
        if (useFutureStart) {
            while (anchor < (start || today) && guard < 120) {
                const nextMonth = new Date(
                    anchor.getFullYear(),
                    anchor.getMonth() + 1,
                    1
                );
                anchor = new Date(
                    nextMonth.getFullYear(),
                    nextMonth.getMonth(),
                    getDueDayForMonth(
                        nextMonth.getFullYear(),
                        nextMonth.getMonth(),
                        liability.dueDate || anchor.getDate()
                    )
                );
                guard++;
            }
        }
        const targetMonth = new Date(
            anchor.getFullYear(),
            anchor.getMonth() + rowIndex - 1,
            1
        );
        return new Date(
            targetMonth.getFullYear(),
            targetMonth.getMonth(),
            getDueDayForMonth(
                targetMonth.getFullYear(),
                targetMonth.getMonth(),
                liability.dueDate || anchor.getDate()
            )
        );
    };

    const buildAmortizationInputs = (liability: Liability) => {
        const overridesForLiability = amortizationOverrides[liability.id] || {};
        const extrasMap = Object.entries(overridesForLiability).reduce<
            Record<
                number,
                {
                    amount: number;
                    checkDate?: string | null;
                    forceHistorical?: boolean;
                    interest?: number;
                }
            >
        >((acc, [periodKey, override]) => {
            const period = Number(periodKey);
            if (!Number.isFinite(period)) return acc;
            const amount = (override.payment || 0) - (override.purchase || 0);
            acc[period] = {
                amount,
                checkDate: override.checkDate || null,
                interest: override.interest,
            };
            return acc;
        }, {});

        const mergedExtras = extraPayments
            .filter(
                (p) =>
                    p.liabilityId === liability.id && !isMinimumPaymentId(p.id)
            )
            .reduce<
                Record<
                    number,
                    {
                        amount: number;
                        checkDate?: string | null;
                        forceHistorical?: boolean;
                        interest?: number;
                    }
                >
            >((acc, p) => {
                const parsedDate = parseLocalDate(p.checkDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const isPast = parsedDate ? parsedDate <= today : false;

                // Use the period index from date; keep historical periods (<= 0) so they render before payment #1.
                const rawPeriod = getPeriodIndexFromDate(
                    liability,
                    p.checkDate
                );
                if (rawPeriod === null || rawPeriod === undefined) return acc;
                const period = rawPeriod;
                const override = overridesForLiability[period];

                acc[period] = {
                    amount: (acc[period]?.amount || 0) + p.amount,
                    checkDate: p.checkDate || acc[period]?.checkDate,
                    forceHistorical: isPast,
                    interest: override?.interest,
                };
                return acc;
            }, {});
        const extrasMapMerged = { ...extrasMap, ...mergedExtras };

        const planPaymentsMap = (() => {
            if (!savedSchedule?.timeline?.length) return {};
            const scheduleMonthIndex = getScheduleMonthIndex(
                savedSchedule.savedAt
            );
            const offset = scheduleMonthIndex - 1;
            const map: Record<number, number> = {};
            savedSchedule.timeline.forEach((row) => {
                const period = row.month - offset;
                if (period < 1) return;
                const paymentEntry = row.breakdown?.find(
                    (b) => b.liabilityId === liability.id
                );
                const pay = paymentEntry?.payment || 0;
                if (pay > 0) {
                    map[period] = pay;
                }
            });
            return map;
        })();

        return { extrasMapMerged, planPaymentsMap };
    };

    const getPeriodIndexFromDate = (
        liability: Liability,
        checkDate?: string | null
    ) => {
        const target = parseLocalDate(checkDate);
        if (!target) return null;
        target.setHours(0, 0, 0, 0);
        let anchor = getPaymentAnchorDate(liability);
        const freq = liability.paymentFrequency || "MONTHLY";

        if (freq === "WEEKLY" || freq === "BI_WEEKLY") {
            const intervalDays = freq === "WEEKLY" ? 7 : 14;
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
                anchor = new Date(
                    anchor.getFullYear(),
                    anchor.getMonth() + 1,
                    anchor.getDate()
                );
                guard++;
            }
        }
        const previousAnchor = addMonths(anchor, -1);
        if (target.getTime() === previousAnchor.getTime()) {
            return 0;
        }
        if (
            target.getFullYear() === previousAnchor.getFullYear() &&
            target.getMonth() === previousAnchor.getMonth()
        ) {
            return 1;
        }
        if (target >= previousAnchor && target < anchor) {
            return 1;
        }
        let period = 1;
        let cursor = new Date(anchor);
        let guard = 0;
        while (cursor < target && guard < 120) {
            cursor = addMonths(cursor, 1);
            period += 1;
            guard++;
        }
        while (cursor > target && guard < 240) {
            cursor = addMonths(cursor, -1);
            period -= 1;
            guard++;
        }
        return period;
    };

    const pDate = (date?: string | null) => {
        const parsed = parseLocalDate(date);
        return parsed ? parsed.getTime() : 0;
    };

    const getHistoricalPaidAmount = (liability: Liability) => {
        return extraPayments
            .filter(
                (p) =>
                    p.liabilityId === liability.id && !isMinimumPaymentId(p.id)
            )
            .reduce((sum, p) => sum + (p.amount || 0), 0);
    };

    const getTotalPaidAmount = (liability: Liability) => {
        return extraPayments
            .filter(
                (p) =>
                    p.liabilityId === liability.id &&
                    !isMinimumPaymentId(p.id) &&
                    (p.amount || 0) > 0
            )
            .reduce((sum, p) => sum + (p.amount || 0), 0);
    };

    const getDisplayBalance = (liability: Liability) => {
        const hasStarting =
            liability.startingBalance && liability.startingBalance > 0;
        const base =
            (hasStarting ? liability.startingBalance : liability.balance) || 0;
        const paid = hasStarting ? getHistoricalPaidAmount(liability) : 0;
        const overrides = amortizationOverrides[liability.id] || {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const interestAdjust = Object.entries(overrides).reduce(
            (sum, [periodKey, override]) => {
                if (!override) return sum;
                const periodNum = Number(periodKey);
                const date = parseLocalDate(override.checkDate || null);
                if (date && date > today) return sum;
                if (!date && !(Number.isFinite(periodNum) && periodNum <= 0))
                    return sum;
                return sum + (override.interest || 0);
            },
            0
        );
        return Math.max(0, base - paid + interestAdjust);
    };

    const getBalanceFromTimeline = () => {
        if (!amortizationData || !amortizationData.timeline.length) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const rowsWithDates = amortizationData.timeline
            .map((row) => {
                const dateValue = (row as any).actualDate;
                const parsed = parseLocalDate(dateValue);
                return parsed ? { row, date: parsed } : null;
            })
            .filter(Boolean) as {
            row: (typeof amortizationData.timeline)[0];
            date: Date;
        }[];

        if (!rowsWithDates.length) return null;

        // Find the latest applied payment (<= today)
        const pastRows = rowsWithDates.filter(({ date }) => date <= today);
        if (pastRows.length) {
            const latest = pastRows.reduce((acc, cur) =>
                cur.date > acc.date ? cur : acc
            );
            return latest.row.remainingBalance;
        }

        // Otherwise use the earliest dated row (upcoming) as the next balance marker
        const earliest = rowsWithDates.reduce((acc, cur) =>
            cur.date < acc.date ? cur : acc
        );
        return earliest.row.remainingBalance;
    };

    const paymentsForViewing = useMemo(() => {
        if (!viewingLiability) return [];
        return extraPayments
            .filter((p) => p.liabilityId === viewingLiability.id)
            .slice()
            .sort((a, b) => {
                const da = pDate(a.checkDate);
                const db = pDate(b.checkDate);
                if (da === db) return a.id.localeCompare(b.id);
                return da - db;
            });
    }, [extraPayments, viewingLiability]);

    const minimumPaidByPeriod = useMemo(() => {
        if (!viewingLiability) return {};
        return extraPayments
            .filter(
                (p) =>
                    p.liabilityId === viewingLiability.id &&
                    isMinimumPaymentId(p.id)
            )
            .reduce<Record<number, number>>((acc, p) => {
                const period = getPeriodIndexFromDate(
                    viewingLiability,
                    p.checkDate
                );
                if (period === null || period === undefined) return acc;
                const bucket = period < 0 ? 0 : period;
                acc[bucket] = (acc[bucket] || 0) + (p.amount || 0);
                return acc;
            }, {});
    }, [extraPayments, viewingLiability]);

    const amortizationOverridesForViewing = useMemo(() => {
        if (!viewingLiability) return {};
        return amortizationOverrides[viewingLiability.id] || {};
    }, [amortizationOverrides, viewingLiability]);

    const paymentsByCheckDate = useMemo(() => {
        const map = new Map<string, ExtraPayment>();
        paymentsForViewing.forEach((p) => {
            if (!p.checkDate || map.has(p.checkDate)) return;
            map.set(p.checkDate, p);
        });
        return map;
    }, [paymentsForViewing]);

    const amortizationSummary = useMemo(() => {
        if (!amortizationData || !viewingLiability) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let totalInterestToDate = 0;
        let totalPaymentsToDate = 0;
        amortizationData.timeline.forEach((row) => {
            const date = row.actualDate
                ? parseLocalDate(row.actualDate)
                : (viewingLiability.startingBalance || 0) > 0
                ? getProjectedRowDate(viewingLiability, row.month, today)
                : null;
            if (date && date > today) return;
            if (!date && !row.isHistorical) return;
            const override = amortizationOverridesForViewing[row.month];
            const interest = override?.interest ?? row.interest;
            const payment = override?.payment ?? row.payment;
            totalInterestToDate += interest;
            if (payment > 0) totalPaymentsToDate += payment;
        });
        return { totalInterestToDate, totalPaymentsToDate };
    }, [amortizationData, amortizationOverridesForViewing]);

    const payoffMonthsRemaining = useMemo(() => {
        if (!amortizationData || !viewingLiability) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isBiWeekly = viewingLiability.paymentFrequency === "BI_WEEKLY";
        const isWeekly = viewingLiability.paymentFrequency === "WEEKLY";
        const periodsPerYear = isBiWeekly ? 26 : isWeekly ? 52 : 12;

        let remainingPeriods = 0;
        amortizationData.timeline.forEach((row) => {
            const date = row.actualDate
                ? parseLocalDate(row.actualDate)
                : (viewingLiability.startingBalance || 0) > 0
                ? getProjectedRowDate(viewingLiability, row.month, today)
                : null;
            if (date && date > today) {
                remainingPeriods += 1;
            } else if (!date && !row.isHistorical) {
                remainingPeriods += 1;
            }
        });

        return Math.ceil((remainingPeriods / periodsPerYear) * 12);
    }, [amortizationData, viewingLiability]);

    const autoMarkedSummaryById = useMemo(() => {
        if (!liabilities.length) return {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const summary: Record<
            string,
            { balanceToDate: number; totalPaidToDate: number }
        > = {};
        liabilities.forEach((liability) => {
            if (!liability.startingBalance || liability.startingBalance <= 0)
                return;
            const { extrasMapMerged, planPaymentsMap } =
                buildAmortizationInputs(liability);
            const data = calculateIndividualAmortization(
                liability,
                extrasMapMerged,
                planPaymentsMap
            );
            let totalPaidToDate = 0;
            let balanceToDate: number | null = null;
            data.timeline.forEach((row) => {
                const date = row.actualDate
                    ? parseLocalDate(row.actualDate)
                    : getProjectedRowDate(liability, row.month, today);
                if (!date || date > today) return;
                if (row.payment > 0) totalPaidToDate += row.payment;
                balanceToDate = row.remainingBalance;
            });
            if (balanceToDate !== null) {
                summary[liability.id] = { balanceToDate, totalPaidToDate };
            }
        });
        return summary;
    }, [liabilities, extraPayments, amortizationOverrides, savedSchedule]);

    const getListBalance = (liability: Liability) =>
        autoMarkedSummaryById[liability.id]?.balanceToDate ??
        getDisplayBalance(liability);

    // Helper: get local YYYY-MM-DD string (avoids timezone shifting to prior day)
    const toLocalDateString = (date: Date) =>
        new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .split("T")[0];

    // When a historical payment is added/edited/removed, adjust the live balance so the list matches reality.
    const applyHistoricalBalanceDelta = (
        liabilityId: string,
        delta: number
    ) => {
        if (!delta) return;
        const existing = liabilities.find((l) => l.id === liabilityId);
        if (!existing) return;
        const nextBalance = Math.max(0, (existing.balance || 0) + delta);
        const updated = { ...existing, balance: nextBalance };
        onSave(updated);
        if (viewingLiability?.id === liabilityId) {
            setViewingLiability(updated);
        }
    };

    const reconcileHistoricalBalanceChange = (
        liability: Liability,
        oldAmount: number,
        oldDate?: string | null,
        newAmount?: number,
        newDate?: string | null
    ) => {
        const oldPeriod = getPeriodIndexFromDate(liability, oldDate);
        const newPeriod = getPeriodIndexFromDate(liability, newDate);

        const wasHistorical = oldPeriod !== null && oldPeriod <= 0;
        const isHistorical = newPeriod !== null && newPeriod <= 0;

        let delta = 0;
        if (wasHistorical && isHistorical) {
            delta = oldAmount - (newAmount || 0);
        } else if (wasHistorical && !isHistorical) {
            delta = oldAmount; // removing a historical payment
        } else if (!wasHistorical && isHistorical) {
            delta = -(newAmount || 0); // adding/moving into history
        }

        if (delta !== 0) {
            applyHistoricalBalanceDelta(liability.id, delta);
        }
    };

    const getScheduleMonthIndex = (savedAt?: string) => {
        if (!savedAt) return 1;
        const savedDate = new Date(savedAt);
        if (Number.isNaN(savedDate.getTime())) return 1;
        const today = new Date();
        const savedMonthCount =
            savedDate.getFullYear() * 12 + savedDate.getMonth();
        const currentMonthCount = today.getFullYear() * 12 + today.getMonth();
        return Math.max(1, currentMonthCount - savedMonthCount + 1);
    };

    // Form State
    const [formData, setFormData] = useState<Omit<Liability, "id">>({
        name: "",
        subtitle: "",
        transferAccount: "",
        excludedIncomeSourceIds: [],
        excludeFromSplitting: false,
        balance: 0,
        startingBalance: 0,
        startDate: "",
        interestRate: 0,
        category: "",
        minPaymentPercentage: 2,
        minPaymentPlusInterest: true,
        minPaymentPlusFees: false,
        minPaymentAmount: 0,
        paymentFrequency: "MONTHLY",
        minPaymentFloor: 25,
        annualFee: 0,
        isFeeMonthly: false,
        feeMonth: 1,
        dueDate: 1,
        nextDueDate: "",
        creditLimit: 0,
        customOrder: liabilities.length + 1,
        owner: "JOINT",
    });

    const [sortBy, setSortBy] = useState<"name" | "balance" | "interestRate">(
        "name"
    );
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

    const partnerFirstWord =
        settings?.partnerName?.trim()?.split(/\s+/)[0] || "Partner";
    const eligibleIncomes = useMemo(
        () => incomes.filter((i) => i.includeInPlanner !== false),
        [incomes]
    );

    // --- CRUD Handlers ---
    const handleOpenFormModal = (liability?: Liability) => {
        const todayStr = toLocalDateString(new Date());

        // Default collapsed to save space
        setExpandMinPayment(false);
        setExpandAnnualFee(false);

        if (liability) {
            setEditingId(liability.id);

            // Initialize Toggles based on values
            setEnablePercent(liability.minPaymentPercentage > 0);
            setEnableFixed(liability.minPaymentAmount > 0);
            setEnableFloor(liability.minPaymentFloor > 0);
            setEnableAnnualFee(liability.annualFee > 0);

            const listIndex = liabilities.findIndex(
                (item) => item.id === liability.id
            );

            setFormData({
                name: liability.name,
                subtitle: liability.subtitle || "",
                transferAccount: liability.transferAccount || "",
                excludedIncomeSourceIds:
                    liability.excludedIncomeSourceIds || [],
                excludeFromSplitting: liability.excludeFromSplitting || false,
                balance: liability.balance,
                startingBalance: Number.isFinite(liability.startingBalance)
                    ? liability.startingBalance
                    : liability.balance,
                startDate: liability.startDate || todayStr,
                interestRate: liability.interestRate,
                category: liability.category || "",
                minPaymentPercentage: liability.minPaymentPercentage,
                minPaymentPlusInterest: liability.minPaymentPlusInterest,
                minPaymentPlusFees: liability.minPaymentPlusFees || false,
                minPaymentAmount: liability.minPaymentAmount,
                paymentFrequency: liability.paymentFrequency || "MONTHLY",
                minPaymentFloor: liability.minPaymentFloor,
                annualFee: liability.annualFee,
                isFeeMonthly: liability.isFeeMonthly,
                feeMonth: liability.feeMonth || 1,
                dueDate: liability.dueDate || 1,
                nextDueDate: liability.nextDueDate || todayStr,
                creditLimit: liability.creditLimit || 0,
                customOrder:
                    liability.customOrder ||
                    (listIndex >= 0 ? listIndex + 1 : 1),
                owner: liability.owner || "JOINT",
            });
        } else {
            setEditingId(null);
            // Defaults
            setEnablePercent(true);
            setEnableFixed(false);
            setEnableFloor(true);
            setEnableAnnualFee(false);

            const currentMonth = new Date().getMonth() + 1; // 1-12
            const currentDay = new Date().getDate();

            setFormData({
                name: "",
                subtitle: "",
                transferAccount: "",
                excludedIncomeSourceIds: [],
                excludeFromSplitting: false,
                balance: 0,
                startingBalance: 0,
                startDate: todayStr,
                interestRate: 0,
                minPaymentPercentage: 2,
                minPaymentPlusInterest: true,
                minPaymentPlusFees: false,
                minPaymentAmount: 0,
                paymentFrequency: "MONTHLY",
                minPaymentFloor: 25,
                annualFee: 0,
                isFeeMonthly: false,
                feeMonth: currentMonth,
                dueDate: Math.min(28, currentDay),
                nextDueDate: todayStr,
                creditLimit: 0,
                customOrder: liabilities.length + 1,
                owner: "JOINT",
            });
        }
        setIsFormModalOpen(true);
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();

        // Final cleanup ensuring values match toggles
        const finalData = { ...formData };
        const existing = editingId
            ? liabilities.find((l) => l.id === editingId)
            : null;
        if (!enablePercent) finalData.minPaymentPercentage = 0;
        if (!enableFixed) finalData.minPaymentAmount = 0;
        if (!enableFloor) finalData.minPaymentFloor = 0;
        if (!enableAnnualFee) finalData.annualFee = 0;
        finalData.customOrder = Number(finalData.customOrder) || 0;

        if (editingId) {
            finalData.balance = existing?.balance ?? finalData.balance;
        } else {
            finalData.balance = finalData.startingBalance;
        }

        if (!Number.isFinite(finalData.startingBalance)) {
            finalData.startingBalance = 0;
        }
        if (!finalData.startDate) {
            finalData.startDate = toLocalDateString(new Date());
        }
        if (!finalData.nextDueDate) {
            finalData.nextDueDate = toLocalDateString(new Date());
        }

        if (editingId) {
            onSave({
                ...finalData,
                id: editingId,
                customOrder: existing?.customOrder, // preserve custom order; edited via settings modal
            });
        } else {
            const newLiability: Liability = {
                ...finalData,
                customOrder: liabilities.length + 1,
                id: Math.random().toString(36).substr(2, 9),
            };
            onSave(newLiability);
        }
        setIsFormModalOpen(false);
    };

    const handleDelete = (id: string) => {
        if (confirm("Are you sure you want to delete this liability?")) {
            onDelete(id);
        }
    };

    const handleResetLiabilitySettings = async () => {
        if (!editingId) return;
        if (
            !confirm(
                "Reset this liability? This clears extra payments and amortization overrides, and resets the start date/balance."
            )
        )
            return;
        const todayStr = toLocalDateString(new Date());
        const fallback = liabilities.find((l) => l.id === editingId);
        try {
            const res = await dbAPI.resetLiabilitySettings(editingId);
            const updated =
                ((res as any)?.liability as Liability | undefined) ||
                (fallback
                    ? {
                          ...fallback,
                          balance: 0,
                          interestRate: 0,
                          startDate: todayStr,
                      }
                    : undefined);
            if (updated) {
                handleOpenFormModal(updated);
                if (viewingLiability?.id === updated.id) {
                    setViewingLiability(updated);
                }
                await Promise.resolve(onSave(updated));
            }
            setExtraPayments((prev) =>
                prev.filter((p) => p.liabilityId !== editingId)
            );
            setAmortizationOverrides((prev) => {
                const next = { ...prev };
                delete next[editingId];
                return next;
            });
            if (viewingLiability?.id === editingId) {
                handleViewAmortization(updated || viewingLiability);
            }
        } catch {
            /* ignore reset failures */
        }
    };

    // --- Amortization Handlers ---
    const handleViewAmortization = (liability: Liability) => {
        const { extrasMapMerged, planPaymentsMap } =
            buildAmortizationInputs(liability);
        const data = calculateIndividualAmortization(
            liability,
            extrasMapMerged,
            planPaymentsMap
        );
        setViewingLiability(liability);
        setAmortizationData(data);
        setIsAmortizationOpen(true);
    };

    // Keep amortization in sync while modal is open
    useEffect(() => {
        if (!isAmortizationOpen || !viewingLiability) return;
        handleViewAmortization(viewingLiability);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        extraPayments,
        savedSchedule,
        viewingLiability,
        isAmortizationOpen,
        amortizationOverrides,
    ]);

    const addHistoricalPayment = async () => {
        if (!viewingLiability) return;
        const dateValue = historicalDateRef.current?.value || "";
        const amountValue =
            parseFloat(historicalAmountRef.current?.value || "0") || 0;
        const purchaseValue =
            parseFloat(historicalPurchaseRef.current?.value || "0") || 0;
        const interestValue =
            parseFloat(historicalInterestRef.current?.value || "0") || 0;
        const netAmount = amountValue - purchaseValue;
        const parsedDate = parseLocalDate(dateValue);
        if (!parsedDate) {
            setHistoricalPaymentError("Enter a valid date.");
            return;
        }
        const checkDate = dateValue;
        const payload: ExtraPayment = {
            id: Math.random().toString(36).substr(2, 9),
            liabilityId: viewingLiability.id,
            amount: netAmount,
            checkDate,
        };
        setExtraPayments((prev) => [...prev, payload]);
        if (historicalDateRef.current) historicalDateRef.current.value = "";
        if (historicalAmountRef.current) historicalAmountRef.current.value = "0";
        if (historicalPurchaseRef.current)
            historicalPurchaseRef.current.value = "0";
        if (historicalInterestRef.current)
            historicalInterestRef.current.value = "0";
        setHistoricalPaymentError(null);
        reconcileHistoricalBalanceChange(
            viewingLiability,
            0,
            undefined,
            payload.amount,
            payload.checkDate
        );
        try {
            await dbAPI.saveExtraPayment(payload);
            const period = getPeriodIndexFromDate(viewingLiability, checkDate);
            if (period !== null && period !== undefined) {
                const overrideId = `${viewingLiability.id}-${period}`;
                const safeInterest = Math.max(0, interestValue);
                setAmortizationOverrides((prev) => ({
                    ...prev,
                    [viewingLiability.id]: {
                        ...(prev[viewingLiability.id] || {}),
                        [period]: {
                            payment: amountValue,
                            interest: safeInterest,
                            purchase: purchaseValue,
                            checkDate,
                        },
                    },
                }));
                await dbAPI.saveAmortizationOverride({
                    id: overrideId,
                    liabilityId: viewingLiability.id,
                    period,
                    payment: amountValue,
                    purchase: purchaseValue,
                    interest: safeInterest,
                    checkDate,
                });
            }
            // Recompute with new extra
            handleViewAmortization(viewingLiability);
        } catch {
            /* ignore save failures */
        }
    };

    const startEditPayment = (payment: ExtraPayment) => {
        if (viewingLiability) {
            const period = getPeriodIndexFromDate(
                viewingLiability,
                payment.checkDate
            );
            const override =
                period !== null && period !== undefined
                    ? amortizationOverrides[viewingLiability.id]?.[period]
                    : undefined;
            setEditingPaymentId(payment.id);
            setEditPayment({
                amount: override?.payment ?? Math.max(0, payment.amount),
                date: payment.checkDate || "",
            });
            setEditPaymentPurchase(
                override?.purchase ??
                    (payment.amount < 0 ? Math.abs(payment.amount) : 0)
            );
            setEditPaymentInterest(override?.interest ?? 0);
        } else {
            setEditingPaymentId(payment.id);
            setEditPayment({
                amount: Math.max(0, payment.amount),
                date: payment.checkDate || "",
            });
            setEditPaymentPurchase(
                payment.amount < 0 ? Math.abs(payment.amount) : 0
            );
            setEditPaymentInterest(0);
        }
    };

    const cancelEditPayment = () => {
        setEditingPaymentId(null);
        setEditPayment({ amount: 0, date: "" });
        setEditPaymentInterest(0);
        setEditPaymentPurchase(0);
    };

    const saveEditedPayment = async () => {
        if (!editingPaymentId || !viewingLiability) return;
        const existing = extraPayments.find((p) => p.id === editingPaymentId);
        if (!existing) {
            setEditingPaymentId(null);
            return;
        }
        const netAmount = editPayment.amount - editPaymentPurchase;
        const updated: ExtraPayment = {
            ...existing,
            amount: netAmount,
            checkDate:
                editPayment.date ||
                existing.checkDate ||
                toLocalDateString(new Date()),
        };
        setExtraPayments((prev) =>
            prev.map((p) => (p.id === editingPaymentId ? updated : p))
        );
        setEditingPaymentId(null);
        setEditPaymentPurchase(0);
        reconcileHistoricalBalanceChange(
            viewingLiability,
            existing.amount,
            existing.checkDate,
            updated.amount,
            updated.checkDate
        );
        try {
            await dbAPI.saveExtraPayment(updated);
            const period = getPeriodIndexFromDate(
                viewingLiability,
                updated.checkDate
            );
            if (period !== null && period !== undefined) {
                const overrideId = `${viewingLiability.id}-${period}`;
                const safeInterest = Math.max(0, editPaymentInterest);
                setAmortizationOverrides((prev) => ({
                    ...prev,
                    [viewingLiability.id]: {
                        ...(prev[viewingLiability.id] || {}),
                        [period]: {
                            payment: editPayment.amount,
                            interest: safeInterest,
                            purchase: editPaymentPurchase,
                            checkDate: updated.checkDate,
                        },
                    },
                }));
                await dbAPI.saveAmortizationOverride({
                    id: overrideId,
                    liabilityId: viewingLiability.id,
                    period,
                    payment: editPayment.amount,
                    purchase: editPaymentPurchase,
                    interest: safeInterest,
                    checkDate: updated.checkDate,
                });
            }
            handleViewAmortization(viewingLiability);
        } catch {
            /* ignore save failures */
        }
    };

    const deletePayment = async (id: string) => {
        const existing = extraPayments.find((p) => p.id === id);
        setExtraPayments((prev) => prev.filter((p) => p.id !== id));
        if (editingPaymentId === id) {
            setEditingPaymentId(null);
        }
        if (viewingLiability && existing) {
            reconcileHistoricalBalanceChange(
                viewingLiability,
                existing.amount,
                existing.checkDate,
                0,
                existing.checkDate
            );
            handleViewAmortization(viewingLiability);
        }
        try {
            await dbAPI.deleteExtraPayment(id);
        } catch {
            /* ignore delete failures */
        }
    };

    const deleteAmortizationOverrideRow = async (
        liabilityId: string,
        period: number
    ) => {
        const overrideId = `${liabilityId}-${period}`;
        setAmortizationOverrides((prev) => {
            const next = { ...prev };
            if (!next[liabilityId]) return next;
            const { [period]: _, ...rest } = next[liabilityId];
            if (Object.keys(rest).length === 0) {
                delete next[liabilityId];
            } else {
                next[liabilityId] = rest;
            }
            return next;
        });
        if (viewingLiability?.id === liabilityId) {
            handleViewAmortization(viewingLiability);
        }
        try {
            await dbAPI.deleteAmortizationOverride(overrideId);
        } catch {
            /* ignore delete failures */
        }
    };

    const startEditAmortizationRow = (row: AmortizationRow) => {
        if (!viewingLiability) return;
        const overrides = amortizationOverrides[viewingLiability.id] || {};
        const override = overrides[row.month];
        const payment = override?.payment ?? row.payment;
        const interest = override?.interest ?? row.interest;
        const purchase =
            override?.purchase ?? (payment < 0 ? Math.abs(payment) : 0);
        const displayPayment =
            override?.purchase !== undefined
                ? Math.max(0, payment)
                : payment > 0
                ? payment
                : 0;
        setEditingAmortizationRow(row.month);
        setAmortizationEdit({
            payment: displayPayment.toFixed(2),
            interest: interest.toFixed(2),
        });
        setAmortizationEditPurchase(purchase.toFixed(2));
        setAmortizationEditDate(row.actualDate || "");
    };

    const cancelEditAmortizationRow = () => {
        setEditingAmortizationRow(null);
        setAmortizationEdit({ payment: "", interest: "" });
        setAmortizationEditPurchase("0");
        setAmortizationEditDate("");
    };

    const saveAmortizationRowEdit = async (
        row: AmortizationRow,
        matchingPayment?: ExtraPayment
    ) => {
        if (!viewingLiability) return;
        const nextPayment = parseFloat(amortizationEdit.payment);
        const nextPurchase = parseFloat(amortizationEditPurchase);
        const nextInterest = parseFloat(amortizationEdit.interest);
        if (
            !Number.isFinite(nextPayment) ||
            !Number.isFinite(nextInterest) ||
            !Number.isFinite(nextPurchase)
        )
            return;
        const nextDate = amortizationEditDate
            ? amortizationEditDate
            : row.actualDate || matchingPayment?.checkDate || null;
        const safePayment = nextPayment - nextPurchase;
        const safeInterest = Math.max(0, nextInterest);
        const overrideId = `${viewingLiability.id}-${row.month}`;
        setAmortizationOverrides((prev) => ({
            ...prev,
            [viewingLiability.id]: {
                ...(prev[viewingLiability.id] || {}),
                [row.month]: {
                    payment: nextPayment,
                    interest: safeInterest,
                    purchase: nextPurchase,
                    checkDate: nextDate,
                },
            },
        }));
        setEditingAmortizationRow(null);
        setAmortizationEdit({ payment: "", interest: "" });
        setAmortizationEditPurchase("0");
        setAmortizationEditDate("");
        try {
            await dbAPI.saveAmortizationOverride({
                id: overrideId,
                liabilityId: viewingLiability.id,
                period: row.month,
                payment: nextPayment,
                purchase: nextPurchase,
                interest: safeInterest,
                checkDate: nextDate,
            });
        } catch {
            /* ignore save failures */
        }

        if (row.isHistorical && matchingPayment) {
            const updated: ExtraPayment = {
                ...matchingPayment,
                amount: safePayment,
                checkDate: nextDate || toLocalDateString(new Date()),
            };
            setExtraPayments((prev) =>
                prev.map((p) => (p.id === matchingPayment.id ? updated : p))
            );
            if (editingPaymentId === matchingPayment.id) {
                setEditPayment((prev) => ({ ...prev, amount: updated.amount }));
                setEditingPaymentId(null);
            }
            reconcileHistoricalBalanceChange(
                viewingLiability,
                matchingPayment.amount,
                matchingPayment.checkDate,
                updated.amount,
                updated.checkDate
            );
            try {
                await dbAPI.saveExtraPayment(updated);
                handleViewAmortization(viewingLiability);
            } catch {
                /* ignore save failures */
            }
        }
    };

    const handlePriorityChange = (id: string, value: number) => {
        setPriorityMap((prev) => ({ ...prev, [id]: value }));
    };

    const savePriorityOrder = () => {
        liabilities.forEach((l) => {
            const nextOrder =
                priorityMap[l.id] ?? orderedPriorityIds.indexOf(l.id) + 1;
            if (nextOrder !== l.customOrder) {
                onSave({ ...l, customOrder: nextOrder });
            }
        });
        setIsSettingsOpen(false);
    };

    const reorderIds = (ids: string[], sourceId: string, targetId: string) => {
        const next = [...ids];
        const from = next.indexOf(sourceId);
        const to = next.indexOf(targetId);
        if (from === -1 || to === -1) return ids;
        next.splice(to, 0, next.splice(from, 1)[0]);
        return next;
    };

    const handleDragStartPriority = (id: string) => {
        setDraggingId(id);
    };

    const handleDragOverPriority = (id: string) => {
        if (!draggingId || draggingId === id) return;
        setPriorityMap((prev) => {
            const reorderedIds = reorderIds(orderedPriorityIds, draggingId, id);
            const next: Record<string, number> = {};
            reorderedIds.forEach((lid, idx) => {
                next[lid] = idx + 1;
            });
            return next;
        });
    };

    const renderMinPaymentLabel = (liability: Liability) => {
        const monthlyInt =
            liability.balance * (liability.interestRate / 100 / 12);
        // Estimate fee for label context - show monthly equivalent
        const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
        const adjustedLiability =
            liability.paymentFrequency === "BI_WEEKLY"
                ? {
                      ...liability,
                      minPaymentAmount: liability.minPaymentAmount * (24 / 26),
                  }
                : liability;
        const val = getMinPayment(
            adjustedLiability,
            liability.balance,
            monthlyInt,
            estFee
        );

        // Construct dynamic description
        const parts = [];
        if (liability.minPaymentPercentage > 0)
            parts.push(`${liability.minPaymentPercentage}%`);
        if (liability.minPaymentPlusInterest) parts.push("+ Int");
        if (liability.minPaymentPlusFees) parts.push("+ Fee");
        if (liability.minPaymentAmount > 0) {
            let freqLabel = "";
            if (liability.paymentFrequency === "BI_WEEKLY")
                freqLabel = "(Bi-Wk)";
            else if (liability.paymentFrequency === "WEEKLY")
                freqLabel = "(Wk)";

            parts.push(`+ $${liability.minPaymentAmount} ${freqLabel}`);
        }

        if (parts.length === 0) parts.push("Fixed $0");

        return (
            <div className="flex flex-col items-end">
                <span
                    className="text-sm font-medium text-slate-700"
                    title="Estimated Monthly Equivalent"
                >
                    ${val.toFixed(2)}
                </span>
                <span className="text-xs text-slate-400">
                    {parts.join(" ")}
                </span>
            </div>
        );
    };

    const getNextDueDate = (liability: Liability) => {
        const baseDate = getScheduleAnchorDate(liability);
        const isBiWeekly = liability.paymentFrequency === "BI_WEEKLY";
        const isWeekly = liability.paymentFrequency === "WEEKLY";
        if (isBiWeekly || isWeekly) {
            const interval = isBiWeekly ? 14 : 7;
            const parsedAnchor = parseLocalDate(liability.nextDueDate) || null;
            let anchor =
                parsedAnchor ||
                new Date(
                    baseDate.getFullYear(),
                    baseDate.getMonth(),
                    getDueDayForMonth(
                        baseDate.getFullYear(),
                        baseDate.getMonth(),
                        liability.dueDate || 1
                    )
                );
            let guard = 0;
            while (anchor < baseDate && guard < 500) {
                anchor = addDays(anchor, interval);
                guard++;
            }
            return anchor.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
            });
        }

        // Monthly fallback
        let target = new Date(
            baseDate.getFullYear(),
            baseDate.getMonth(),
            getDueDayForMonth(
                baseDate.getFullYear(),
                baseDate.getMonth(),
                liability.dueDate || 1
            )
        );
        if (target < baseDate) {
            const nextMonth = new Date(
                baseDate.getFullYear(),
                baseDate.getMonth() + 1,
                1
            );
            target = new Date(
                nextMonth.getFullYear(),
                nextMonth.getMonth(),
                getDueDayForMonth(
                    nextMonth.getFullYear(),
                    nextMonth.getMonth(),
                    liability.dueDate || 1
                )
            );
        }
        return target.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });
    };

    const getPaymentDateForRow = (rowIndex: number, liability: Liability) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = parseLocalDate(liability.startDate);
        if (start) {
            start.setHours(0, 0, 0, 0);
        }
        const useFutureStart = !!(start && start > today);
        const isBiWeekly = liability.paymentFrequency === "BI_WEEKLY";
        const isWeekly = liability.paymentFrequency === "WEEKLY";
        const intervalDays = isBiWeekly ? 14 : isWeekly ? 7 : null;
        let anchor = getPaymentAnchorDate(liability);

        if (intervalDays) {
            let guard = 0;
            if (useFutureStart) {
                while (anchor < (start || today) && guard < 500) {
                    anchor = addDays(anchor, intervalDays);
                    guard++;
                }
            }
            return addDays(anchor, (rowIndex - 1) * intervalDays);
        }

        // Monthly payments
        let guard = 0;
        if (useFutureStart) {
            while (anchor < (start || today) && guard < 120) {
                const nextMonth = new Date(
                    anchor.getFullYear(),
                    anchor.getMonth() + 1,
                    1
                );
                anchor = new Date(
                    nextMonth.getFullYear(),
                    nextMonth.getMonth(),
                    getDueDayForMonth(
                        nextMonth.getFullYear(),
                        nextMonth.getMonth(),
                        liability.dueDate || anchor.getDate()
                    )
                );
                guard++;
            }
        }
        const targetMonth = new Date(
            anchor.getFullYear(),
            anchor.getMonth() + rowIndex - 1,
            1
        );
        return new Date(
            targetMonth.getFullYear(),
            targetMonth.getMonth(),
            getDueDayForMonth(
                targetMonth.getFullYear(),
                targetMonth.getMonth(),
                liability.dueDate || anchor.getDate()
            )
        );
    };

    // Helper for summary text in collapsed headers
    const getMinPaymentSummary = () => {
        const parts = [];
        if (enablePercent) parts.push(`${formData.minPaymentPercentage}%`);
        if (formData.minPaymentPlusInterest) parts.push("+ Int");
        if (formData.minPaymentPlusFees) parts.push("+ Fees");
        if (enableFixed) parts.push(`+ $${formData.minPaymentAmount}`);
        if (parts.length === 0) return "Fixed $0";
        return parts.join(" ");
    };

    const getOwnerIcon = (owner: Ownership | undefined) => {
        if (owner === "USER")
            return <User size={14} className="text-indigo-500" />;
        if (owner === "PARTNER")
            return <User size={14} className="text-pink-500" />;
        return <Users size={14} className="text-purple-500" />;
    };

    const getOwnerLabel = (owner: Ownership | undefined) => {
        if (owner === "USER") return "Me";
        if (owner === "PARTNER") return partnerFirstWord;
        return "Joint";
    };

    const MONTHS = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];

    return (
        <div className="space-y-8">
            <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-500 text-white rounded-lg">
                    <DollarSign size={20} />
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">
                        Liabilities
                    </h1>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    <button
                        onClick={() => handleOpenFormModal()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1.5 rounded-lg font-medium shadow-sm flex items-center transition-colors"
                    >
                        <Plus size={18} className="mr-2" />
                        Add
                    </button>
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="bg-white border border-slate-200 text-slate-700 px-2 py-1.5 rounded-lg font-medium shadow-sm flex items-center transition-colors hover:bg-slate-50"
                        aria-label="Liability settings"
                    >
                        <Settings size={18} className="mr-2" />
                        Settings
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th
                                    className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                                    onClick={() => {
                                        setSortBy("name");
                                        setSortDir((d) =>
                                            sortBy === "name" && d === "asc"
                                                ? "desc"
                                                : "asc"
                                        );
                                    }}
                                >
                                    <div className="flex items-center space-x-1">
                                        <span>Name</span>
                                        {sortBy === "name" && (
                                            <span className="text-[10px] text-slate-400">
                                                {sortDir === "asc" ? "▲" : "▼"}
                                            </span>
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right cursor-pointer select-none"
                                    onClick={() => {
                                        setSortBy("balance");
                                        setSortDir((d) =>
                                            sortBy === "balance" && d === "asc"
                                                ? "desc"
                                                : "asc"
                                        );
                                    }}
                                >
                                    <div className="flex items-center justify-end space-x-1">
                                        <span>Balance</span>
                                        {sortBy === "balance" && (
                                            <span className="text-[10px] text-slate-400">
                                                {sortDir === "asc" ? "▲" : "▼"}
                                            </span>
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right cursor-pointer select-none"
                                    onClick={() => {
                                        setSortBy("interestRate");
                                        setSortDir((d) =>
                                            sortBy === "interestRate" &&
                                            d === "asc"
                                                ? "desc"
                                                : "asc"
                                        );
                                    }}
                                >
                                    <div className="flex items-center justify-end space-x-1">
                                        <span>APR</span>
                                        {sortBy === "interestRate" && (
                                            <span className="text-[10px] text-slate-400">
                                                {sortDir === "asc" ? "▲" : "▼"}
                                            </span>
                                        )}
                                    </div>
                                </th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">
                                    Current Min. (Mo.)
                                </th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">
                                    Due Date
                                </th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">
                                    Limit
                                </th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {liabilities.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={7}
                                        className="px-6 py-12 text-center text-slate-400"
                                    >
                                        No liabilities added yet. Click "Add
                                        Liability" to get started.
                                    </td>
                                </tr>
                            ) : (
                                liabilities
                                    .slice()
                                    .sort((a, b) => {
                                        const dir = sortDir === "asc" ? 1 : -1;
                                        if (sortBy === "name") {
                                            return (
                                                a.name.localeCompare(b.name) *
                                                dir
                                            );
                                        }
                                        if (sortBy === "balance") {
                                            return (
                                                (getListBalance(a) -
                                                    getListBalance(b)) *
                                                dir
                                            );
                                        }
                                        if (sortBy === "interestRate") {
                                            return (
                                                (a.interestRate -
                                                    b.interestRate) *
                                                dir
                                            );
                                        }
                                        return 0;
                                    })
                                    .map((liability) => {
                                        const autoSummary =
                                            autoMarkedSummaryById[
                                                liability.id
                                            ];
                                        const displayBalance =
                                            getListBalance(liability);
                                        const startingBalance =
                                            liability.startingBalance || 0;
                                        const totalPaid =
                                            startingBalance > 0
                                                ? Math.max(
                                                      0,
                                                      startingBalance -
                                                          displayBalance
                                                  )
                                                : autoSummary?.totalPaidToDate ??
                                                  getTotalPaidAmount(
                                                      liability
                                                  );
                                        const maxBalance = Math.max(
                                            startingBalance,
                                            displayBalance + totalPaid
                                        );
                                        const percentPaid =
                                            maxBalance > 0
                                                ? Math.max(
                                                      0,
                                                      Math.min(
                                                          100,
                                                          ((maxBalance -
                                                              displayBalance) /
                                                              maxBalance) *
                                                              100
                                                      )
                                                  )
                                                : 0;

                                        return (
                                            <tr
                                                key={liability.id}
                                                className="hover:bg-slate-50 transition-colors"
                                            >
                                                <td className="px-6 py-4">
                                                    <div className="flex items-baseline gap-2 font-medium text-slate-900">
                                                        <span>
                                                            {liability.name}
                                                        </span>
                                                        {liability.subtitle && (
                                                            <span className="text-xs font-normal text-slate-500">
                                                                {
                                                                    liability.subtitle
                                                                }
                                                            </span>
                                                        )}
                                                    </div>
                                                    {liability.category ? (
                                                        <span className="block text-xs font-normal text-slate-400">
                                                            {liability.category}
                                                        </span>
                                                    ) : null}
                                                    <div className="flex items-center space-x-1 mt-1">
                                                        {getOwnerIcon(
                                                            liability.owner
                                                        )}
                                                        <span className="text-xs text-slate-500">
                                                            {getOwnerLabel(
                                                                liability.owner
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 mt-1">
                                                        Priority #
                                                        {liability.customOrder ||
                                                            "-"}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="font-medium text-slate-700">
                                                        $
                                                        {displayBalance.toLocaleString()}
                                                    </div>
                                                    {maxBalance >
                                                        displayBalance && (
                                                        <div className="flex flex-col items-end mt-1">
                                                            <div className="w-24 bg-slate-100 rounded-full h-1.5 mb-1">
                                                                <div
                                                                    className="bg-green-500 h-1.5 rounded-full"
                                                                    style={{
                                                                        width: `${percentPaid}%`,
                                                                    }}
                                                                ></div>
                                                            </div>
                                                            <span className="text-[10px] text-slate-400">
                                                                {Math.round(
                                                                    percentPaid
                                                                )}
                                                                % Paid
                                                            </span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-700">
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                                        {liability.interestRate}
                                                        %
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    {renderMinPaymentLabel(
                                                        liability
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-500 text-sm">
                                                    {getNextDueDate(liability)}
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-500">
                                                    {liability.creditLimit
                                                        ? `$${liability.creditLimit.toLocaleString()}`
                                                        : "-"}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <div className="flex items-center justify-center space-x-2">
                                                        <button
                                                            onClick={() =>
                                                                handleViewAmortization(
                                                                    liability
                                                                )
                                                            }
                                                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"
                                                            title="View Amortization Schedule"
                                                        >
                                                            <FileText
                                                                size={16}
                                                            />
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                handleOpenFormModal(
                                                                    liability
                                                                )
                                                            }
                                                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50"
                                                            title="Edit Liability"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                handleDelete(
                                                                    liability.id
                                                                )
                                                            }
                                                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
                                                            title="Delete Liability"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add/Edit Modal */}
            {isFormModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-fade-in-up my-8">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-900">
                                {editingId
                                    ? "Edit Liability"
                                    : "Add New Liability"}
                            </h3>
                            <button
                                onClick={() => setIsFormModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 space-y-2">
                            {/* Liability Details Config (Collapsible) */}
                            <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !expandLiabilityDetails;
                                        openSection("details", next);
                                    }}
                                    className="w-full flex items-center justify-between p-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                                >
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm font-bold text-slate-800">
                                            Liability Details
                                        </span>
                                    </div>
                                    <div className="flex items-center space-x-3">
                                        {!expandLiabilityDetails && (
                                            <span className="text-xs text-slate-500 font-medium truncate max-w-[150px]">
                                                {formData.name || "New Debt"} •
                                                $
                                                {formData.startingBalance.toLocaleString()}
                                            </span>
                                        )}
                                        {expandLiabilityDetails ? (
                                            <ChevronUp
                                                size={18}
                                                className="text-slate-400"
                                            />
                                        ) : (
                                            <ChevronDown
                                                size={18}
                                                className="text-slate-400"
                                            />
                                        )}
                                    </div>
                                </button>

                                {expandLiabilityDetails && (
                                    <div className="p-4 pt-0 border-t border-slate-200 space-y-4 bg-slate-50 mt-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mt-2 mb-1">
                                                Liability Name
                                            </label>
                                            <input
                                                required
                                                type="text"
                                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                placeholder="e.g. Mastercard or Car Loan"
                                                value={formData.name}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        name: e.target.value,
                                                    })
                                                }
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                                Subtitle (Optional)
                                            </label>
                                            <input
                                                type="text"
                                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                placeholder="e.g. Chase Sapphire"
                                                value={formData.subtitle || ""}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        subtitle:
                                                            e.target.value,
                                                    })
                                                }
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                                Category (Optional)
                                            </label>
                                            <input
                                                type="text"
                                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                placeholder="e.g. Auto Loan"
                                                value={formData.category}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        category:
                                                            e.target.value,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                                Transfer Account (Optional)
                                            </label>
                                            <input
                                                type="text"
                                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                placeholder="e.g. Checking - TD"
                                                value={
                                                    formData.transferAccount ||
                                                    ""
                                                }
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        transferAccount:
                                                            e.target.value,
                                                    })
                                                }
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                                    Original Balance ($)
                                                </label>
                                                <input
                                                    required
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                    value={
                                                        formData.startingBalance
                                                    }
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            startingBalance:
                                                                parseFloat(
                                                                    e.target
                                                                        .value
                                                                ) || 0,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                                    Start Date
                                                </label>
                                                <input
                                                    required
                                                    type="date"
                                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                    value={formData.startDate}
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            startDate:
                                                                e.target.value,
                                                        })
                                                    }
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                                    APR (%)
                                                </label>
                                                <input
                                                    required
                                                    type="number"
                                                    step="0.001"
                                                    min="0"
                                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                    value={
                                                        formData.interestRate
                                                    }
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            interestRate:
                                                                parseFloat(
                                                                    e.target
                                                                        .value
                                                                ),
                                                        })
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                                    Due Day
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        required
                                                        type="number"
                                                        min="1"
                                                        max="31"
                                                        className="w-full px-3 py-2 pl-8 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                        value={formData.dueDate}
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                dueDate:
                                                                    parseInt(
                                                                        e.target
                                                                            .value
                                                                    ),
                                                                nextDueDate:
                                                                    getNextDueDateForDay(
                                                                        parseInt(
                                                                            e
                                                                                .target
                                                                                .value
                                                                        ) || 1
                                                                    ),
                                                            })
                                                        }
                                                    />
                                                    <Calendar
                                                        className="absolute left-2.5 top-2.5 text-slate-400"
                                                        size={16}
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                                    Credit Limit (Optional)
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                    value={formData.creditLimit}
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            creditLimit:
                                                                parseFloat(
                                                                    e.target
                                                                        .value
                                                                ),
                                                        })
                                                    }
                                                />
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                                Next Due Date
                                            </label>
                                            <input
                                                type="date"
                                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                                value={
                                                    formData.nextDueDate || ""
                                                }
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        nextDueDate:
                                                            e.target.value,
                                                    })
                                                }
                                            />
                                            {(formData.paymentFrequency ===
                                                "BI_WEEKLY" ||
                                                formData.paymentFrequency ===
                                                    "WEEKLY") && (
                                                <p className="text-xs text-slate-500 mt-1">
                                                    We'll repeat every{" "}
                                                    {formData.paymentFrequency ===
                                                    "BI_WEEKLY"
                                                        ? "14"
                                                        : "7"}{" "}
                                                    days from this date.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Advanced Min Payment Configuration (Collapsible) */}
                            <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !expandMinPayment;
                                        openSection("min", next);
                                    }}
                                    className="w-full flex items-center justify-between p-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                                >
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm font-bold text-slate-800">
                                            Minimum Payment Formula
                                        </span>
                                    </div>
                                    <div className="flex items-center space-x-3">
                                        {!expandMinPayment && (
                                            <span className="text-xs text-slate-500 font-medium truncate max-w-[150px]">
                                                {getMinPaymentSummary()}
                                            </span>
                                        )}
                                        {expandMinPayment ? (
                                            <ChevronUp
                                                size={18}
                                                className="text-slate-400"
                                            />
                                        ) : (
                                            <ChevronDown
                                                size={18}
                                                className="text-slate-400"
                                            />
                                        )}
                                    </div>
                                </button>

                                {expandMinPayment && (
                                    <div className="p-4 pt-0 border-t border-slate-200 space-y-4 bg-slate-50">
                                        <div className="flex items-center justify-between space-x-2">
                                            <p className="text-xs text-slate-500 mb-2 mt-2">
                                                Build your minimum payment
                                                formula:
                                            </p>
                                            <div
                                                className="group relative"
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                            >
                                                <Info
                                                    size={16}
                                                    className="text-slate-400 cursor-help"
                                                />
                                                <div className="absolute right-0 top-6 w-64 bg-slate-800 text-white text-xs p-3 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                                    Construct the formula used
                                                    by your lender. Usually
                                                    found on your statement
                                                    under "Minimum Payment
                                                    Warning".
                                                </div>
                                            </div>
                                        </div>

                                        {/* 1. Percentage Component */}
                                        <div
                                            className={`flex items-center space-x-3 p-2 rounded border border-slate-200 transition-colors ${
                                                enablePercent
                                                    ? "bg-white"
                                                    : "bg-slate-50"
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={enablePercent}
                                                onChange={(e) => {
                                                    const checked =
                                                        e.target.checked;
                                                    setEnablePercent(checked);
                                                    if (
                                                        checked &&
                                                        formData.minPaymentPercentage ===
                                                            0
                                                    ) {
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            minPaymentPercentage: 2,
                                                        }));
                                                    } else if (!checked) {
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            minPaymentPercentage: 0,
                                                        }));
                                                    }
                                                }}
                                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 cursor-pointer"
                                            />
                                            <div
                                                className={`flex items-center space-x-3 flex-1 ${
                                                    !enablePercent
                                                        ? "opacity-40 pointer-events-none"
                                                        : ""
                                                }`}
                                            >
                                                <span className="text-sm text-slate-500 font-bold mr-1">
                                                    +
                                                </span>
                                                <Percent
                                                    size={16}
                                                    className="text-slate-400"
                                                />
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    min="0"
                                                    max="100"
                                                    className="w-20 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                                    value={
                                                        formData.minPaymentPercentage
                                                    }
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            minPaymentPercentage:
                                                                parseFloat(
                                                                    e.target
                                                                        .value
                                                                ),
                                                        })
                                                    }
                                                />
                                                <span className="text-sm text-slate-700">
                                                    % of Balance
                                                </span>
                                            </div>
                                        </div>

                                        {/* 2. Interest Toggle */}
                                        <div
                                            className={`flex items-center space-x-3 p-2 rounded border border-slate-200 transition-colors ${
                                                formData.minPaymentPlusInterest
                                                    ? "bg-white"
                                                    : "bg-slate-50"
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                id="plusInterest"
                                                checked={
                                                    formData.minPaymentPlusInterest
                                                }
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        minPaymentPlusInterest:
                                                            e.target.checked,
                                                    })
                                                }
                                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 cursor-pointer"
                                            />
                                            <div
                                                className={`flex items-center space-x-3 flex-1 ${
                                                    !formData.minPaymentPlusInterest
                                                        ? "opacity-40 pointer-events-none"
                                                        : ""
                                                }`}
                                            >
                                                <span className="text-sm text-slate-500 font-bold mr-1">
                                                    +
                                                </span>
                                                <DollarSign
                                                    size={16}
                                                    className="text-slate-400"
                                                />
                                                <label
                                                    htmlFor="plusInterest"
                                                    className="text-sm font-medium text-slate-700 cursor-pointer select-none"
                                                >
                                                    Interest
                                                </label>
                                            </div>
                                        </div>

                                        {/* 3. Fee Toggle */}
                                        <div
                                            className={`flex items-center space-x-3 p-2 rounded border border-slate-200 transition-colors ${
                                                formData.minPaymentPlusFees
                                                    ? "bg-white"
                                                    : "bg-slate-50"
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                id="plusFees"
                                                checked={
                                                    formData.minPaymentPlusFees
                                                }
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        minPaymentPlusFees:
                                                            e.target.checked,
                                                    })
                                                }
                                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 cursor-pointer"
                                            />
                                            <div
                                                className={`flex items-center space-x-3 flex-1 ${
                                                    !formData.minPaymentPlusFees
                                                        ? "opacity-40 pointer-events-none"
                                                        : ""
                                                }`}
                                            >
                                                <span className="text-sm text-slate-500 font-bold mr-1">
                                                    +
                                                </span>
                                                <DollarSign
                                                    size={16}
                                                    className="text-slate-400"
                                                />
                                                <label
                                                    htmlFor="plusFees"
                                                    className="text-sm font-medium text-slate-700 cursor-pointer select-none"
                                                >
                                                    Fees Charged
                                                </label>
                                            </div>
                                        </div>

                                        {/* 4. Fixed Amount */}
                                        <div
                                            className={`flex items-center space-x-3 p-2 rounded border border-slate-200 transition-colors ${
                                                enableFixed
                                                    ? "bg-white"
                                                    : "bg-slate-50"
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={enableFixed}
                                                onChange={(e) => {
                                                    const checked =
                                                        e.target.checked;
                                                    setEnableFixed(checked);
                                                    if (
                                                        checked &&
                                                        formData.minPaymentAmount ===
                                                            0
                                                    ) {
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            minPaymentAmount: 10,
                                                        }));
                                                    } else if (!checked) {
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            minPaymentAmount: 0,
                                                        }));
                                                    }
                                                }}
                                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 cursor-pointer"
                                            />
                                            <div
                                                className={`flex items-center space-x-2 flex-1 ${
                                                    !enableFixed
                                                        ? "opacity-40 pointer-events-none"
                                                        : ""
                                                }`}
                                            >
                                                <span className="text-sm text-slate-500 font-bold mr-1">
                                                    +
                                                </span>
                                                <DollarSign
                                                    size={16}
                                                    className="text-slate-400"
                                                />
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    className="w-24 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                                    value={
                                                        formData.minPaymentAmount
                                                    }
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            minPaymentAmount:
                                                                parseFloat(
                                                                    e.target
                                                                        .value
                                                                ),
                                                        })
                                                    }
                                                />
                                                <select
                                                    className="ml-2 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                                                    value={
                                                        formData.paymentFrequency
                                                    }
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            paymentFrequency: e
                                                                .target
                                                                .value as any,
                                                        })
                                                    }
                                                >
                                                    <option value="MONTHLY">
                                                        Monthly
                                                    </option>
                                                    <option value="BI_WEEKLY">
                                                        Bi-Weekly
                                                    </option>
                                                    <option value="WEEKLY">
                                                        Weekly
                                                    </option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* 5. Floor */}
                                        <div
                                            className={`flex items-center space-x-3 p-2 rounded border border-slate-200 transition-colors ${
                                                enableFloor
                                                    ? "bg-white"
                                                    : "bg-slate-50"
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={enableFloor}
                                                onChange={(e) => {
                                                    const checked =
                                                        e.target.checked;
                                                    setEnableFloor(checked);
                                                    if (
                                                        checked &&
                                                        formData.minPaymentFloor ===
                                                            0
                                                    ) {
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            minPaymentFloor: 25,
                                                        }));
                                                    } else if (!checked) {
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            minPaymentFloor: 0,
                                                        }));
                                                    }
                                                }}
                                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 cursor-pointer"
                                            />
                                            <div
                                                className={`flex items-center space-x-3 flex-1  ${
                                                    !enableFloor
                                                        ? "opacity-40 pointer-events-none"
                                                        : ""
                                                }`}
                                            >
                                                <span className="text-sm text-slate-500 font-bold mr-1">
                                                    +
                                                </span>
                                                <DollarSign
                                                    size={16}
                                                    className="text-slate-400"
                                                />
                                                <input
                                                    type="number"
                                                    step="1"
                                                    min="0"
                                                    className="w-24 px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                                    placeholder="e.g. 25"
                                                    value={
                                                        formData.minPaymentFloor
                                                    }
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            minPaymentFloor:
                                                                parseFloat(
                                                                    e.target
                                                                        .value
                                                                ),
                                                        })
                                                    }
                                                />
                                                <span className="text-sm text-slate-700">
                                                    Minimum Floor
                                                    <br />
                                                    (Never pay less than...)
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Annual Fee Config (Collapsible) */}
                            <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !expandAnnualFee;
                                        openSection("fee", next);
                                    }}
                                    className="w-full flex items-center justify-between p-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                                >
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm font-bold text-slate-800">
                                            Annual Fee Settings
                                        </span>
                                    </div>
                                    <div className="flex items-center space-x-3">
                                        {!expandAnnualFee && (
                                            <span className="text-xs text-slate-500 font-medium">
                                                {enableAnnualFee
                                                    ? `$${formData.annualFee} / yr`
                                                    : "None"}
                                            </span>
                                        )}
                                        {expandAnnualFee ? (
                                            <ChevronUp
                                                size={18}
                                                className="text-slate-400"
                                            />
                                        ) : (
                                            <ChevronDown
                                                size={18}
                                                className="text-slate-400"
                                            />
                                        )}
                                    </div>
                                </button>
                                {expandAnnualFee && (
                                    <div className="p-4 pt-0 border-t border-slate-200 space-y-4 bg-slate-50 mt-2">
                                        <div
                                            className={`flex flex-col space-y-3 p-2 rounded border border-slate-200 transition-colors mt-2 ${
                                                enableAnnualFee
                                                    ? "bg-white"
                                                    : "bg-slate-50"
                                            }`}
                                        >
                                            <div className="flex items-center space-x-3">
                                                <input
                                                    type="checkbox"
                                                    id="enableAnnualFee"
                                                    checked={enableAnnualFee}
                                                    onChange={(e) => {
                                                        const checked =
                                                            e.target.checked;
                                                        setEnableAnnualFee(
                                                            checked
                                                        );
                                                        if (
                                                            checked &&
                                                            formData.annualFee ===
                                                                0
                                                        ) {
                                                            setFormData(
                                                                (prev) => ({
                                                                    ...prev,
                                                                    annualFee: 95,
                                                                })
                                                            );
                                                        } else if (!checked) {
                                                            setFormData(
                                                                (prev) => ({
                                                                    ...prev,
                                                                    annualFee: 0,
                                                                })
                                                            );
                                                        }
                                                    }}
                                                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 cursor-pointer"
                                                />
                                                <span className="text-sm font-medium text-slate-700">
                                                    Charge Annual Fee
                                                </span>
                                            </div>

                                            <div
                                                className={`pl-7 grid grid-cols-2 gap-4 ${
                                                    !enableAnnualFee
                                                        ? "opacity-40 pointer-events-none"
                                                        : ""
                                                }`}
                                            >
                                                <div>
                                                    <label className="block text-xs text-slate-500 mb-1">
                                                        Amount ($)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                                        value={
                                                            formData.annualFee
                                                        }
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                annualFee:
                                                                    parseFloat(
                                                                        e.target
                                                                            .value
                                                                    ),
                                                            })
                                                        }
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-slate-500 mb-1">
                                                        Frequency
                                                    </label>
                                                    <select
                                                        className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                                        value={
                                                            formData.isFeeMonthly
                                                                ? "MONTHLY"
                                                                : "ANNUAL"
                                                        }
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                isFeeMonthly:
                                                                    e.target
                                                                        .value ===
                                                                    "MONTHLY",
                                                            })
                                                        }
                                                    >
                                                        <option value="ANNUAL">
                                                            Annually (Once)
                                                        </option>
                                                        <option value="MONTHLY">
                                                            Monthly (Spread)
                                                        </option>
                                                    </select>
                                                </div>

                                                {!formData.isFeeMonthly && (
                                                    <div className="col-span-2">
                                                        <label className="block text-xs text-slate-500 mb-1">
                                                            Charged In
                                                        </label>
                                                        <select
                                                            className="w-full px-2 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                                                            value={
                                                                formData.feeMonth
                                                            }
                                                            onChange={(e) =>
                                                                setFormData({
                                                                    ...formData,
                                                                    feeMonth:
                                                                        parseInt(
                                                                            e
                                                                                .target
                                                                                .value
                                                                        ),
                                                                })
                                                            }
                                                        >
                                                            {MONTHS.map(
                                                                (m, i) => (
                                                                    <option
                                                                        key={i}
                                                                        value={
                                                                            i +
                                                                            1
                                                                        }
                                                                    >
                                                                        {m}
                                                                    </option>
                                                                )
                                                            )}
                                                        </select>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 border-t border-slate-200 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanced((v) => !v)}
                                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 flex items-center"
                                >
                                    {showAdvanced ? "Hide" : "Show"} Advanced
                                </button>
                                {showAdvanced && (
                                    <div className="mt-3 space-y-2">
                                        <p className="text-xs text-slate-500">
                                            Exclude this liability from specific
                                            income sources when splitting
                                            per-check on the Budget page.
                                        </p>
                                        <label className="flex items-center space-x-2 text-sm text-slate-700">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 text-indigo-600 rounded border-slate-300"
                                                checked={
                                                    formData.excludeFromSplitting ||
                                                    false
                                                }
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        excludeFromSplitting:
                                                            e.target.checked,
                                                    })
                                                }
                                            />
                                            <span className="font-medium">
                                                Exclude from Expense Splitting
                                                Strategy
                                            </span>
                                        </label>
                                        <p className="text-[11px] text-slate-500 ml-6">
                                            When checked, this liability won't
                                            be split; it stays with its owner.
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {eligibleIncomes.map((inc) => {
                                                const checked =
                                                    formData.excludedIncomeSourceIds?.includes(
                                                        inc.id
                                                    ) || false;
                                                return (
                                                    <label
                                                        key={inc.id}
                                                        className={`flex items-center justify-between px-3 py-2 rounded-lg border ${
                                                            checked
                                                                ? "border-indigo-200 bg-indigo-50"
                                                                : "border-slate-200 bg-white"
                                                        }`}
                                                    >
                                                        <div>
                                                            <p className="text-sm font-medium text-slate-800">
                                                                {inc.name}
                                                            </p>
                                                            <p className="text-[11px] text-slate-500">
                                                                {inc.isPartner
                                                                    ? partnerFirstWord
                                                                    : "You"}{" "}
                                                                {" - "}
                                                                {inc.amount.toLocaleString()}{" "}
                                                                per pay
                                                            </p>
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            className="w-4 h-4 text-indigo-600 rounded border-slate-300"
                                                            checked={checked}
                                                            onChange={(e) => {
                                                                const next =
                                                                    new Set(
                                                                        formData.excludedIncomeSourceIds ||
                                                                            []
                                                                    );
                                                                if (
                                                                    e.target
                                                                        .checked
                                                                ) {
                                                                    next.add(
                                                                        inc.id
                                                                    );
                                                                } else {
                                                                    next.delete(
                                                                        inc.id
                                                                    );
                                                                }
                                                                setFormData({
                                                                    ...formData,
                                                                    excludedIncomeSourceIds:
                                                                        Array.from(
                                                                            next
                                                                        ),
                                                                });
                                                            }}
                                                        />
                                                    </label>
                                                );
                                            })}
                                            {eligibleIncomes.length === 0 && (
                                                <p className="text-xs text-slate-400">
                                                    No eligible income sources
                                                    (others are excluded from
                                                    Budget).
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Ownership Selector */}
                            <div>
                                <label className="text-sm font-bold text-slate-800 ml-2 mb-2">
                                    Liability Ownership
                                </label>
                                <div className="flex bg-slate-100 p-1 rounded-lg">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setFormData({
                                                ...formData,
                                                owner: "USER",
                                            })
                                        }
                                        className={`flex-1 py-2 text-xs font-medium rounded-md flex items-center justify-center space-x-1 transition-all ${
                                            formData.owner === "USER"
                                                ? "bg-white shadow text-indigo-700"
                                                : "text-slate-500 hover:text-slate-700"
                                        }`}
                                    >
                                        <User size={14} /> <span>Me</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setFormData({
                                                ...formData,
                                                owner: "JOINT",
                                            })
                                        }
                                        className={`flex-1 py-2 text-xs font-medium rounded-md flex items-center justify-center space-x-1 transition-all ${
                                            formData.owner === "JOINT" ||
                                            !formData.owner
                                                ? "bg-white shadow text-purple-700"
                                                : "text-slate-500 hover:text-slate-700"
                                        }`}
                                    >
                                        <Users size={14} /> <span>Joint</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setFormData({
                                                ...formData,
                                                owner: "PARTNER",
                                            })
                                        }
                                        className={`flex-1 py-2 text-xs font-medium rounded-md flex items-center justify-center space-x-1 transition-all ${
                                            formData.owner === "PARTNER"
                                                ? "bg-white shadow text-pink-700"
                                                : "text-slate-500 hover:text-slate-700"
                                        }`}
                                    >
                                        <User size={14} />{" "}
                                        <span>{partnerFirstWord}</span>
                                    </button>
                                </div>
                            </div>

                            {/* Live Preview */}
                            <label className="text-sm font-bold text-slate-800 ml-2 mb-2">
                                Preview
                            </label>
                            <div className="bg-indigo-50/50 p-1 rounded-lg border border-indigo-100 text-xs text-slate-600">
                                Based on current balance & month, estimated
                                monthly payment is:
                                <span className="font-bold text-indigo-700 ml-1 text-sm">
                                    $
                                    {(() => {
                                        const mockLiability: Liability = {
                                            id: "temp",
                                            ...formData,

                                            // Ensure toggled-off values are 0 in preview
                                            minPaymentPercentage: enablePercent
                                                ? formData.minPaymentPercentage
                                                : 0,
                                            minPaymentAmount: (() => {
                                                if (!enableFixed) return 0;
                                                if (
                                                    formData.paymentFrequency ===
                                                    "BI_WEEKLY"
                                                ) {
                                                    return (
                                                        formData.minPaymentAmount *
                                                        (24 / 26)
                                                    );
                                                }
                                                return formData.minPaymentAmount;
                                            })(),
                                            minPaymentFloor: enableFloor
                                                ? formData.minPaymentFloor
                                                : 0,
                                            annualFee: enableAnnualFee
                                                ? formData.annualFee
                                                : 0,
                                            minPaymentPlusFees:
                                                formData.minPaymentPlusFees, // ensure toggle is respected
                                        };

                                        const baseBalance =
                                            formData.balance ||
                                            formData.startingBalance ||
                                            0;
                                        let currentFee = 0;

                                        // Logic to show fee impact in preview
                                        if (
                                            enableAnnualFee &&
                                            formData.annualFee > 0
                                        ) {
                                            if (formData.isFeeMonthly) {
                                                currentFee =
                                                    formData.annualFee / 12;
                                            } else {
                                                // If current month matches selected fee month, show full fee
                                                const currentMonth =
                                                    new Date().getMonth() + 1;
                                                if (
                                                    currentMonth ===
                                                    formData.feeMonth
                                                ) {
                                                    currentFee =
                                                        formData.annualFee;
                                                }
                                            }
                                        }

                                        const monthlyInt =
                                            baseBalance *
                                            (formData.interestRate / 100 / 12);
                                        const val = getMinPayment(
                                            mockLiability,
                                            baseBalance,
                                            monthlyInt,
                                            currentFee
                                        );
                                        return val.toFixed(2);
                                    })()}
                                </span>
                            </div>

                            <div className="pt-1 flex justify-between space-x-3">
                                {editingId ? (
                                    <button
                                        type="button"
                                        onClick={handleResetLiabilitySettings}
                                        className="px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-colors"
                                    >
                                        Reset Liability
                                    </button>
                                ) : (
                                    <span />
                                )}
                                <button
                                    type="button"
                                    onClick={() => setIsFormModalOpen(false)}
                                    className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md transition-colors flex items-center"
                                >
                                    <Save size={18} className="mr-2" />
                                    Save Liability
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Amortization Modal */}
            {isSettingsOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                            <div>
                                <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
                                    Liability Settings
                                </p>
                                <h3 className="text-lg font-bold text-slate-900">
                                    Priority Order
                                </h3>
                            </div>
                            <button
                                className="text-slate-400 hover:text-slate-600"
                                onClick={() => setIsSettingsOpen(false)}
                                aria-label="Close settings"
                            >
                                <X size={22} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <p className="text-xs text-slate-500">
                                Drag to reorder liabilities. The list order is
                                saved as your priority.
                            </p>
                            <div className="space-y-2">
                                {orderedPriorityIds.map((lid, idx) => {
                                    const l = liabilities.find(
                                        (x) => x.id === lid
                                    );
                                    if (!l) return null;
                                    return (
                                        <div
                                            key={l.id}
                                            draggable
                                            onDragStart={() =>
                                                handleDragStartPriority(l.id)
                                            }
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                handleDragOverPriority(l.id);
                                            }}
                                            className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 cursor-move"
                                        >
                                            <div className="flex items-center space-x-2">
                                                <GripVertical
                                                    size={16}
                                                    className="text-slate-400"
                                                />
                                                <span className="text-xs font-semibold text-slate-500 w-6">
                                                    {idx + 1}
                                                </span>
                                                <div className="text-sm text-slate-700 truncate">
                                                    <span className="font-semibold">
                                                        {l.name}
                                                    </span>
                                                    {l.category && (
                                                        <span className="ml-2 text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                                                            {l.category}
                                                        </span>
                                                    )}
                                                    <span className="text-slate-400 text-xs ml-2">
                                                        $
                                                        {getDisplayBalance(
                                                            l
                                                        ).toLocaleString()}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
                            <button
                                type="button"
                                className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 font-medium transition-colors"
                                onClick={() => setIsSettingsOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={savePriorityOrder}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition-colors"
                            >
                                Save Order
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isAmortizationOpen && viewingLiability && amortizationData && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col animate-fade-in-up">
                        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 flex items-center">
                                    <FileText
                                        size={20}
                                        className="mr-2 text-indigo-600"
                                    />
                                    Amortization Schedule
                                </h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    Projected payoff for{" "}
                                    <strong>{viewingLiability.name}</strong>.
                                </p>
                            </div>
                            <button
                                onClick={() => setIsAmortizationOpen(false)}
                                className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full transition-colors"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {/* Warning for Infinite Liability */}
                        {amortizationData.isInfinite && (
                            <div className="p-4 bg-red-50 border-b border-red-100 flex items-start gap-3">
                                <AlertTriangle
                                    className="text-red-500 shrink-0"
                                    size={20}
                                />
                                <div className="text-sm text-red-700">
                                    <strong>Warning:</strong> Your monthly
                                    interest is higher than your fixed payment.
                                    You will never pay off this liability at
                                    this rate.
                                </div>
                            </div>
                        )}

                        {/* Summary Stats */}
                        {!amortizationData.isInfinite && (
                            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-200">
                                <div className="p-4 text-center">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                        Time to Payoff
                                    </p>
                                    <p className="text-xl font-bold text-slate-900 mt-1">
                                        {Math.floor(
                                            (payoffMonthsRemaining ??
                                                amortizationData.months) / 12
                                        )}
                                        y{" "}
                                        {(payoffMonthsRemaining ??
                                            amortizationData.months) % 12}
                                        m
                                    </p>
                                </div>
                                <div className="p-4 text-center">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                        Total Interest
                                    </p>
                                    <p className="text-xl font-bold text-red-500 mt-1">
                                        $
                                        {(
                                            amortizationSummary?.totalInterestToDate ??
                                            0
                                        ).toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}
                                    </p>
                                </div>
                                <div className="p-4 text-center">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                        Total Cost
                                    </p>
                                    <p className="text-xl font-bold text-slate-900 mt-1">
                                        $
                                        {(
                                            amortizationSummary?.totalPaymentsToDate ??
                                            0
                                        ).toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}
                                    </p>
                                    {amortizationData.totalFees > 0 && (
                                        <p className="text-xs text-slate-400 mt-1">
                                            (Includes $
                                            {amortizationData.totalFees.toLocaleString()}{" "}
                                            in fees)
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Table Content */}
                        <AmortizationTable
                            amortizationData={amortizationData}
                            viewingLiability={viewingLiability}
                            paymentsByCheckDate={paymentsByCheckDate}
                            amortizationOverridesForViewing={
                                amortizationOverridesForViewing
                            }
                            minimumPaidByPeriod={minimumPaidByPeriod}
                            editingAmortizationRow={editingAmortizationRow}
                            amortizationEdit={amortizationEdit}
                            amortizationEditPurchase={amortizationEditPurchase}
                            amortizationEditDate={amortizationEditDate}
                            setAmortizationEditDate={setAmortizationEditDate}
                        >
                            <div className="flex-1 overflow-y-auto p-0">
                                <table className="w-full text-left border-collapse relative">
                                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                                #
                                            </th>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                                Date
                                            </th>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                                Payment
                                            </th>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                                Purchase
                                            </th>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                                Principal
                                            </th>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                                Interest
                                            </th>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                                Fees
                                            </th>
                                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                                Balance
                                            </th>
                                            <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {amortizationData.timeline.length ===
                                            0 &&
                                            !amortizationData.isInfinite && (
                                                <tr>
                                                    <td
                                                        colSpan={6}
                                                        className="px-6 py-8 text-center text-slate-400"
                                                    >
                                                        Liability is already
                                                        paid off or data is
                                                        unavailable.
                                                    </td>
                                                </tr>
                                            )}
                                        {amortizationData.timeline.map(
                                            (row, idx) => {
                                                const paymentNumber = idx + 1;
                                                const paymentDate =
                                                    getPaymentDateForRow(
                                                        row.month,
                                                        viewingLiability
                                                    );
                                                const displayDate =
                                                    row.actualDate
                                                        ? parseLocalDate(
                                                              row.actualDate
                                                          ) || paymentDate
                                                        : paymentDate;
                                                const today = new Date();
                                                today.setHours(0, 0, 0, 0);
                                                const isPastDue =
                                                    displayDate <= today;
                                                const matchingPayment =
                                                    row.actualDate
                                                        ? paymentsByCheckDate.get(
                                                              row.actualDate
                                                          )
                                                        : undefined;
                                                const override =
                                                    amortizationOverridesForViewing[
                                                        row.month
                                                    ];
                                                const rawOverridePayment =
                                                    override?.payment;
                                                const rawOverridePurchase =
                                                    override?.purchase;
                                                const displayPayment = override
                                                    ? rawOverridePayment ??
                                                      row.payment
                                                    : row.payment;
                                                const displayInterest = override
                                                    ? override.interest
                                                    : row.interest;
                                                const hasEditableRow = Boolean(
                                                    matchingPayment ||
                                                        override ||
                                                        ((viewingLiability
                                                            .startingBalance ||
                                                            0) > 0 &&
                                                            isPastDue)
                                                );
                                                const isEditingRow =
                                                    editingAmortizationRow ===
                                                    row.month;
                                                const editPaymentValue =
                                                    isEditingRow
                                                        ? parseFloat(
                                                              amortizationEdit.payment
                                                          )
                                                        : NaN;
                                                const editPurchaseValue =
                                                    isEditingRow
                                                        ? parseFloat(
                                                              amortizationEditPurchase
                                                          )
                                                        : NaN;
                                                const editInterestValue =
                                                    isEditingRow
                                                        ? parseFloat(
                                                              amortizationEdit.interest
                                                          )
                                                        : NaN;
                                                const basePayment =
                                                    isEditingRow &&
                                                    Number.isFinite(
                                                        editPaymentValue
                                                    )
                                                        ? editPaymentValue
                                                        : displayPayment;
                                                const basePurchase =
                                                    isEditingRow &&
                                                    Number.isFinite(
                                                        editPurchaseValue
                                                    )
                                                        ? editPurchaseValue
                                                        : override?.purchase !==
                                                          undefined
                                                        ? rawOverridePurchase ||
                                                          0
                                                        : basePayment < 0
                                                        ? Math.abs(basePayment)
                                                        : 0;
                                                const effectivePayment =
                                                    basePayment < 0 &&
                                                    !isEditingRow &&
                                                    override?.purchase ===
                                                        undefined
                                                        ? basePayment
                                                        : basePayment -
                                                          basePurchase;
                                                const effectiveInterest =
                                                    isEditingRow &&
                                                    Number.isFinite(
                                                        editInterestValue
                                                    )
                                                        ? editInterestValue
                                                        : displayInterest;
                                                const displayPurchase =
                                                    Math.max(
                                                        0,
                                                        isEditingRow &&
                                                            Number.isFinite(
                                                                editPurchaseValue
                                                            )
                                                            ? editPurchaseValue
                                                            : basePurchase
                                                    );
                                                const displayPrincipal =
                                                    override || isEditingRow
                                                        ? effectivePayment -
                                                          effectiveInterest
                                                        : row.principal;
                                                const requiredDue = Math.max(
                                                    0,
                                                    row.payment -
                                                        (row.extraPayment || 0)
                                                );
                                                const paidForPeriod =
                                                    minimumPaidByPeriod[
                                                        row.month
                                                    ] || 0;
                                                const remainingDue = Math.max(
                                                    0,
                                                    requiredDue - paidForPeriod
                                                );
                                                const isPaid = Boolean(
                                                    row.isHistorical ||
                                                        matchingPayment ||
                                                        (requiredDue > 0 &&
                                                            paidForPeriod >=
                                                                requiredDue) ||
                                                        ((viewingLiability
                                                            .startingBalance ||
                                                            0) > 0 &&
                                                            isPastDue)
                                                );
                                                const showMinimumProgress =
                                                    requiredDue > 0 &&
                                                    paidForPeriod > 0 &&
                                                    paidForPeriod <
                                                        requiredDue &&
                                                    !isPaid;

                                                return (
                                                    <tr
                                                        key={row.month}
                                                        className={`transition-colors ${
                                                            isPaid
                                                                ? "bg-green-50"
                                                                : "hover:bg-slate-50"
                                                        }`}
                                                    >
                                                        <td className="px-6 py-3 text-sm font-mono text-slate-600 font-medium flex items-center space-x-2">
                                                            {isPaid && (
                                                                <CheckCircle
                                                                    size={14}
                                                                    className="text-emerald-500"
                                                                />
                                                            )}
                                                            <span>
                                                                {paymentNumber}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-3 text-sm font-mono text-slate-500">
                                                            {isEditingRow &&
                                                            matchingPayment ? (
                                                                <input
                                                                    type="date"
                                                                    className="w-32 px-2 py-1 border border-slate-300 rounded-md text-sm"
                                                                    value={
                                                                        amortizationEditDate ||
                                                                        matchingPayment.checkDate ||
                                                                        row.actualDate ||
                                                                        toLocalDateString(
                                                                            displayDate
                                                                        )
                                                                    }
                                                                    onChange={(
                                                                        e
                                                                    ) =>
                                                                        setAmortizationEditDate(
                                                                            e
                                                                                .target
                                                                                .value
                                                                        )
                                                                    }
                                                                />
                                                            ) : (
                                                                displayDate.toLocaleDateString(
                                                                    "en-US",
                                                                    {
                                                                        month: "short",
                                                                        day: "numeric",
                                                                        year: "2-digit",
                                                                    }
                                                                )
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-3 text-sm text-slate-900 font-mono text-right">
                                                            {isEditingRow ? (
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="w-24 px-2 py-1 border border-slate-300 rounded-md text-right text-sm"
                                                                    value={
                                                                        amortizationEdit.payment
                                                                    }
                                                                    onChange={(
                                                                        e
                                                                    ) =>
                                                                        setAmortizationEdit(
                                                                            (
                                                                                prev
                                                                            ) => ({
                                                                                ...prev,
                                                                                payment:
                                                                                    e
                                                                                        .target
                                                                                        .value,
                                                                            })
                                                                        )
                                                                    }
                                                                />
                                                            ) : (
                                                                <>
                                                                    {displayPayment <
                                                                    0
                                                                        ? "-"
                                                                        : `$${displayPayment.toFixed(
                                                                              2
                                                                          )}`}
                                                                    {row.extraPayment &&
                                                                    !row.isHistorical ? (
                                                                        <div className="text-[10px] text-emerald-600 font-semibold">
                                                                            +$
                                                                            {row.extraPayment.toFixed(
                                                                                2
                                                                            )}{" "}
                                                                            extra
                                                                        </div>
                                                                    ) : null}
                                                                    {showMinimumProgress ? (
                                                                        <div className="text-[10px] text-amber-600 font-semibold">
                                                                            *Allocated
                                                                            $
                                                                            {paidForPeriod.toFixed(
                                                                                2
                                                                            )}
                                                                        </div>
                                                                    ) : null}
                                                                </>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-3 text-sm font-mono text-right text-slate-700">
                                                            {isEditingRow ? (
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="w-20 px-2 py-1 border border-slate-300 rounded-md text-right text-sm"
                                                                    value={
                                                                        amortizationEditPurchase
                                                                    }
                                                                    onChange={(
                                                                        e
                                                                    ) =>
                                                                        setAmortizationEditPurchase(
                                                                            e
                                                                                .target
                                                                                .value
                                                                        )
                                                                    }
                                                                />
                                                            ) : displayPurchase >
                                                              0 ? (
                                                                `$${displayPurchase.toFixed(
                                                                    2
                                                                )}`
                                                            ) : (
                                                                "-"
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-3 text-sm font-mono text-green-600 text-right font-medium">
                                                            $
                                                            {displayPrincipal.toFixed(
                                                                2
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-3 text-sm font-mono text-red-500 text-right">
                                                            {isEditingRow ? (
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    className="w-20 px-2 py-1 border border-slate-300 rounded-md text-right text-sm text-red-500"
                                                                    value={
                                                                        amortizationEdit.interest
                                                                    }
                                                                    onChange={(
                                                                        e
                                                                    ) =>
                                                                        setAmortizationEdit(
                                                                            (
                                                                                prev
                                                                            ) => ({
                                                                                ...prev,
                                                                                interest:
                                                                                    e
                                                                                        .target
                                                                                        .value,
                                                                            })
                                                                        )
                                                                    }
                                                                />
                                                            ) : (
                                                                <>
                                                                    $
                                                                    {displayInterest.toFixed(
                                                                        2
                                                                    )}
                                                                </>
                                                            )}
                                                        </td>
                                                        <td
                                                            className={`px-6 py-3 text-sm font-mono text-right ${
                                                                row.fees > 0
                                                                    ? "text-orange-600 font-bold"
                                                                    : "text-slate-400"
                                                            }`}
                                                        >
                                                            {row.fees > 0
                                                                ? `$${row.fees.toFixed(
                                                                      2
                                                                  )}`
                                                                : "-"}
                                                        </td>
                                                        <td className="px-6 py-3 text-sm font-mono text-slate-700 text-right font-mono">
                                                            $
                                                            {row.remainingBalance.toFixed(
                                                                2
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-xs text-slate-500">
                                                            {hasEditableRow ? (
                                                                <div className="inline-flex gap-2">
                                                                    {isEditingRow ? (
                                                                        <>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    saveAmortizationRowEdit(
                                                                                        row,
                                                                                        matchingPayment
                                                                                    )
                                                                                }
                                                                                className="px-2 py-1 border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50"
                                                                            >
                                                                                Save
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={
                                                                                    cancelEditAmortizationRow
                                                                                }
                                                                                className="px-2 py-1 border border-slate-200 rounded hover:bg-slate-50"
                                                                            >
                                                                                Cancel
                                                                            </button>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    startEditAmortizationRow(
                                                                                        row
                                                                                    );
                                                                                }}
                                                                                className="inline-flex items-center justify-center w-8 h-8 border border-slate-200 rounded hover:bg-slate-50"
                                                                                aria-label="Edit amortization row"
                                                                                title="Edit"
                                                                            >
                                                                                <Edit2 className="w-4 h-4" />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    matchingPayment
                                                                                        ? deletePayment(
                                                                                              matchingPayment.id
                                                                                          )
                                                                                        : deleteAmortizationOverrideRow(
                                                                                              viewingLiability.id,
                                                                                              row.month
                                                                                          )
                                                                                }
                                                                                className="inline-flex items-center justify-center w-8 h-8 border border-red-200 text-red-600 rounded hover:bg-red-50"
                                                                                aria-label="Delete amortization row"
                                                                                title="Delete"
                                                                            >
                                                                                <Trash2 className="w-4 h-4" />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            ) : null}
                                                        </td>
                                                    </tr>
                                                );
                                            }
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </AmortizationTable>

                        {viewingLiability && (
                            <div className="px-6 py-4 border-t border-slate-200 bg-white flex flex-col gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                        {editingPaymentId
                                            ? "Edit Historical Payment"
                                            : "Add Historical Payment"}
                                    </p>
                                    <p className="text-sm text-slate-500">
                                        These are applied directly into the
                                        amortization table.
                                    </p>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">
                                                Date
                                            </label>
                                            {editingPaymentId ? (
                                                <input
                                                    type="date"
                                                    className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    value={editPayment.date}
                                                    onChange={(e) =>
                                                        setEditPayment(
                                                            (prev) => ({
                                                                ...prev,
                                                                date: e.target
                                                                    .value,
                                                            })
                                                        )
                                                    }
                                                />
                                            ) : (
                                                <input
                                                    type="date"
                                                    className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    defaultValue=""
                                                    ref={historicalDateRef}
                                                    onChange={() =>
                                                        setHistoricalPaymentError(
                                                            null
                                                        )
                                                    }
                                                />
                                            )}
                                            {!editingPaymentId &&
                                                historicalPaymentError && (
                                                    <p className="mt-1 text-xs text-rose-600">
                                                        {historicalPaymentError}
                                                    </p>
                                                )}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">
                                                Payment
                                            </label>
                                            {editingPaymentId ? (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    value={editPayment.amount}
                                                    onChange={(e) =>
                                                        setEditPayment(
                                                            (prev) => ({
                                                                ...prev,
                                                                amount:
                                                                    parseFloat(
                                                                        e.target
                                                                            .value
                                                                    ) || 0,
                                                            })
                                                        )
                                                    }
                                                />
                                            ) : (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    defaultValue="0"
                                                    ref={historicalAmountRef}
                                                />
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">
                                                Purchase
                                            </label>
                                            {editingPaymentId ? (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    value={editPaymentPurchase}
                                                    onChange={(e) =>
                                                        setEditPaymentPurchase(
                                                            parseFloat(
                                                                e.target.value
                                                            ) || 0
                                                        )
                                                    }
                                                />
                                            ) : (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    defaultValue="0"
                                                    ref={historicalPurchaseRef}
                                                />
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">
                                                Interest
                                            </label>
                                            {editingPaymentId ? (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    value={editPaymentInterest}
                                                    onChange={(e) =>
                                                        setEditPaymentInterest(
                                                            parseFloat(
                                                                e.target.value
                                                            ) || 0
                                                        )
                                                    }
                                                />
                                            ) : (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                                                    defaultValue="0"
                                                    ref={historicalInterestRef}
                                                />
                                            )}
                                        </div>
                                        {editingPaymentId ? (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={saveEditedPayment}
                                                    className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 transition-colors"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelEditPayment}
                                                    className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={addHistoricalPayment}
                                                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 transition-colors"
                                            >
                                                Add
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end">
                            <button
                                onClick={() => setIsAmortizationOpen(false)}
                                className="px-5 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium rounded-lg transition-colors shadow-sm"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LiabilityList;
