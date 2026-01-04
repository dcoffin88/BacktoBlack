import React, { useEffect, useMemo, useState } from "react";
import { Liability, Ownership, UserSettings } from "../types";
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
    ChevronDown,
    ChevronUp,
    User,
    Users,
    CheckCircle,
} from "lucide-react";
import { dbAPI } from "../server/db";

interface LiabilityListProps {
    liabilities: Liability[];
    onSave: (liability: Liability) => void;
    onDelete: (id: string) => void;
    settings?: UserSettings;
}

const LiabilityList: React.FC<LiabilityListProps> = ({
    liabilities,
    onSave,
    onDelete,
    settings,
}) => {
    // Modal States
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isAmortizationOpen, setIsAmortizationOpen] = useState(false);

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
    const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);

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
        return () => {
            active = false;
        };
    }, []);

    const getPeriodIndexFromDate = (
        liability: Liability,
        checkDate?: string | null
    ) => {
        if (!checkDate) return null;
        const target = new Date(checkDate);
        if (Number.isNaN(target.getTime())) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const freq = liability.paymentFrequency || "MONTHLY";

        if (freq === "WEEKLY" || freq === "BI_WEEKLY") {
            const intervalDays = freq === "WEEKLY" ? 7 : 14;
            const diffDays =
                (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
            const periodsFromNow = Math.max(
                0,
                Math.round(diffDays / intervalDays)
            );
            return periodsFromNow + 1;
        }

        const baseMonth = today.getFullYear() * 12 + today.getMonth();
        const targetMonth = target.getFullYear() * 12 + target.getMonth();
        const monthDiff = targetMonth - baseMonth;
        return Math.max(0, monthDiff) + 1;
    };

    // Form State
    const [formData, setFormData] = useState<Omit<Liability, "id">>({
        name: "",
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

    // --- CRUD Handlers ---
    const handleOpenFormModal = (liability?: Liability) => {
        const todayStr = new Date().toISOString().split("T")[0];

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
                balance: liability.balance,
                startingBalance: liability.startingBalance || liability.balance,
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
        if (!enablePercent) finalData.minPaymentPercentage = 0;
        if (!enableFixed) finalData.minPaymentAmount = 0;
        if (!enableFloor) finalData.minPaymentFloor = 0;
        if (!enableAnnualFee) finalData.annualFee = 0;
        finalData.customOrder = Number(finalData.customOrder) || 0;

        // Ensure starting balance is at least the current balance if not set
        if (finalData.startingBalance < finalData.balance) {
            finalData.startingBalance = finalData.balance;
        }
        if (!finalData.nextDueDate) {
            finalData.nextDueDate = new Date().toISOString().split("T")[0];
        }

        if (editingId) {
            onSave({ ...finalData, id: editingId });
        } else {
            const newLiability: Liability = {
                ...finalData,
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

    // --- Amortization Handlers ---
    const handleViewAmortization = (liability: Liability) => {
        const extrasMap = extraPayments
            .filter((p) => p.liabilityId === liability.id)
            .reduce<Record<number, number>>((acc, p) => {
                const period = getPeriodIndexFromDate(liability, p.checkDate);
                if (!period) return acc;
                acc[period] = (acc[period] || 0) + p.amount;
                return acc;
            }, {});

        const data = calculateIndividualAmortization(liability, extrasMap);
        setViewingLiability(liability);
        setAmortizationData(data);
        setIsAmortizationOpen(true);
    };

    const renderMinPaymentLabel = (liability: Liability) => {
        const monthlyInt =
            liability.balance * (liability.interestRate / 100 / 12);
        // Estimate fee for label context - show monthly equivalent
        const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
        const val = getMinPayment(
            liability,
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

    const addDays = (date: Date, days: number) => {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return d;
    };

    const getNextDueDate = (liability: Liability) => {
        const today = new Date();
        const isBiWeekly = liability.paymentFrequency === "BI_WEEKLY";
        const isWeekly = liability.paymentFrequency === "WEEKLY";
        if (isBiWeekly || isWeekly) {
            const interval = isBiWeekly ? 14 : 7;
            let anchor = liability.nextDueDate
                ? new Date(liability.nextDueDate)
                : new Date(
                      today.getFullYear(),
                      today.getMonth(),
                      liability.dueDate || 1
                  );
            let guard = 0;
            while (anchor < today && guard < 500) {
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
            today.getFullYear(),
            today.getMonth(),
            liability.dueDate
        );
        if (target < today) {
            target = new Date(
                today.getFullYear(),
                today.getMonth() + 1,
                liability.dueDate
            );
        }
        return target.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });
    };

    const getPaymentDateForRow = (rowIndex: number, liability: Liability) => {
        const today = new Date();
        const isBiWeekly = liability.paymentFrequency === "BI_WEEKLY";
        const isWeekly = liability.paymentFrequency === "WEEKLY";
        const intervalDays = isBiWeekly ? 14 : isWeekly ? 7 : null;

        if (intervalDays) {
            let anchor = liability.nextDueDate
                ? new Date(liability.nextDueDate)
                : new Date(
                      today.getFullYear(),
                      today.getMonth(),
                      liability.dueDate || 1
                  );
            let guard = 0;
            while (anchor > today && guard < 500) {
                anchor = addDays(anchor, -intervalDays);
                guard++;
            }
            return addDays(anchor, (rowIndex - 1) * intervalDays);
        }

        // Monthly payments
        let anchor = new Date(
            today.getFullYear(),
            today.getMonth(),
            liability.dueDate || 1
        );
        let guard = 0;
        while (anchor > today && guard < 120) {
            anchor = new Date(
                anchor.getFullYear(),
                anchor.getMonth() - 1,
                liability.dueDate || 1
            );
            guard++;
        }
        return new Date(
            anchor.getFullYear(),
            anchor.getMonth() + rowIndex - 1,
            liability.dueDate || 1
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
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">
                        Liabilities
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Manage liabilities and loan details.
                    </p>
                </div>
                <button
                    onClick={() => handleOpenFormModal()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium shadow-sm flex items-center transition-colors"
                >
                    <Plus size={18} className="mr-2" />
                    Add Liability
                </button>
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
                                            sortBy === "interestRate" && d === "asc"
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
                                                a.name.localeCompare(b.name) * dir
                                            );
                                        }
                                        if (sortBy === "balance") {
                                            return (a.balance - b.balance) * dir;
                                        }
                                        if (sortBy === "interestRate") {
                                            return (
                                                (a.interestRate - b.interestRate) *
                                                dir
                                            );
                                        }
                                        return 0;
                                    })
                                    .map((liability) => {
                                    const percentPaid =
                                        liability.startingBalance > 0
                                            ? Math.max(
                                                  0,
                                                  Math.min(
                                                      100,
                                                      ((liability.startingBalance -
                                                          liability.balance) /
                                                          liability.startingBalance) *
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
                                                <div className="font-medium text-slate-900">
                                                    {liability.name}
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
                                                    Custom Priority #
                                                    {liability.customOrder ||
                                                        "-"}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="font-medium text-slate-700">
                                                    $
                                                    {liability.balance.toLocaleString()}
                                                </div>
                                                {liability.startingBalance >
                                                    liability.balance && (
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
                                                    {liability.interestRate}%
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
                                                        <FileText size={16} />
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
                                                {formData.balance.toLocaleString()}
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
                                                Category (Opt)
                                            </label>
                                            <input
                                                type="text"
                                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                placeholder="e.g. Auto Loan"
                                                value={formData.category}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        category: e.target.value,
                                                    })
                                                }
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                                    Current Balance ($)
                                                </label>
                                                <input
                                                    required
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                    value={formData.balance}
                                                    onChange={(e) => {
                                                        const val = parseFloat(
                                                            e.target.value
                                                        );
                                                        // Auto-update starting balance if it hasn't been touched or is less than new balance for new liabilities
                                                        if (
                                                            !editingId &&
                                                            val >
                                                                formData.startingBalance
                                                        ) {
                                                            setFormData({
                                                                ...formData,
                                                                balance: val,
                                                                startingBalance:
                                                                    val,
                                                            });
                                                        } else {
                                                            setFormData({
                                                                ...formData,
                                                                balance: val,
                                                            });
                                                        }
                                                    }}
                                                />
                                            </div>
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
                                                                ),
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
                                                    step="0.01"
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

                                        <div className="grid grid-cols-3 gap-3">
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
                                                    Custom Priority
                                                </label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                                    value={formData.customOrder}
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            customOrder:
                                                                parseInt(
                                                                    e.target
                                                                        .value
                                                                ) || 1,
                                                        })
                                                    }
                                                />
                                                <p className="text-[11px] text-slate-500 mt-1">
                                                    Used to order debts in the
                                                    Custom Plan strategy.
                                                </p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                                    Credit Limit (Opt)
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
                                        <div>
                                            {(formData.paymentFrequency ===
                                                "BI_WEEKLY" ||
                                                formData.paymentFrequency ===
                                                    "WEEKLY") && (
                                                <div className="mt-3">
                                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                                        Next Due Date (anchor
                                                        for{" "}
                                                        {formData.paymentFrequency ===
                                                        "BI_WEEKLY"
                                                            ? "bi-weekly"
                                                            : "weekly"}
                                                        )
                                                    </label>
                                                    <input
                                                        type="date"
                                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        value={
                                                            formData.nextDueDate ||
                                                            ""
                                                        }
                                                        onChange={(e) =>
                                                            setFormData({
                                                                ...formData,
                                                                nextDueDate:
                                                                    e.target
                                                                        .value,
                                                            })
                                                        }
                                                    />
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        We’ll repeat every{" "}
                                                        {formData.paymentFrequency ===
                                                        "BI_WEEKLY"
                                                            ? "14"
                                                            : "7"}{" "}
                                                        days from this date.
                                                    </p>
                                                </div>
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
                                            minPaymentAmount: enableFixed
                                                ? formData.minPaymentAmount
                                                : 0,
                                            minPaymentFloor: enableFloor
                                                ? formData.minPaymentFloor
                                                : 0,
                                            annualFee: enableAnnualFee
                                                ? formData.annualFee
                                                : 0,
                                            minPaymentPlusFees:
                                                formData.minPaymentPlusFees, // ensure toggle is respected
                                        };

                                        let effectiveBalance = formData.balance;
                                        let currentFee = 0;

                                        // Logic to show fee impact in preview
                                        if (
                                            enableAnnualFee &&
                                            formData.annualFee > 0
                                        ) {
                                            if (formData.isFeeMonthly) {
                                                currentFee =
                                                    formData.annualFee / 12;
                                                effectiveBalance += currentFee;
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
                                                    effectiveBalance +=
                                                        currentFee;
                                                }
                                            }
                                        }

                                        const monthlyInt =
                                            effectiveBalance *
                                            (formData.interestRate / 100 / 12);
                                        const val = getMinPayment(
                                            mockLiability,
                                            effectiveBalance,
                                            monthlyInt,
                                            currentFee
                                        );
                                        return val.toFixed(2);
                                    })()}
                                </span>
                            </div>

                            <div className="pt-1 flex justify-end space-x-3">
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
            {isAmortizationOpen && viewingLiability && amortizationData && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col animate-fade-in-up">
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
                                            amortizationData.months / 12
                                        )}
                                        y {amortizationData.months % 12}m
                                    </p>
                                </div>
                                <div className="p-4 text-center">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                        Total Interest
                                    </p>
                                    <p className="text-xl font-bold text-red-500 mt-1">
                                        $
                                        {amortizationData.totalInterest.toLocaleString(
                                            undefined,
                                            { maximumFractionDigits: 2 }
                                        )}
                                    </p>
                                </div>
                                <div className="p-4 text-center">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                        Total Cost
                                    </p>
                                    <p className="text-xl font-bold text-slate-900 mt-1">
                                        $
                                        {(
                                            viewingLiability.balance +
                                            amortizationData.totalInterest +
                                            (amortizationData.totalFees || 0)
                                        ).toLocaleString(undefined, {
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
                        <div className="flex-1 overflow-y-auto p-0">
                            <table className="w-full text-left border-collapse relative">
                                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                            Payment #
                                        </th>
                                        <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                            Date
                                        </th>
                                        <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">
                                            Payment
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
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    {amortizationData.timeline.length === 0 &&
                                        !amortizationData.isInfinite && (
                                            <tr>
                                                <td
                                                    colSpan={6}
                                                    className="px-6 py-8 text-center text-slate-400"
                                                >
                                                    Liability is already paid
                                                    off or data is unavailable.
                                                </td>
                                            </tr>
                                        )}
                                    {amortizationData.timeline.map((row) => {
                                        const paymentDate =
                                            getPaymentDateForRow(
                                                row.month,
                                                viewingLiability
                                            );
                                        const isPast = paymentDate < new Date();
                                        return (
                                            <tr
                                                key={row.month}
                                                className={`transition-colors ${
                                                    isPast
                                                        ? "bg-green-50"
                                                        : "hover:bg-slate-50"
                                                }`}
                                            >
                                                <td className="px-6 py-3 text-sm text-slate-600 font-medium flex items-center space-x-2">
                                                    {isPast && (
                                                        <CheckCircle
                                                            size={14}
                                                            className="text-emerald-500"
                                                        />
                                                    )}
                                                    <span>{row.month}</span>
                                                </td>
                                                <td className="px-6 py-3 text-sm text-slate-500">
                                                    {paymentDate.toLocaleDateString(
                                                        "en-US",
                                                        {
                                                            month: "short",
                                                            day: "numeric",
                                                            year: "2-digit",
                                                        }
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-sm text-slate-900 text-right">
                                                    ${row.payment.toFixed(2)}
                                                    {row.extraPayment ? (
                                                        <div className="text-[11px] text-emerald-600 font-semibold">
                                                            +${row.extraPayment.toFixed(2)} extra
                                                        </div>
                                                    ) : null}
                                                </td>
                                                <td className="px-6 py-3 text-sm text-green-600 text-right font-medium">
                                                    ${row.principal.toFixed(2)}
                                                </td>
                                                <td className="px-6 py-3 text-sm text-red-500 text-right">
                                                    ${row.interest.toFixed(2)}
                                                </td>
                                                <td
                                                    className={`px-6 py-3 text-sm text-right ${
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
                                                <td className="px-6 py-3 text-sm text-slate-700 text-right font-mono">
                                                    $
                                                    {row.remainingBalance.toFixed(
                                                        2
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

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
