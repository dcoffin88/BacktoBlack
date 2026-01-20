import React, { useMemo } from "react";
import {
    IncomeSource,
    Expense,
    Liability,
    UserSettings,
    Ownership,
} from "../types";
import { generateAllocationPlan, PaychequeAllocation } from "../utils/plannerUtils";
import { DollarSign, User, Users } from "lucide-react";

interface PaychequePlannerProps {
    incomes: IncomeSource[];
    expenses: Expense[];
    liabilities: Liability[];
    settings: UserSettings;
}

const formatCurrency = (value: number, symbol: string) =>
    `${symbol}${value.toFixed(2)}`;

const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

const ownerIcon = (owner?: Ownership) => {
    if (owner === "USER")
        return <User size={14} className="text-indigo-500 mr-1" />;
    if (owner === "PARTNER")
        return <User size={14} className="text-pink-500 mr-1" />;
    return <Users size={14} className="text-purple-500 mr-1" />;
};

const PaychequeCard: React.FC<{ allocation: PaychequeAllocation, currency: string }> = ({ allocation, currency }) => {
    const remainingColor = allocation.remaining >= 0 ? "text-emerald-700" : "text-rose-700";

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">{allocation.sourceName}</h2>
                    <p className="text-sm text-slate-500">{formatDate(allocation.date)}</p>
                </div>
                <div className="text-right">
                    <p className="text-lg font-bold text-emerald-600">{formatCurrency(allocation.totalAmount, currency)}</p>
                    <p className="text-xs text-slate-500">Paycheque Amount</p>
                </div>
            </div>

            <div className="divide-y divide-slate-100">
                <div className="grid grid-cols-12 text-xs font-semibold text-slate-500 px-4 py-2">
                    <div className="col-span-6">Allocated Expense</div>
                    <div className="col-span-3">Frequency</div>
                    <div className="col-span-3 text-right">Amount</div>
                </div>
                {allocation.assignedExpenses.map(expense => (
                    <div key={expense.id} className="grid grid-cols-12 px-4 py-3 items-center">
                        <div className="col-span-6 flex items-center">
                             {ownerIcon(expense.owner)}
                            <span className="text-sm font-semibold text-slate-900">{expense.name}</span>
                        </div>
                        <div className="col-span-3">
                            <span className={`px-2 py-1 rounded-full text-[10px] font-semibold ${
                                expense.category === "Expense"
                                    ? "bg-indigo-50 text-indigo-700"
                                    : "bg-amber-50 text-amber-700"
                            }`}>
                                {expense.frequency}
                            </span>
                        </div>
                        <div className="col-span-3 text-right text-sm text-slate-700">
                            {formatCurrency(expense.totalAmount, currency)}
                        </div>
                    </div>
                ))}
            </div>

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                <span className="text-sm font-semibold text-slate-600">Total Allocated</span>
                <span className="text-sm font-semibold text-slate-800">{formatCurrency(allocation.totalAllocated, currency)}</span>
            </div>
            <div className={`px-4 py-3 ${allocation.remaining >= 0 ? 'bg-emerald-50' : 'bg-rose-50'} flex justify-between items-center`}>
                <span className={`text-sm font-bold ${remainingColor}`}>Remaining</span>
                <span className={`text-lg font-bold ${remainingColor}`}>{formatCurrency(allocation.remaining, currency)}</span>
            </div>
        </div>
    );
};

const PaychequePlanner: React.FC<PaychequePlannerProps> = ({
    incomes,
    expenses,
    liabilities,
    settings,
}) => {
    const allocations = useMemo(() => {
        return generateAllocationPlan(incomes, expenses, liabilities, settings);
    }, [incomes, expenses, liabilities, settings]);

    const currency = settings.currencySymbol || "$";

    const totalIncome = allocations.reduce((sum, alloc) => sum + alloc.totalAmount, 0);
    const totalAllocated = allocations.reduce((sum, alloc) => sum + alloc.totalAllocated, 0);
    const totalRemaining = allocations.reduce((sum, alloc) => sum + alloc.remaining, 0);

    const summaryCards = [
        {
            label: "Total Income",
            value: totalIncome,
            color: "text-emerald-700",
            bg: "bg-emerald-50",
        },
        {
            label: "Total Allocated",
            value: totalAllocated,
            color: "text-indigo-700",
            bg: "bg-indigo-50",
        },
        {
            label: "Surplus/Deficit",
            value: totalRemaining,
            color: totalRemaining >= 0 ? "text-emerald-700" : "text-rose-700",
            bg: totalRemaining >= 0 ? "bg-emerald-50" : "bg-rose-50",
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">
                    Paycheque Planner
                </h1>
                <p className="text-slate-500 mt-1">
                    Your projected budget based on income and expense allocations.
                </p>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
                {summaryCards.map((card) => (
                    <div
                        key={card.label}
                        className={`rounded-xl p-4 border border-slate-200 ${card.bg}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-500">
                                {card.label}
                            </span>
                            <DollarSign size={16} className={card.color} />
                        </div>
                        <div className={`text-2xl font-bold mt-2 ${card.color}`}>
                            {formatCurrency(card.value, currency)}
                        </div>
                    </div>
                ))}
            </div>

            <div className="space-y-8">
                {allocations.length > 0 ? (
                    allocations.map(alloc => <PaychequeCard key={alloc.date.getTime() + alloc.sourceId} allocation={alloc} currency={currency} />)
                ) : (
                    <div className="text-center py-12">
                        <h3 className="text-lg font-semibold text-slate-700">No Paycheques to Display</h3>
                        <p className="text-slate-500 mt-2">
                            Please add an income source with the "Include in Planner" option checked to get started.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PaychequePlanner;