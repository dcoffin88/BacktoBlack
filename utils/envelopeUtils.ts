import { Expense, Liability, Ownership } from "../types";
import { getMinPayment } from "../server/liabilityAlgorithms";

export type EnvelopeType = "EXPENSE" | "LIABILITY";

export interface EnvelopeInput {
    id: string;
    name: string;
    type: EnvelopeType;
    owner?: Ownership;
    category?: string;
    frequency?: Expense["frequency"];
    baseAmount: number;
}

export interface EnvelopeLedgerEntry {
    budgeted?: number;
    activity?: number;
}

export type EnvelopeLedger = Record<
    string,
    Record<string, EnvelopeLedgerEntry>
>;

export interface EnvelopeConfigEntry {
    rollover?: boolean;
}

export type EnvelopeConfig = Record<string, EnvelopeConfigEntry>;

export interface EnvelopeRow extends EnvelopeInput {
    budgeted: number;
    activity: number;
    available: number;
    rollover: boolean;
}

const monthKeyFromDate = (date: Date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return `${y}-${m.toString().padStart(2, "0")}`;
};

const previousMonthKey = (monthKey: string) => {
    const [y, m] = monthKey.split("-").map(Number);
    const date = new Date(y, m - 1, 1);
    date.setMonth(date.getMonth() - 1);
    return monthKeyFromDate(date);
};

const memoAvailable = new Map<string, number>();

const computeAvailable = (
    envelope: EnvelopeInput,
    monthKey: string,
    ledger: EnvelopeLedger,
    config: EnvelopeConfig,
    depth: number = 0
): number => {
    const memoKey = `${monthKey}:${envelope.id}`;
    if (memoAvailable.has(memoKey)) {
        return memoAvailable.get(memoKey)!;
    }

    if (depth > 120) {
        return 0;
    }

    const entry = ledger[monthKey]?.[envelope.id] || {};
    const budgeted = entry.budgeted ?? envelope.baseAmount;
    const activity = entry.activity ?? 0;
    const rolloverEnabled = config[envelope.id]?.rollover !== false;

    let priorAvailable = 0;
    if (rolloverEnabled) {
        const prevKey = previousMonthKey(monthKey);
        priorAvailable = computeAvailable(
            envelope,
            prevKey,
            ledger,
            config,
            depth + 1
        );
    }

    const available = priorAvailable + budgeted - activity;
    memoAvailable.set(memoKey, available);
    return available;
};

export const resetEnvelopeMemo = () => {
    memoAvailable.clear();
};

export const buildEnvelopeInputs = (
    expenses: Expense[],
    liabilities: Liability[]
): EnvelopeInput[] => {
    const expenseInputs: EnvelopeInput[] = expenses.map((e) => {
        const multiplier =
            e.frequency === "BI_WEEKLY"
                ? 2
                : e.frequency === "WEEKLY"
                ? 52 / 12
                : e.frequency === "QUARTERLY"
                ? 1 / 3
                : 1;
        return {
            id: `expense-${e.id}`,
            name: e.name,
            type: "EXPENSE",
            owner: e.owner,
            category: e.category,
            frequency: e.frequency,
            baseAmount: e.amount * multiplier,
        };
    });

    const liabilityInputs: EnvelopeInput[] = liabilities.map((l) => {
        const monthlyInterest = l.balance * (l.interestRate / 100 / 12);
        const monthlyFee = l.isFeeMonthly ? l.annualFee / 12 : 0;
        const minPay = getMinPayment(l, l.balance, monthlyInterest, monthlyFee);
        return {
            id: `liability-${l.id}`,
            name: l.name,
            type: "LIABILITY",
            owner: l.owner,
            baseAmount: Math.max(minPay, 0),
        };
    });

    return [...expenseInputs, ...liabilityInputs];
};

export const buildEnvelopeRows = (
    envelopes: EnvelopeInput[],
    ledger: EnvelopeLedger,
    config: EnvelopeConfig,
    monthKey: string
): EnvelopeRow[] => {
    resetEnvelopeMemo();
    return envelopes.map((env) => {
        const entry = ledger[monthKey]?.[env.id] || {};
        const rolloverEnabled = config[env.id]?.rollover !== false;
        const budgeted = entry.budgeted ?? env.baseAmount;
        const activity = entry.activity ?? 0;
        const available = computeAvailable(env, monthKey, ledger, config);
        return {
            ...env,
            budgeted,
            activity,
            available,
            rollover: rolloverEnabled,
        };
    });
};

export const monthKeyFromString = (monthKey: string) => {
    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m - 1, 1);
};

export const getNextMonthKey = (monthKey: string) => {
    const date = monthKeyFromString(monthKey);
    date.setMonth(date.getMonth() + 1);
    return monthKeyFromDate(date);
};

export const getPrevMonthKey = (monthKey: string) => {
    return previousMonthKey(monthKey);
};

export const currentMonthKey = () => monthKeyFromDate(new Date());
