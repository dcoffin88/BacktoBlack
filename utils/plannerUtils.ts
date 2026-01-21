import {
    Liability,
    Expense,
    IncomeSource,
    UserSettings,
    ExpenseSplitMethod,
    Ownership,
    PayFrequency,
} from "../types";
import {
    getMinPayment,
    calculateMonthlyIncome,
} from "../server/liabilityAlgorithms";

export interface ExpenseEvent {
    id: string;
    name: string;
    totalAmount: number;
    myShare: number;
    partnerShare: number;
    dueDate: Date;
    category: "Expense" | "Liability";
    isPaid: boolean;
    owner: Ownership;
    frequency: "MONTHLY" | "BI_WEEKLY" | "WEEKLY" | "QUARTERLY" | "ANNUAL";
    splitLabel?: string;
    transferAccount?: string;
}

export interface PaychequeAllocation {
    date: Date;
    sourceId: string;
    sourceName: string;
    totalAmount: number;
    isPartner: boolean;
    assignedExpenses: ExpenseEvent[]; // Contains the share amount specific to this person
    totalAllocated: number;
    remaining: number;
}

// Helper to add days
const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

// Generate specific pay dates for a source for a duration
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

    // Ensure nextPayDate is treated as local date
    const [y, m, d] = source.nextPayDate.split("-").map(Number);
    const seed = new Date(y, m - 1, d);
    if (Number.isNaN(seed.getTime())) return dates;
    if (source.frequency === "SEMI_MONTHLY") {
        return getSemiMonthlyDates(seed.getDate(), startDate, endDate);
    }
    let current = new Date(seed);

    // Backtrack logic to find relevant past paycheques if needed for current month's expenses
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
            case "MONTHLY":
                prev.setMonth(prev.getMonth() - 1);
                break;
            case "ANNUAL":
                prev.setFullYear(prev.getFullYear() - 1);
                break;
            default:
                prev.setDate(prev.getDate() - 30);
        }
        if (prev < startDate) break; // Don't go too far back
        current = prev;
        iterations++;
    }

    iterations = 0;
    while (current <= endDate && iterations < 1000) {
        iterations++;

        if (current >= startDate) {
            dates.push(new Date(current));
        }

        // Advance
        switch (source.frequency) {
            case "WEEKLY":
                current = addDays(current, 7);
                break;
            case "BI_WEEKLY":
                current = addDays(current, 14);
                break;
            case "MONTHLY":
                current = new Date(current.setMonth(current.getMonth() + 1));
                break;
            case "ANNUAL":
                current = new Date(
                    current.setFullYear(current.getFullYear() + 1)
                );
                break;
            default:
                current = addDays(current, 30);
        }
    }
    return dates;
};

// Calculate splits based on item ownership and global settings
const calculateShares = (
    amount: number,
    owner: Ownership,
    userRatio: number
): { myShare: number; partnerShare: number } => {
    if (owner === "USER") {
        return { myShare: amount, partnerShare: 0 };
    } else if (owner === "PARTNER") {
        return { myShare: 0, partnerShare: amount };
    } else {
        // JOINT / Household
        const myShare = amount * userRatio;
        return { myShare, partnerShare: amount - myShare };
    }
};

interface IncomeDetails {
    percentages: Map<string, number>;
    totalAnnualIncome: number;
    monthlyIncomePercentage: number;
}

export const calculateIncomeDetails = (incomes: IncomeSource[]): IncomeDetails => {
    const includedIncomes = incomes.filter(i => i.includeInPlanner !== false);

    const getAnnualizedIncome = (income: IncomeSource): number => {
        switch (income.frequency) {
            case "WEEKLY":
                return income.amount * 52;
            case "BI_WEEKLY":
                return income.amount * 26;
            case "SEMI_MONTHLY":
                return income.amount * 24;
            case "MONTHLY":
                return income.amount * 12;
            case "ANNUAL":
                return income.amount;
            default:
                return 0;
        }
    };

    const totalAnnualIncome = includedIncomes.reduce((total, income) => total + getAnnualizedIncome(income), 0);

    const percentages = new Map<string, number>();
    let monthlyIncomePercentage = 0;

    for (const income of includedIncomes) {
        const annualized = getAnnualizedIncome(income);
        const percentage = totalAnnualIncome > 0 ? annualized / totalAnnualIncome : 0;
        percentages.set(income.id, percentage);
        if (income.frequency === 'MONTHLY') {
            monthlyIncomePercentage += percentage;
        }
    }

    return { percentages, totalAnnualIncome, monthlyIncomePercentage };
};

type ExpenseItem = (Expense | Liability) & { itemType: 'Expense' | 'Liability' };

export const generateAllocationPlan = (
    incomes: IncomeSource[],
    expenses: Expense[],
    liabilities: Liability[],
    settings: UserSettings,
    daysToProject: number = 45
): PaychequeAllocation[] => {
    const plannerIncomes = incomes.filter(src => src.includeInPlanner !== false);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = addDays(today, daysToProject);

    const { percentages, monthlyIncomePercentage } = calculateIncomeDetails(plannerIncomes);

    const allItems: ExpenseItem[] = [
        ...expenses.map(e => ({ ...e, itemType: 'Expense' as 'Expense' })),
        ...liabilities.map(l => ({ ...l, itemType: 'Liability' as 'Liability' }))
    ];

    const allocations: PaychequeAllocation[] = [];
    plannerIncomes.forEach((source) => {
        const payDates = getPayDates(source, today, endDate);
        payDates.forEach((date) => {
            allocations.push({
                date: date,
                sourceId: source.id,
                sourceName: source.name,
                totalAmount: source.amount,
                isPartner: source.isPartner,
                assignedExpenses: [],
                totalAllocated: 0,
                remaining: source.amount,
            });
        });
    });

    allocations.sort((a, b) => a.date.getTime() - b.date.getTime());

    const biWeeklyCounters = new Map<string, number>();

    allocations.forEach(alloc => {
        const incomeSource = plannerIncomes.find(i => i.id === alloc.sourceId);
        if (!incomeSource) return;

        const incomePercentage = percentages.get(incomeSource.id) || 0;

        allItems.forEach((item, index) => {
            let amountToAllocate = 0;
            const frequency: PayFrequency | Expense['frequency'] | undefined = item.itemType === 'Expense' ? (item as Expense).frequency : (item as Liability).paymentFrequency;
            
            let amount = 0;
            if (item.itemType === 'Expense') {
                amount = (item as Expense).amount;
            } else {
                const liability = item as Liability;
                const monthlyInt = liability.balance * (liability.interestRate / 100 / 12);
                const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
                amount = getMinPayment(
                    liability,
                    liability.balance,
                    monthlyInt,
                    estFee
                );
            }

            switch (frequency) {
                case 'WEEKLY': {
                    let paychequeFrequencyMultiplier = 0;
                    switch(incomeSource.frequency) {
                        case 'WEEKLY': paychequeFrequencyMultiplier = 52; break;
                        case 'BI_WEEKLY': paychequeFrequencyMultiplier = 26; break;
                        case 'SEMI_MONTHLY': paychequeFrequencyMultiplier = 24; break;
                        case 'MONTHLY': paychequeFrequencyMultiplier = 12; break;
                        case 'ANNUAL': paychequeFrequencyMultiplier = 1; break;
                    }
                    if (paychequeFrequencyMultiplier > 0) {
                        amountToAllocate = amount * 52 / paychequeFrequencyMultiplier;
                    }
                    break;
                }
                case 'BI_WEEKLY':
                    amountToAllocate = amount * (incomePercentage + (monthlyIncomePercentage / 2));
                    break;
                case 'MONTHLY': {
                    let isApplicable = false;
                    if (incomeSource.frequency === 'MONTHLY') {
                        isApplicable = true;
                    } else if (incomeSource.frequency === 'BI_WEEKLY') {
                        const monthKey = `${alloc.date.getFullYear()}-${alloc.date.getMonth() + 1}`;
                        const count = biWeeklyCounters.get(monthKey) || 0;
                        if (count < 4) {
                            isApplicable = true;
                            biWeeklyCounters.set(monthKey, count + 1);
                        }
                    }
                    if (isApplicable) {
                        amountToAllocate = amount * (incomePercentage / 2);
                    }
                    break;
                }
                case 'ANNUAL':
                    amountToAllocate = (amount / 12) * (incomePercentage / 2);
                    break;
            }

            if (amountToAllocate > 0) {
                const expenseEvent: ExpenseEvent = {
                    id: `${item.id}-${alloc.date.getTime()}-${index}`,
                    name: item.name,
                    totalAmount: amountToAllocate,
                    myShare: amountToAllocate, // Assuming all allocations are for the user for now
                    partnerShare: 0,
                    dueDate: alloc.date,
                    category: item.itemType,
                    isPaid: false,
                    owner: 'owner' in item && item.owner ? item.owner : "JOINT",
                    frequency: frequency as ExpenseEvent['frequency'],
                };
                alloc.assignedExpenses.push(expenseEvent);
                alloc.totalAllocated += amountToAllocate;
                alloc.remaining -= amountToAllocate;
            }
        });
    });

    return allocations;
};


export const generatePaychequePlan = (
    incomes: IncomeSource[],
    expenses: Expense[],
    liabilities: Liability[],
    settings: UserSettings,
    daysToProject: number = 45,
    visibleStart: Date | null = null
): PaychequeAllocation[] => {
    // Respect includeInPlanner flag (default true)
    const plannerIncomes = incomes.filter(
        (src) => src.includeInPlanner !== false
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const showFrom = visibleStart ? new Date(visibleStart) : today;
    showFrom.setHours(0, 0, 0, 0);

    // Look back 60 days to ensure we capture the start of current expenseing cycles
    const historyStart = addDays(today, -60);
    const endDate = addDays(today, daysToProject);

    // 1. Determine Split Ratios
    let userRatio = 1.0;

    if (settings.enablePartner) {
        if (settings.expenseSplitMethod === ExpenseSplitMethod.PERCENTAGE) {
            userRatio = (settings.userSplitPercentage || 50) / 100;
        } else if (settings.expenseSplitMethod === ExpenseSplitMethod.INCOME) {
            const u = calculateMonthlyIncome(
                plannerIncomes.filter((s) => !s.isPartner)
            );
            const p = calculateMonthlyIncome(
                plannerIncomes.filter((s) => s.isPartner)
            );
            const total = u + p;
            if (total > 0) userRatio = u / total;
            else userRatio = 0.5;
        } else {
            // EQUAL
            userRatio = 0.5;
        }
    }

    // 2. Generate Expense Events (Expenses + Liabilities)
    const expenseEvents: ExpenseEvent[] = [];

    // Expenses
    expenses.forEach((expense) => {
        const intervalDays =
            expense.frequency === "WEEKLY"
                ? 7
                : expense.frequency === "BI_WEEKLY"
                ? 14
                : null;
        const monthInterval = expense.frequency === "QUARTERLY" ? 3 : 1;

        const dueDay = expense.dueDate ?? 1;
        const anchorDate =
            expense.frequency === "QUARTERLY" && expense.quarterlyAnchor
                ? new Date(expense.quarterlyAnchor)
                : null;

        // Start loop from roughly 1 month before historyStart to ensure we catch boundary expenses
        let currentDue = anchorDate && !Number.isNaN(anchorDate.getTime())
            ? new Date(anchorDate)
            : new Date(
                historyStart.getFullYear(),
                historyStart.getMonth() - 1,
                dueDay
            );

        // Advance to at least historyStart
        while (currentDue < historyStart) {
            if (intervalDays) {
                currentDue = addDays(currentDue, intervalDays);
            } else {
                const nextM = currentDue.getMonth() + monthInterval;
                currentDue = new Date(
                    currentDue.getFullYear(),
                    nextM,
                    currentDue.getDate()
                );
                if (currentDue.getMonth() !== nextM % 12) {
                    currentDue = new Date(
                        currentDue.getFullYear(),
                        currentDue.getMonth(),
                        0
                    );
                }
            }
        }

        while (currentDue <= endDate) {
            const amount = expense.amount;
            const owner = expense.owner || "JOINT";
            const { myShare, partnerShare } = calculateShares(
                amount,
                owner,
                userRatio
            );

            if (currentDue >= historyStart) {
                expenseEvents.push({
                    id: `${expense.id}-${currentDue.getTime()}`,
                    name: expense.name,
                    totalAmount: amount,
                    myShare,
                    partnerShare,
                    dueDate: new Date(currentDue),
                    category: "Expense",
                    isPaid: false,
                    owner,
                    frequency:
                        expense.frequency === "BI_WEEKLY"
                            ? "BI_WEEKLY"
                            : expense.frequency === "WEEKLY"
                            ? "WEEKLY"
                            : expense.frequency === "QUARTERLY"
                            ? "QUARTERLY"
                            : "MONTHLY",
                    transferAccount: expense.transferAccount,
                });
            }

            // Advance
            if (intervalDays) {
                currentDue = addDays(currentDue, intervalDays);
            } else {
                // Monthly
                const expectedMonth = currentDue.getMonth() + monthInterval;
                currentDue = new Date(
                    currentDue.getFullYear(),
                    expectedMonth,
                    dueDay
                );
                if (currentDue.getMonth() !== expectedMonth % 12) {
                    currentDue = new Date(
                        currentDue.getFullYear(),
                        currentDue.getMonth(),
                        0
                    );
                }
            }
        }
    });

    // Liability Minimums
    liabilities.forEach((liability) => {
        const monthlyInt =
            liability.balance * (liability.interestRate / 100 / 12);
        const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
        const minPayment = getMinPayment(
            liability,
            liability.balance,
            monthlyInt,
            estFee
        );

        if (minPayment > 0) {
            const isBiWeekly = liability.paymentFrequency === "BI_WEEKLY";
            const isWeekly = liability.paymentFrequency === "WEEKLY";
            const intervalDays = isBiWeekly ? 14 : isWeekly ? 7 : null;

            if (intervalDays) {
                const anchor = liability.nextDueDate
                    ? new Date(liability.nextDueDate)
                    : new Date(
                          historyStart.getFullYear(),
                          historyStart.getMonth(),
                          liability.dueDate
                      );
                let currentDue = new Date(anchor);

                let guard = 0;
                while (currentDue > historyStart && guard < 500) {
                    currentDue = addDays(currentDue, -intervalDays);
                    guard++;
                }

                guard = 0;
                while (currentDue <= endDate && guard < 1000) {
                    guard++;
                    const owner = liability.owner || "JOINT";
                    const { myShare, partnerShare } = calculateShares(
                        minPayment,
                        owner,
                        userRatio
                    );
                    if (currentDue >= historyStart) {
                        expenseEvents.push({
                            id: `${liability.id}-${currentDue.getTime()}`,
                            name: liability.name,
                            totalAmount: minPayment,
                            myShare,
                            partnerShare,
                            dueDate: new Date(currentDue),
                            category: "Liability",
                            isPaid: false,
                            owner,
                            frequency: isBiWeekly ? "BI_WEEKLY" : "WEEKLY",
                            transferAccount: liability.transferAccount,
                        });
                    }
                    currentDue = addDays(currentDue, intervalDays);
                }
            } else {
                // Monthly Liability Payment
                let currentDue = new Date(
                    historyStart.getFullYear(),
                    historyStart.getMonth() - 1,
                    liability.dueDate
                );

                while (currentDue < historyStart) {
                    const nextM = currentDue.getMonth() + 1;
                    currentDue = new Date(
                        currentDue.getFullYear(),
                        nextM,
                        liability.dueDate
                    );
                    if (currentDue.getMonth() !== nextM % 12) {
                        currentDue = new Date(
                            currentDue.getFullYear(),
                            currentDue.getMonth(),
                            0
                        );
                    }
                }

                while (currentDue <= endDate) {
                    const owner = liability.owner || "JOINT";
                    const { myShare, partnerShare } = calculateShares(
                        minPayment,
                        owner,
                        userRatio
                    );

                    if (currentDue >= historyStart) {
                        expenseEvents.push({
                            id: `${liability.id}-${currentDue.getTime()}`,
                            name: liability.name,
                            totalAmount: minPayment,
                            myShare,
                            partnerShare,
                            dueDate: new Date(currentDue),
                            category: "Liability",
                            isPaid: false,
                            owner,
                            frequency: "MONTHLY",
                            transferAccount: liability.transferAccount,
                        });
                    }

                    const expectedMonth = currentDue.getMonth() + 1;
                    currentDue = new Date(
                        currentDue.getFullYear(),
                        expectedMonth,
                        liability.dueDate
                    );
                    if (currentDue.getMonth() !== expectedMonth % 12) {
                        currentDue = new Date(
                            currentDue.getFullYear(),
                            currentDue.getMonth(),
                            0
                        );
                    }
                }
            }
        }
    });

    // Sort Expenses by Date
    expenseEvents.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  // 3. Generate Paycheque Allocations (Including History)
  const allocations: PaychequeAllocation[] = [];

  // Guarded push to avoid duplicate entries for the same expense event on a single cheque
  const addAssignment = (
      paycheque: PaychequeAllocation,
      expense: ExpenseEvent,
      amount: number,
      splitLabel?: string
  ) => {
      const exists = paycheque.assignedExpenses.some(e => e.id === expense.id);
      if (exists) return;
      paycheque.assignedExpenses.push({ ...expense, totalAmount: amount, splitLabel });
      paycheque.totalAllocated += amount;
      paycheque.remaining -= amount;
  };

    plannerIncomes.forEach((source) => {
        const payDates = getPayDates(source, historyStart, endDate);
        payDates.forEach((date) => {
            allocations.push({
                date: date,
                sourceId: source.id,
                sourceName: source.name,
                totalAmount: source.amount,
                isPartner: source.isPartner,
                assignedExpenses: [],
                totalAllocated: 0,
                remaining: source.amount,
            });
        });
    });

    // Sort Allocations by Date
    allocations.sort((a, b) => a.date.getTime() - b.date.getTime());

    // 4. Assign Expenses to Paycheques
    expenseEvents.forEach((expense) => {
        const sameMonth = (date: Date) =>
            date.getFullYear() === expense.dueDate.getFullYear() &&
            date.getMonth() === expense.dueDate.getMonth();

        // 4a. Assign User Share
        if (expense.myShare > 0.01) {
            // Find User paycheques in the same calendar month as the expense
            const candidates = allocations.filter(
                (p) => !p.isPartner && sameMonth(p.date)
            );

            // BUDGET SYSTEM LOGIC:
            // If expense is MONTHLY or QUARTERLY, limit to the first 2 paycheques of the month.
            // This ensures "Extra" (3rd) paycheques in a month are treated as surplus/savings.
            // If expense is BI_WEEKLY/WEEKLY, we use all available paycheques.
            const cap =
                expense.frequency === "MONTHLY" ||
                expense.frequency === "QUARTERLY"
                    ? 2
                    : candidates.length;
            const scopedCandidates = candidates.slice(0, cap);

            if (scopedCandidates.length > 0) {
                const incomeTotal = scopedCandidates.reduce(
                    (sum, p) => sum + p.totalAmount,
                    0
                );
                if (incomeTotal > 0) {
                    scopedCandidates.forEach((p) => {
                        const prorated =
                            expense.myShare * (p.totalAmount / incomeTotal);
                        addAssignment(
                            p,
                            expense,
                            prorated,
                            scopedCandidates.length > 1
                                ? "(prorated)"
                                : undefined
                        );
                    });
                } else {
                    // If income total is zero (edge case), fall back to equal split
                    const sharePerCheque =
                        expense.myShare / scopedCandidates.length;
                    scopedCandidates.forEach((p, idx) => {
                        addAssignment(
                            p,
                            expense,
                            sharePerCheque,
                            scopedCandidates.length > 1
                                ? `(${idx + 1}/${scopedCandidates.length})`
                                : undefined
                        );
                    });
                }
            } else {
                // Fallback: Closest previous paycheque (or next) if none in month
                const previous = allocations.filter(
                    (p) => !p.isPartner && p.date <= expense.dueDate
                );
                const payer =
                    previous.length > 0
                        ? previous[previous.length - 1]
                        : allocations.find(
                              (p) => !p.isPartner && p.date > expense.dueDate
                          );

                if (payer) {
                    addAssignment(payer, expense, expense.myShare, "(Late)");
                }
            }
        }

        // 4b. Assign Partner Share
        if (expense.partnerShare > 0.01) {
            const candidates = allocations.filter(
                (p) => p.isPartner && sameMonth(p.date)
            );

            // BUDGET SYSTEM LOGIC (Partner):
            const cap =
                expense.frequency === "MONTHLY" ||
                expense.frequency === "QUARTERLY"
                    ? 2
                    : candidates.length;
            const scopedCandidates = candidates.slice(0, cap);

            if (scopedCandidates.length > 0) {
                const incomeTotal = scopedCandidates.reduce(
                    (sum, p) => sum + p.totalAmount,
                    0
                );
                if (incomeTotal > 0) {
                    scopedCandidates.forEach((p) => {
                        const prorated =
                            expense.partnerShare *
                            (p.totalAmount / incomeTotal);
                        addAssignment(
                            p,
                            expense,
                            prorated,
                            scopedCandidates.length > 1
                                ? "(prorated)"
                                : undefined
                        );
                    });
                } else {
                    const sharePerCheque =
                        expense.partnerShare / scopedCandidates.length;
                    scopedCandidates.forEach((p, idx) => {
                        addAssignment(
                            p,
                            expense,
                            sharePerCheque,
                            scopedCandidates.length > 1
                                ? `(${idx + 1}/${scopedCandidates.length})`
                                : undefined
                        );
                    });
                }
            } else {
                const previous = allocations.filter(
                    (p) => p.isPartner && p.date <= expense.dueDate
                );
                const payer =
                    previous.length > 0
                        ? previous[previous.length - 1]
                        : allocations.find(
                              (p) => p.isPartner && p.date > expense.dueDate
                          );

                if (payer) {
                    addAssignment(
                        payer,
                        expense,
                        expense.partnerShare,
                        "(Late)"
                    );
                }
            }
        }
    });

    // 5. Filter out past allocations to show only relevant future/current
    return allocations.filter((p) => p.date >= showFrom);
};