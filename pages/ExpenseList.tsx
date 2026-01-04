import React, { useMemo, useState } from "react";
import {
    Expense,
    UserSettings,
    ExpenseSplitMethod,
    IncomeSource,
    Ownership,
} from "../types";
import { calculateMonthlyIncome } from "../server/liabilityAlgorithms";
import {
    Plus,
    Trash2,
    Edit2,
    X,
    Save,
    Calendar,
    Users,
    User,
} from "lucide-react";
interface ExpenseListProps {
    expenses: Expense[];
    onSave: (expense: Expense) => void;
    onDelete: (id: string) => void;
    userSettings?: UserSettings;
    incomes?: IncomeSource[];
}

const ExpenseList: React.FC<ExpenseListProps> = ({
    expenses,
    onSave,
    onDelete,
    userSettings,
    incomes = [],
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState<
        Omit<Expense, "id" | "isPaid"> & { dueDate?: number }
    >({
        name: "",
        amount: 0,
        dueDate: undefined,
        frequency: "MONTHLY",
        quarterlyAnchor: "",
        category: "",
        owner: "JOINT",
    });

    const [sortBy, setSortBy] = useState<"name" | "amount" | "dueDate">("name");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

    const partnerFirstWord =
        userSettings?.partnerName?.trim()?.split(/\s+/)[0] || "Partner";

    const partnerPossessive = `${partnerFirstWord}'s`;

    const handleOpenModal = (expense?: Expense) => {
        if (expense) {
            setEditingId(expense.id);
            setFormData({
                name: expense.name,
                amount: expense.amount,
                dueDate: expense.dueDate,
                frequency: expense.frequency,
                quarterlyAnchor: expense.quarterlyAnchor || "",
                category: expense.category,
                owner: expense.owner || "JOINT",
            });
        } else {
            setEditingId(null);
            setFormData({
                name: "",
                amount: 0,
                dueDate: undefined,
                frequency: "MONTHLY",
                quarterlyAnchor: "",
                category: "",
                owner: "JOINT",
            });
        }
        setIsModalOpen(true);
    };

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingId) {
            const existing = expenses.find((b) => b.id === editingId);
            onSave({ ...existing, ...formData, id: editingId } as Expense);
        } else {
            const newExpense: Expense = {
                ...formData,
                id: Math.random().toString(36).substr(2, 9),
                isPaid: false,
            };
            onSave(newExpense);
        }
        setIsModalOpen(false);
    };

    const handleDelete = (id: string) => {
        if (confirm("Delete this expense?")) {
            onDelete(id);
        }
    };

    // Helper to calculate next actual due date based on the day of month
    const getNextDueDate = (expense: Expense) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const formatDate = (d: Date) =>
            d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                weekday: "short",
            });

        // Quarterly uses anchor date if provided
        if (expense.frequency === "QUARTERLY") {
            const anchor = expense.quarterlyAnchor
                ? new Date(expense.quarterlyAnchor)
                : null;
            let next =
                anchor && !Number.isNaN(anchor.getTime())
                    ? new Date(anchor)
                    : expense.dueDate
                    ? new Date(
                          today.getFullYear(),
                          today.getMonth(),
                          expense.dueDate
                      )
                    : null;

            if (!next || Number.isNaN(next.getTime())) {
                return "No anchor set";
            }

            while (next < today) {
                next.setMonth(next.getMonth() + 3);
            }
            return formatDate(next);
        }

        // Monthly (and fallback for others with a due day)
        if (Number.isFinite(expense.dueDate)) {
            const day = expense.dueDate as number;
            let target = new Date(today.getFullYear(), today.getMonth(), day);
            if (target < today) {
                target = new Date(today.getFullYear(), today.getMonth() + 1, day);
            }
            return formatDate(target);
        }

        return "No due date";
    };

    // --- Expense Stats ---
    const totalMonthlyExpenses = expenses.reduce((sum, b) => {
        const freqMultiplier =
            b.frequency === "BI_WEEKLY"
                ? 2
                : b.frequency === "WEEKLY"
                ? 52 / 12
                : b.frequency === "QUARTERLY"
                ? 1 / 3
                : 1;
        return sum + b.amount * freqMultiplier;
    }, 0);

    // --- Split Logic ---
    let userShare = 0;
    let partnerShare = 0;
    let splitLabel = "Personal Total";

    if (userSettings?.enablePartner) {
        let userRatio = 0.5;
        let label = "50/50 Split";

        if (userSettings.expenseSplitMethod === ExpenseSplitMethod.PERCENTAGE) {
            userRatio = (userSettings.userSplitPercentage || 50) / 100;
            label = `${userSettings.userSplitPercentage || 50}% / ${
                100 - (userSettings.userSplitPercentage || 50)
            }% Split`;
        } else if (
            userSettings.expenseSplitMethod === ExpenseSplitMethod.INCOME
        ) {
            const u = calculateMonthlyIncome(
                incomes.filter((s) => !s.isPartner)
            );
            const p = calculateMonthlyIncome(
                incomes.filter((s) => s.isPartner)
            );

            const total = u + p;
            if (total > 0) userRatio = u / total;
            label = "Income Weighted";
        } else {
            // Equal
            userRatio = 0.5;
        }

        // Calculate shares by iterating expenses
        expenses.forEach((b) => {
            const freqMultiplier =
                b.frequency === "BI_WEEKLY"
                    ? 2
                    : b.frequency === "WEEKLY"
                    ? 52 / 12
                    : b.frequency === "QUARTERLY"
                    ? 1 / 3
                    : 1;
            const amt = b.amount * freqMultiplier;
            const owner = b.owner || "JOINT";

            if (owner === "USER") {
                userShare += amt;
            } else if (owner === "PARTNER") {
                partnerShare += amt;
            } else {
                userShare += amt * userRatio;
                partnerShare += amt * (1 - userRatio);
            }
        });

        splitLabel = label;
    } else {
        userShare = totalMonthlyExpenses;
    }

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

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">
                        Monthly Expenses
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Track expenses and keep monthly payments on schedule.
                    </p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium shadow-sm flex items-center transition-colors"
                >
                    <Plus size={18} className="mr-2" />
                    Add Expense
                </button>
            </div>

            {/* Summary Card */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 grid grid-cols-1 gap-6">
                {/* Total Summary */}
                <div className="border-r border-slate-100 pr-6">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
                        Total Monthly Expenses
                    </h3>
                    <p className="text-3xl font-extrabold text-slate-900">
                        $
                        {totalMonthlyExpenses.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                        })}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                        Includes bi-weekly expenses converted to monthly totals.
                    </p>

                    {/* Split Breakdown */}
                    {userSettings?.enablePartner &&
                        totalMonthlyExpenses > 0 && (
                            <div className="mt-4 pt-3 border-t border-slate-100">
                                <div className="flex items-center space-x-1 mb-2">
                                    <Users
                                        size={12}
                                        className="text-slate-400"
                                    />
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                                        Shared Expense Breakdown ({splitLabel})
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-slate-400">
                                            Your Share
                                        </p>
                                        <p className="text-lg font-bold text-slate-700">
                                            $
                                            {userShare.toLocaleString(
                                                undefined,
                                                { maximumFractionDigits: 0 }
                                            )}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-400">
                                            {partnerPossessive} Share
                                        </p>
                                        <p className="text-lg font-bold text-slate-700">
                                            $
                                            {partnerShare.toLocaleString(
                                                undefined,
                                                { maximumFractionDigits: 0 }
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                </div>

            </div>

            <div className="space-y-6">
                {/* Expenses Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center">
                            <Calendar
                                size={18}
                                className="mr-2 text-slate-500"
                            />{" "}
                            Expenses
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white border-b border-slate-100">
                                    <th
                                        className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
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
                                            <span>Expense Name</span>
                                            {sortBy === "name" && (
                                                <span className="text-[10px] text-slate-400">
                                                    {sortDir === "asc" ? "▲" : "▼"}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                    <th
                                        className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right cursor-pointer select-none"
                                        onClick={() => {
                                            setSortBy("amount");
                                            setSortDir((d) =>
                                                sortBy === "amount" && d === "asc"
                                                    ? "desc"
                                                    : "asc"
                                            );
                                        }}
                                    >
                                        <div className="flex items-center justify-end space-x-1">
                                            <span>Payment</span>
                                            {sortBy === "amount" && (
                                                <span className="text-[10px] text-slate-400">
                                                    {sortDir === "asc" ? "▲" : "▼"}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">
                                        Frequency
                                    </th>
                                    <th
                                        className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right cursor-pointer select-none"
                                        onClick={() => {
                                            setSortBy("dueDate");
                                            setSortDir((d) =>
                                                sortBy === "dueDate" && d === "asc"
                                                    ? "desc"
                                                    : "asc"
                                            );
                                        }}
                                    >
                                        <div className="flex items-center justify-end space-x-1">
                                            <span>Next Due</span>
                                            {sortBy === "dueDate" && (
                                                <span className="text-[10px] text-slate-400">
                                                    {sortDir === "asc" ? "▲" : "▼"}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {expenses.length === 0 ? (
                                    <tr>
                                        <td
                                        colSpan={5}
                                        className="px-6 py-12 text-center text-slate-400"
                                    >
                                        No expenses added yet.
                                    </td>
                                    </tr>
                                ) : (
                                    useMemo(() => {
                                        const dir = sortDir === "asc" ? 1 : -1;
                                        return [...expenses].sort((a, b) => {
                                            if (sortBy === "name") {
                                                return (
                                                    a.name.localeCompare(b.name) *
                                                    dir
                                                );
                                            }
                                            if (sortBy === "amount") {
                                                return (a.amount - b.amount) * dir;
                                            }
                                            if (sortBy === "dueDate") {
                                                const da = a.dueDate ?? Number.MAX_SAFE_INTEGER;
                                                const db = b.dueDate ?? Number.MAX_SAFE_INTEGER;
                                                return (da - db) * dir;
                                            }
                                            return 0;
                                        });
                                    }, [expenses, sortBy, sortDir])
                                        .map((expense) => (
                                            <tr
                                                key={expense.id}
                                                className="transition-colors hover:bg-slate-50"
                                            >
                                                <td className="px-6 py-4 font-medium text-slate-900">
                                                    {expense.name}
                                                    <span className="block text-xs font-normal text-slate-400">
                                                        {expense.category}
                                                    </span>
                                                    <div className="flex items-center space-x-1 mt-1">
                                                        {getOwnerIcon(
                                                            expense.owner
                                                        )}
                                                        <span className="text-xs text-slate-500">
                                                            {getOwnerLabel(
                                                                expense.owner
                                                            )}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right font-medium text-slate-900">
                                                    $
                                                    {expense.amount.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span
                                                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                            expense.frequency ===
                                                            "MONTHLY"
                                                                ? "bg-blue-100 text-blue-800"
                                                                : "bg-purple-100 text-purple-800"
                                                        }`}
                                                    >
                                                    {expense.frequency ===
                                                    "MONTHLY"
                                                        ? "Monthly"
                                                        : expense.frequency ===
                                                          "QUARTERLY"
                                                        ? "Quarterly"
                                                        : expense.frequency ===
                                                          "WEEKLY"
                                                        ? "Weekly"
                                                        : "Bi-Weekly"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-600 font-medium">
                                                {getNextDueDate(expense)}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <div className="flex items-center justify-center space-x-2">
                                                        <button
                                                            onClick={() =>
                                                                handleOpenModal(
                                                                    expense
                                                                )
                                                            }
                                                            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                handleDelete(
                                                                    expense.id
                                                                )
                                                            }
                                                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in-up">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-900">
                                {editingId ? "Edit Expense" : "Add New Expense"}
                            </h3>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Expense Name
                                </label>
                                <input
                                    required
                                    type="text"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    placeholder="e.g. Rent, Netflix"
                                    value={formData.name}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            name: e.target.value,
                                        })
                                    }
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Amount ($)
                                    </label>
                                    <input
                                        required
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={formData.amount}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                amount: parseFloat(
                                                    e.target.value
                                                ),
                                            })
                                        }
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Due Day (optional)
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            min="1"
                                            max="31"
                                            className="w-full px-4 py-2 pl-9 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                            value={formData.dueDate ?? ""}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    dueDate:
                                                        e.target.value === ""
                                                            ? undefined
                                                            : parseInt(
                                                                  e.target.value
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
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Frequency
                                    </label>
                                    <select
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                        value={formData.frequency}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                frequency: e.target
                                                    .value as any,
                                            })
                                        }
                                    >
                                        <option value="MONTHLY">Monthly</option>
                                        <option value="QUARTERLY">Quarterly</option>
                                        <option value="WEEKLY">Weekly</option>
                                        <option value="BI_WEEKLY">
                                            Bi-Weekly
                                        </option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Category (Opt)
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                        placeholder="e.g. Utilities"
                                        value={formData.category}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                category: e.target.value,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                            {formData.frequency === "QUARTERLY" && (
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            Quarter Anchor Date
                                        </label>
                                        <input
                                            type="date"
                                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                            value={formData.quarterlyAnchor}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    quarterlyAnchor:
                                                        e.target.value,
                                                })
                                            }
                                        />
                                        <p className="text-xs text-slate-500 mt-1">
                                            Sets when the quarter cycle starts; defaults to day 1 if empty.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Ownership Selector - Always visible now */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Expense Ownership
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
                                <p className="text-[10px] text-slate-400 mt-1.5 ml-1">
                                    {formData.owner === "USER" &&
                                        "You pay 100% of this expense."}
                                    {formData.owner === "PARTNER" &&
                                        `${partnerFirstWord} pays 100% of this expense.`}
                                    {(formData.owner === "JOINT" ||
                                        !formData.owner) &&
                                        "Splits based on your settings (Equal, %, or Income)."}
                                </p>
                            </div>

                            <div className="pt-4 flex justify-end space-x-3">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md transition-colors flex items-center"
                                >
                                    <Save size={18} className="mr-2" />
                                    Save Expense
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExpenseList;
