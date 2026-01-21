import { Liability, PayoffResult, StrategyType, PayoffMonth, LiabilityPaymentInfo } from "../types";
import { getMinPayment } from "../server/liabilityAlgorithms";

// Helper to get number of payments in a specific month/year for a liability
const getPaymentCountInMonth = (
    liability: Liability,
    year: number,
    monthIndex: number // 0-11
): number => {
    const freq = liability.paymentFrequency || "MONTHLY";
    if (freq === "MONTHLY") return 1;
    if (freq === "ANNUAL") return 0; // Simplified: ignored for monthly payoff grids usually, or could check fee month

    // Determine Anchor Date
    let anchor: Date;
    if (liability.nextDueDate) {
        const [y, m, d] = liability.nextDueDate.split('-').map(Number);
        anchor = new Date(y, m - 1, d);
    } else {
        // Fallback to startDate or today + dueDay
        const start = liability.startDate ? new Date(liability.startDate) : new Date();
        const dueDay = Math.min(Math.max(1, liability.dueDate || 1), 28); // simplistic cap
        anchor = new Date(start.getFullYear(), start.getMonth(), dueDay);
    }

    if (Number.isNaN(anchor.getTime())) return 0;

    const intervalDays = freq === "WEEKLY" ? 7 : 14;
    const targetMonthStart = new Date(year, monthIndex, 1);
    const targetMonthEnd = new Date(year, monthIndex + 1, 0);

    // Backtrack or fast-forward anchor to be near the target month
    let current = new Date(anchor);
    
    // Safety check to prevent infinite loops if dates are wild
    const maxIter = 5000;
    let iter = 0;

    // Fast forward
    if (current < targetMonthStart) {
        while (current < targetMonthStart && iter < maxIter) {
            current.setDate(current.getDate() + intervalDays);
            iter++;
        }
        // Step back one to ensure we catch an early month payment
        current.setDate(current.getDate() - intervalDays);
    } 
    // Rewind (unlikely needed if we start from today, but good for robustness)
    else if (current > targetMonthEnd) {
        while (current > targetMonthEnd && iter < maxIter) {
            current.setDate(current.getDate() - intervalDays);
            iter++;
        }
    }

    // Count hits in the month
    let count = 0;
    iter = 0;
    // Scan forward a bit
    while (current <= targetMonthEnd && iter < 10) {
        if (current >= targetMonthStart && current <= targetMonthEnd) {
            count++;
        }
        current.setDate(current.getDate() + intervalDays);
        iter++;
    }

    return count;
};

export const calculatePrecisePayoff = (
    liabilities: Liability[],
    monthlyBudget: number, // Extra surplus
    strategy: StrategyType,
    startDateStr: string = new Date().toISOString().split('T')[0]
): PayoffResult => {
    // 1. Setup Simulation State
    let currentLiabilities = liabilities.map(l => ({
        ...l,
        simBalance: l.balance,
        isPaid: l.balance <= 0.01
    }));

    const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
    let currentYear = startYear;
    let currentMonthIndex = startMonth - 1; // 0-11

    const timeline: PayoffMonth[] = [];
    let totalInterestPaid = 0;
    let monthsElapsed = 0;

    // Safety Cap (30 years)
    const MAX_MONTHS = 360; 

    while (currentLiabilities.some(l => !l.isPaid) && monthsElapsed < MAX_MONTHS) {
        monthsElapsed++;
        
        let monthTotalInterest = 0;
        let monthTotalBalance = 0;
        const breakdown: LiabilityPaymentInfo[] = [];
        
        // 1. Calculate Minimums and Interest for this month
        let totalMinRequired = 0;
        const payments: Record<string, { interest: number, minPayment: number, count: number }> = {};

        currentLiabilities.forEach(l => {
            if (l.isPaid) {
                payments[l.id] = { interest: 0, minPayment: 0, count: 0 };
                return;
            }

            // Interest (Monthly Approximation)
            // Note: Precise daily interest is better, but monthly is standard for projection consistency
            const monthlyRate = (l.interestRate / 100) / 12;
            const interest = l.simBalance * monthlyRate;
            monthTotalInterest += interest;
            l.simBalance += interest; // Add interest immediately (will be paid off)

            // Calculate "Actual" Minimum Payment based on calendar count
            // Get the "Monthly Average" Minimum from the algorithm
            const monthlyAvgMin = getMinPayment(l, l.simBalance, interest, 0); 
            
            // Reverse engineer the "Per Check" amount
            let perEventAmount = monthlyAvgMin;
            if (l.paymentFrequency === "BI_WEEKLY") {
                perEventAmount = monthlyAvgMin * 12 / 26;
            } else if (l.paymentFrequency === "WEEKLY") {
                perEventAmount = monthlyAvgMin * 12 / 52;
            }

            // How many times do we pay this month?
            const count = getPaymentCountInMonth(l, currentYear, currentMonthIndex);
            
            let actualMin = perEventAmount * count;
            
            // Cap at balance
            if (actualMin > l.simBalance) {
                actualMin = l.simBalance;
            }

            totalMinRequired += actualMin;
            payments[l.id] = { interest, minPayment: actualMin, count };
        });

        // 2. Determine Extra Allocation
        // In "Actual" mode, high-frequency months (3 paychecks) naturally consume more of the user's cash flow.
        // We assume `monthlyBudget` is a FIXED extra amount available *on top* of whatever the minimums are.
        // (i.e. User absorbs the variance of minimums from their income variance).
        let availableExtra = monthlyBudget;

        // Snowball/Avalanche Logic: 
        // We also add the "Average Minimums" of paid-off debts to the snowball to simulate the strategy correctly.
        // (We use average because 'actual' for a paid-off debt is undefined).
        const recoveredSnowball = liabilities.reduce((sum, l) => {
            const current = currentLiabilities.find(cl => cl.id === l.id);
            if (current && current.isPaid && l.balance > 0) {
                // Approximate the freed-up cashflow using the original average minimum
                // This mimics the "Commitment" strategy of Snowball
                const initialMonthlyInterest = l.balance * (l.interestRate / 100 / 12);
                const initialAvgMin = getMinPayment(l, l.balance, initialMonthlyInterest, 0);
                return sum + initialAvgMin;
            }
            return sum;
        }, 0);

        availableExtra += recoveredSnowball;

        // 3. Sort for Extra Allocation
        const activeLoans = currentLiabilities.filter(l => !l.isPaid);
        let sortedLoans = [...activeLoans];

        if (strategy === StrategyType.SNOWBALL) {
            sortedLoans.sort((a, b) => a.simBalance - b.simBalance);
        } else if (strategy === StrategyType.AVALANCHE) {
            sortedLoans.sort((a, b) => b.interestRate - a.interestRate);
        } else if (strategy === StrategyType.CUSTOM) {
             sortedLoans.sort((a, b) => (a.customOrder || 999) - (b.customOrder || 999));
        }
        // ... add other strategies if needed, defaulting to Avalanche for simplicity in this view

        // 4. Apply Payments
        currentLiabilities.forEach(l => {
            if (l.isPaid) return;

            let payment = payments[l.id].minPayment;
            l.simBalance -= payment;

            // Apply Extra?
            if (availableExtra > 0 && sortedLoans.length > 0 && sortedLoans[0].id === l.id) {
                // Apply all extra to the top priority
                // (In a real multi-step simulation, we might split if the first is paid off, 
                // but for this utility we simply dump to the top active one for this month)
                const extra = availableExtra;
                if (l.simBalance > 0) {
                    const actualExtra = Math.min(l.simBalance, extra);
                    l.simBalance -= actualExtra;
                    payment += actualExtra;
                    availableExtra -= actualExtra;
                }
            }
            
            // Check if paid off in this step (after min + extra)
            // If there is leftover extra after paying off this loan, we should ideally pass it to the next.
            // Simplified: We loop specifically for the extra allocation.
        });

        // 4b. Waterfall leftover extra (if the top priority didn't use it all)
        // This handles the "paid off mid-month" scenario
        if (availableExtra > 0) {
             for (const l of sortedLoans) {
                 if (l.isPaid) continue; // Skip if already paid by minimum
                 if (l.simBalance <= 0) continue; 
                 
                 const take = Math.min(l.simBalance, availableExtra);
                 l.simBalance -= take;
                 
                 // Update the recorded payment in our tracking object (hacky but works for the report)
                 // We need to find the breakdown entry later, but for now update state
                 // We need to add 'take' to the 'payment' variable we stored? No, we didn't store it perfectly.
                 // Let's re-find the payment record to update it for the breakdown
                 // (This section is slightly complex because we already processed the main loop)
                 // Let's just update the breakdown generation logic below to look at (StartBalance + Interest - EndBalance)
             }
        }

        // 5. Finalize Month State
        const paidOffNames: string[] = [];
        currentLiabilities.forEach(l => {
            if (l.simBalance <= 0.01) {
                l.simBalance = 0;
                if (!l.isPaid) {
                    l.isPaid = true;
                    paidOffNames.push(l.name);
                }
            }
            monthTotalBalance += l.simBalance;

            // Derive actual payment made this month by diff
            // Start = PrevSimBalance (we lost this ref, need to track better)
            // Actually, easier: Payment = (StartBalance + Interest) - EndBalance
            // We need `l` from start of loop. 
            // Correct approach: Store `prevBalance` at start of loop.
        });

        // Re-construct breakdown properly using a separate pass or better state tracking?
        // Let's rely on the fact that we can calc: Payment = (PreviousBalance + Interest) - CurrentBalance
        // But we mutated `l.simBalance` in place.
        // Correction: We need to store snapshot at start of month.
    }

    // --- RE-RUN with Snapshot Tracking for Report Accuracy ---
    // (The above loop was logic-focused, here is the cleaner implementation for the return value)
    
    // Reset
    currentLiabilities = liabilities.map(l => ({ ...l, simBalance: l.balance, isPaid: l.balance <= 0.01 }));
    currentYear = startYear;
    currentMonthIndex = startMonth - 1;
    timeline.length = 0;
    totalInterestPaid = 0;
    monthsElapsed = 0;

    while (currentLiabilities.some(l => !l.isPaid) && monthsElapsed < MAX_MONTHS) {
        monthsElapsed++;
        
        // Snapshot balances
        const startBalances = new Map<string, number>();
        currentLiabilities.forEach(l => startBalances.set(l.id, l.simBalance));

        let monthTotalInterest = 0;
        let monthTotalBalance = 0;
        
        // 1. Accrue Interest & Calc Minimums
        const paymentSpecs: { id: string, min: number, interest: number }[] = [];
        
        currentLiabilities.forEach(l => {
            if (l.isPaid) return;

            const monthlyRate = (l.interestRate / 100) / 12;
            const interest = l.simBalance * monthlyRate;
            monthTotalInterest += interest;
            
            // Add interest
            l.simBalance += interest;

            // Calc Min
            const monthlyAvgMin = getMinPayment(l, startBalances.get(l.id) || 0, interest, 0);
            let perEventAmount = monthlyAvgMin;
            if (l.paymentFrequency === "BI_WEEKLY") perEventAmount = monthlyAvgMin * 12 / 26;
            else if (l.paymentFrequency === "WEEKLY") perEventAmount = monthlyAvgMin * 12 / 52;

            const count = getPaymentCountInMonth(l, currentYear, currentMonthIndex);
            let actualMin = perEventAmount * count;
            
            // Cap min at total due
            if (actualMin > l.simBalance) actualMin = l.simBalance;

            paymentSpecs.push({ id: l.id, min: actualMin, interest });
        });

        // 2. Pay Minimums
        paymentSpecs.forEach(spec => {
            const l = currentLiabilities.find(x => x.id === spec.id)!;
            l.simBalance -= spec.min;
        });

        // 3. Extra Allocation
        let availableExtra = monthlyBudget;
        // Add recovered snowball
        availableExtra += liabilities.reduce((sum, l) => {
            const current = currentLiabilities.find(cl => cl.id === l.id);
            if (current && current.isPaid && l.balance > 0) {
                const i = l.balance * (l.interestRate / 100 / 12);
                return sum + getMinPayment(l, l.balance, i, 0);
            }
            return sum;
        }, 0);

        // Sort Active
        const activeLoans = currentLiabilities.filter(l => !l.isPaid && l.simBalance > 0.01);
        if (strategy === StrategyType.SNOWBALL) activeLoans.sort((a, b) => a.simBalance - b.simBalance);
        else if (strategy === StrategyType.AVALANCHE) activeLoans.sort((a, b) => b.interestRate - a.interestRate);
        else if (strategy === StrategyType.CUSTOM) activeLoans.sort((a, b) => (a.customOrder || 999) - (b.customOrder || 999));

        // Waterfall Extra
        for (const l of activeLoans) {
            if (availableExtra <= 0) break;
            const take = Math.min(l.simBalance, availableExtra);
            l.simBalance -= take;
            availableExtra -= take;
        }

        // 4. Record Data
        const breakdown: LiabilityPaymentInfo[] = [];
        const paidOffNames: string[] = [];
        let liabilitiesRemaining = 0;

        currentLiabilities.forEach(l => {
            const startBal = startBalances.get(l.id) || 0;
            // Payment = (Start + Interest) - End
            const spec = paymentSpecs.find(s => s.id === l.id);
            const interest = spec ? spec.interest : 0;
            
            // Fix: If it was paid off previously, startBal is 0, simBalance is 0. Payment 0.
            const payment = Math.max(0, (startBal + interest) - l.simBalance);
            
            if (l.simBalance <= 0.01) {
                l.simBalance = 0;
                if (!l.isPaid) {
                    l.isPaid = true;
                    paidOffNames.push(l.name);
                }
            } else {
                liabilitiesRemaining++;
            }

            monthTotalBalance += l.simBalance;

            breakdown.push({
                liabilityId: l.id,
                name: l.name,
                payment,
                interest,
                balance: l.simBalance
            });
        });

        totalInterestPaid += monthTotalInterest;

        timeline.push({
            month: monthsElapsed,
            totalBalance: monthTotalBalance,
            totalInterestPaid: monthTotalInterest, // Monthly interest, not cumulative in this object typically? 
            // Wait, existing types might expect cumulative or monthly? 
            // Usually charts sum it up. Let's check `PayoffMonth` definition.
            // It has `totalInterestPaid`. In `liabilityAlgorithms.ts`, it typically stores the cumulative or monthly?
            // Dashboard chart uses `totalBalance`. Summary stats use last row `totalInterestPaid`.
            // So it should be Cumulative.
            // Let's adjust to cumulative.
            // actually, let's keep `monthTotalInterest` here and let the reduce sum it, OR accumulate it.
            // Existing `PayoffMonth` definition: `totalInterestPaid: number`.
            // Standard is Cumulative.
            liabilitiesRemaining,
            paidOffNames,
            breakdown
        });

        // Advance Date
        currentMonthIndex++;
        if (currentMonthIndex > 11) {
            currentMonthIndex = 0;
            currentYear++;
        }
    }

    // Fix cumulative interest in timeline
    let runningInterest = 0;
    timeline.forEach(t => {
        runningInterest += t.totalInterestPaid;
        t.totalInterestPaid = runningInterest;
    });

    return {
        strategy,
        monthsToFreedom: timeline.length,
        totalInterestPaid: runningInterest,
        timeline
    };
};
