export interface Liability {
    id: string;
    householdId?: string;
    name: string;
    balance: number;
    category?: string;
    interestRate: number; // Annual percentage (e.g., 18.5 for 18.5%)

    // Historical / Meta Data
    startingBalance: number; // Original loan amount for progress tracking
    startDate: string; // YYYY-MM-DD

    // Minimum Payment Atoms (Replaces Strategy Enum)
    minPaymentPercentage: number; // e.g. 1 (for 1% of balance)
    minPaymentPlusInterest: boolean; // Add accrued interest to the min payment?
    minPaymentPlusFees: boolean; // Add charged fees to the min payment?
    minPaymentAmount: number; // Fixed amount added on top (or the base flat amount if % is 0)
    paymentFrequency: "MONTHLY" | "BI_WEEKLY" | "WEEKLY"; // Frequency of the FIXED amount component
    minPaymentFloor: number; // The "Minimum of the Minimum" (e.g. $25)

    // Fee Configuration
    annualFee: number;
    isFeeMonthly: boolean; // If true, charge fee/12 monthly. If false, charge annualFee once a year.
    feeMonth: number; // 1-12 (January - December) for Annual Fee timing

    dueDate: number; // Day of month 1-31
    nextDueDate?: string; // Anchor date for bi-weekly / weekly schedules

    creditLimit?: number;
    customOrder?: number; // For manual sorting
    owner?: Ownership;
}

export interface Expense {
    id: string;
    householdId?: string;
    name: string;
    amount: number;
    dueDate?: number; // Day of month 1-31 (optional)
    frequency: "MONTHLY" | "BI_WEEKLY" | "WEEKLY" | "QUARTERLY";
    quarterlyAnchor?: string; // YYYY-MM-DD to anchor quarter start (optional)
    category: string;
    isPaid: boolean;
    owner?: Ownership;
    excludedIncomeSourceIds?: string[]; // income sources to skip for budget check allocation
    excludeFromSplitting?: boolean; // bypass split ratios; assign to payer only
}

export interface Asset {
    id: string;
    householdId?: string;
    name: string;
    value: number;
    category: "Cash" | "Investment" | "Real Estate" | "Vehicle" | "Other";
    notes?: string;
}

export enum StrategyType {
    SNOWBALL = "SNOWBALL", // Lowest Balance
    AVALANCHE = "AVALCHE", // Highest Interest Rate
    HYBRID = "HYBRID", // Liability/Interest Ratio
    CFI = "CFI", // Cash Flow Index (Balance / Min Payment)
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

// Saved payoff schedule that can be shared across Budget, Dashboard, and Liabilities
export interface BudgetSchedule {
    strategy: string;
    strategyLabel: string;
    savedAt: string;
    monthlyBudget: number;
    timeline: PayoffMonth[];
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

export type Ownership = "USER" | "PARTNER" | "JOINT";

export interface IncomeSource {
    id: string;
    name: string;
    amount: number; // Net amount per paycheque
    frequency: PayFrequency;
    nextPayDate: string; // YYYY-MM-DD
    isPartner: boolean;
    ownerId?: number; // User id of the income owner (helps keep partner income separate across accounts)
    includeInPlanner?: boolean; // If false, excluded from Paycheque Planner math
    includeFirstTwoChecks?: boolean; // If true, only first 2 checks per month counted in budget
}

export interface UserSettings {
    householdId?: string;
    monthlyBudget: number; // Extra money available strictly for liability on top of minimums
    emailReports: boolean;
    email: string;
    // Display / terminology preferences
    useSimpleTerms?: boolean; // Loan/Bills naming
    currencySymbol?: string;

    // Income Configuration
    incomeSources: IncomeSource[];

    // Partner / Joint Account Settings
    enablePartner?: boolean;
    partnerName?: string;
    partnerBudget?: number;
    partnerEmail?: string;
    partnerLinked?: boolean;
    startDate?: string; // YYYY-MM-DD

    // Expense Splitting
    expenseSplitMethod?: ExpenseSplitMethod;
    userSplitPercentage?: number; // 0-100

    // Deprecated but kept for type compatibility during migration
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
