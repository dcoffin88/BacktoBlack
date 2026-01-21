export interface Liability {
    id: string;
    householdId?: string;
    name: string;
    subtitle?: string;
    transferAccount?: string;
    excludedIncomeSourceIds?: string[];
    excludeFromSplitting?: boolean;
    balance: number;
    category?: string;
    interestRate: number;
    startingBalance: number;
    startDate: string;

    minPaymentPercentage: number;
    minPaymentPlusInterest: boolean;
    minPaymentPlusFees: boolean;
    minPaymentAmount: number;
    paymentFrequency: "MONTHLY" | "BI_WEEKLY" | "WEEKLY";
    minPaymentFloor: number;

    annualFee: number;
    isFeeMonthly: boolean;
    feeMonth: number;

    dueDate: number;
    nextDueDate?: string;

    creditLimit?: number;
    customOrder?: number;
    owner?: Ownership;
    manualPaymentRequired?: boolean;
}

export interface Expense {
    id: string;
    householdId?: string;
    name: string;
    subtitle?: string;
    transferAccount?: string;
    amount: number;
    dueDate?: number;
    frequency: "MONTHLY" | "BI_WEEKLY" | "WEEKLY" | "QUARTERLY" | "ANNUAL";
    quarterlyAnchor?: string;
    category: string;
    isPaid: boolean;
    owner?: Ownership;
    excludedIncomeSourceIds?: string[];
    excludeFromSplitting?: boolean;
    manualPaymentRequired?: boolean;
}

export interface Asset {
    id: string;
    householdId?: string;
    name: string;
    value: number;
    category: "Cash" | "Investment" | "Real Estate" | "Vehicle" | "Other";
    notes?: string;
    owner?: Ownership;
}

export enum StrategyType {
    SNOWBALL = "SNOWBALL",
    AVALANCHE = "AVALCHE",
    HYBRID = "HYBRID",
    CFI = "CFI",
    HIGHEST_PAYMENT = "HIGHEST_PAYMENT",
    HIGHEST_UTILIZATION = "HIGHEST_UTILIZATION",
    HIGHEST_INTEREST_AMT = "HIGHEST_INTEREST_AMT",
    CUSTOM = "CUSTOM",
}

export interface LiabilityPaymentInfo {
    liabilityId: string;
    name: string;
    payment: number;
    interest: number;
    balance: number;
}

export interface PayoffMonth {
    month: number;
    totalBalance: number;
    totalInterestPaid: number;
    liabilitiesRemaining: number;
    paidOffNames: string[];
    breakdown: LiabilityPaymentInfo[];
}

export interface PayoffResult {
    strategy: StrategyType;
    monthsToFreedom: number;
    totalInterestPaid: number;
    timeline: PayoffMonth[];
}

export interface BudgetSchedule {
    strategy: string;
    strategyLabel: string;
    savedAt: string;
    monthlyBudget: number;
    timeline: PayoffMonth[];
}

export interface AmortizationOverride {
    id: string;
    liabilityId: string;
    period: number;
    payment: number;
    interest: number;
    purchase?: number;
    chequeDate?: string | null;
}

export enum ExpenseSplitMethod {
    EQUAL = "EQUAL",
    PERCENTAGE = "PERCENTAGE",
    INCOME = "INCOME",
}

export type PayFrequency =
    | "WEEKLY"
    | "BI_WEEKLY"
    | "SEMI_MONTHLY"
    | "MONTHLY"
    | "ANNUAL";

export type MonthlyIncomeMode = "ANNUALIZED" | "MODE" | "MEDIAN" | "MEAN";

export type Ownership = "USER" | "PARTNER" | "JOINT";

export interface IncomeSource {
    id: string;
    name: string;
    amount: number;
    frequency: PayFrequency;
    nextPayDate: string;
    isPartner: boolean;
    ownerId?: number;
    includeInPlanner?: boolean;
    includeFirstTwoCheques?: boolean;
    splitIncomeAsJoint?: boolean;
    excludeFromSplitting?: boolean;
}

export interface UserSettings {
    householdId?: string;
    monthlyBudget: number;
    emailReports: boolean;
    email: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    smtpSecure?: boolean;

    enableMonthlyReport?: boolean;
    monthlyReportRecipients?: string;
    enableTransferReport?: boolean;
    transferReportRecipients?: string;

    useSimpleTerms?: boolean;
    currencySymbol?: string;
    monthlyIncomeMode?: MonthlyIncomeMode;

    incomeSources: IncomeSource[];

    enablePartner?: boolean;
    partnerName?: string;
    partnerBudget?: number;
    partnerEmail?: string;
    partnerLinked?: boolean;
    startDate?: string;

    expenseSplitMethod?: ExpenseSplitMethod;
    userSplitPercentage?: number;

    userIncome?: number;
    partnerIncome?: number;
}

export interface UserProfile {
    id: number;
    email: string;
    name?: string;
}

export const STRATEGY_LABELS: Record<StrategyType, string> = {
    [StrategyType.SNOWBALL]: "Liability Snowball (Lowest Balance)",
    [StrategyType.AVALANCHE]: "Liability Avalanche (Highest Rate)",
    [StrategyType.HYBRID]: "Hybrid (efficiency)",
    [StrategyType.CFI]: "Cash Flow Index",
    [StrategyType.HIGHEST_PAYMENT]: "Highest Monthly Payment",
    [StrategyType.HIGHEST_UTILIZATION]: "Highest Utilization",
    [StrategyType.HIGHEST_INTEREST_AMT]: "Highest Interest Paid",
    [StrategyType.CUSTOM]: "Custom Plan",
};

export interface ExtraPayment {
    id: string;
    liabilityId: string;
    amount: number;
    chequeDate?: string | null;
    isChecked?: boolean;
}

export interface PaychequeOccurrence {
    date: Date;
    source: IncomeSource;
    eligibleMonthly: boolean;
    eligibleBiWeekly: boolean;
}
