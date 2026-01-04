import React, { useEffect, useMemo, useState } from "react";
import {
    IncomeSource,
    Expense,
    Liability,
    UserSettings,
    Ownership,
} from "../types";
import {
    buildEnvelopeInputs,
    buildEnvelopeRows,
    EnvelopeConfig,
    EnvelopeLedger,
    currentMonthKey,
    getNextMonthKey,
    getPrevMonthKey,
} from "../utils/envelopeUtils";
import {
    DollarSign,
    ArrowLeft,
    ArrowRight,
    ShieldCheck,
    User,
    Users,
} from "lucide-react";

interface PaychequePlannerProps {
    incomes: IncomeSource[];
    expenses: Expense[];
    liabilities: Liability[];
    settings: UserSettings;
}

const LEDGER_KEY = "btb_envelope_ledger";
const CONFIG_KEY = "btb_envelope_config";

const readJSON = <T,>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
};

const formatCurrency = (value: number, symbol: string) =>
    `${symbol}${value.toFixed(2)}`;

const parseAmount = (value: string) => {
    const cleaned = value.replace(/[^\d.-]/g, "");
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : 0;
};

const ownerIcon = (owner?: Ownership) => {
    if (owner === "USER")
        return <User size={14} className="text-indigo-500 mr-1" />;
    if (owner === "PARTNER")
        return <User size={14} className="text-pink-500 mr-1" />;
    return <Users size={14} className="text-purple-500 mr-1" />;
};

const PaychequePlanner: React.FC<PaychequePlannerProps> = ({
    incomes: _incomes, // retained for future paycheck-to-envelope funding
    expenses,
    liabilities,
    settings,
}) => {
    const [monthKey, setMonthKey] = useState<string>(currentMonthKey());
    const [ledger, setLedger] = useState<EnvelopeLedger>(() =>
        readJSON(LEDGER_KEY, {})
    );
    const [config, setConfig] = useState<EnvelopeConfig>(() =>
        readJSON(CONFIG_KEY, {})
    );

    useEffect(() => {
        localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    }, [ledger]);

    useEffect(() => {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }, [config]);

    const envelopes = useMemo(
        () => buildEnvelopeInputs(expenses, liabilities),
        [expenses, liabilities]
    );

    const rows = useMemo(
        () => buildEnvelopeRows(envelopes, ledger, config, monthKey),
        [envelopes, ledger, config, monthKey]
    );

    const totals = rows.reduce(
        (acc, r) => {
            acc.budgeted += r.budgeted;
            acc.activity += r.activity;
            acc.available += r.available;
            return acc;
        },
        { budgeted: 0, activity: 0, available: 0 }
    );

    const currency = settings.currencySymbol || "$";

    const monthLabel = useMemo(() => {
        const [y, m] = monthKey.split("-").map(Number);
        return new Date(y, m - 1, 1).toLocaleString("default", {
            month: "long",
            year: "numeric",
        });
    }, [monthKey]);

    const updateLedger = (
        envelopeId: string,
        changes: Partial<{ budgeted: number; activity: number }>
    ) => {
        setLedger((prev) => {
            const next = { ...prev };
            const monthEntry = { ...(next[monthKey] || {}) };
            monthEntry[envelopeId] = {
                ...(monthEntry[envelopeId] || {}),
                ...changes,
            };
            next[monthKey] = monthEntry;
            return next;
        });
    };

    const toggleRollover = (envelopeId: string) => {
        setConfig((prev) => ({
            ...prev,
            [envelopeId]: {
                rollover: !(prev[envelopeId]?.rollover !== false),
            },
        }));
    };

    const summaryCards = [
        {
            label: "Budgeted",
            value: totals.budgeted,
            color: "text-indigo-700",
            bg: "bg-indigo-50",
        },
        {
            label: "Activity",
            value: totals.activity,
            color: "text-amber-700",
            bg: "bg-amber-50",
        },
        {
            label: "Available",
            value: totals.available,
            color: totals.available >= 0 ? "text-emerald-700" : "text-rose-700",
            bg: totals.available >= 0 ? "bg-emerald-50" : "bg-rose-50",
        },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">
                        Envelope Budget
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Actual-style envelopes with rollovers for expenses and
                        debt payments.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setMonthKey(getPrevMonthKey(monthKey))}
                        className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-semibold">
                        {monthLabel}
                    </div>
                    <button
                        onClick={() => setMonthKey(getNextMonthKey(monthKey))}
                        className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
                    >
                        <ArrowRight size={18} />
                    </button>
                </div>
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

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="text-sm font-semibold text-slate-600">
                        Envelopes
                    </div>
                    <div className="flex items-center text-xs text-slate-500 gap-2">
                        <ShieldCheck size={14} className="text-emerald-600" />
                        Rollover keeps unspent (or overspent) balances flowing
                        into next month.
                    </div>
                </div>

                <div className="grid grid-cols-12 text-xs font-semibold text-slate-500 px-4 py-2 border-b border-slate-100">
                    <div className="col-span-4">Category</div>
                    <div className="col-span-2 text-right">Budgeted</div>
                    <div className="col-span-2 text-right">Activity</div>
                    <div className="col-span-2 text-right">Available</div>
                    <div className="col-span-2 text-right pr-2">Rollover</div>
                </div>

                <div className="divide-y divide-slate-100">
                    {rows.map((row) => (
                        <div
                            key={row.id}
                            className="grid grid-cols-12 px-4 py-3 items-center"
                        >
                            <div className="col-span-4 flex items-center gap-2">
                                <div
                                    className={`px-2 py-1 rounded-full text-[10px] font-semibold ${
                                        row.type === "EXPENSE"
                                            ? "bg-indigo-50 text-indigo-700"
                                            : "bg-amber-50 text-amber-700"
                                    }`}
                                >
                                    {row.type === "EXPENSE"
                                        ? "Expense"
                                        : "Debt"}
                                </div>
                                {ownerIcon(row.owner)}
                                <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                        {row.name}
                                    </div>
                                    {row.category && (
                                        <div className="text-[11px] text-slate-500">
                                            {row.category}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="col-span-2 text-right">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="w-full text-right px-2 py-1 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                                    value={row.budgeted.toString()}
                                    onChange={(e) =>
                                        updateLedger(row.id, {
                                            budgeted: parseAmount(e.target.value),
                                        })
                                    }
                                />
                            </div>

                            <div className="col-span-2 text-right">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="w-full text-right px-2 py-1 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                                    value={row.activity.toString()}
                                    onChange={(e) =>
                                        updateLedger(row.id, {
                                            activity: parseAmount(e.target.value),
                                        })
                                    }
                                    placeholder="0"
                                />
                            </div>

                            <div className="col-span-2 text-right text-sm font-semibold">
                                <span
                                    className={
                                        row.available >= 0
                                            ? "text-emerald-700"
                                            : "text-rose-700"
                                    }
                                >
                                    {formatCurrency(row.available, currency)}
                                </span>
                            </div>

                            <div className="col-span-2 flex justify-end">
                                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={row.rollover}
                                        onChange={() => toggleRollover(row.id)}
                                        className="h-4 w-4 text-indigo-600 border-slate-300 rounded"
                                    />
                                    Rollover
                                </label>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="text-xs text-slate-500">
                Debt envelopes use the current minimum payment (including fees
                and interest) as the default budget. Adjust budgeted or activity
                to reflect extra payments or skipped bills; rollover can be
                disabled per envelope if you prefer a clean slate each month.
            </div>
        </div>
    );
};

export default PaychequePlanner;
