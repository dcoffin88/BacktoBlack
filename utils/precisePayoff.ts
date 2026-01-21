import { Liability, PayoffResult, StrategyType, PayoffMonth, LiabilityPaymentInfo } from "../types";
import { getMinPayment } from "../server/liabilityAlgorithms";

const getPaymentCountInMonth = (
    liability: Liability,
    year: number,
    monthIndex: number
): number => {
    const freq = liability.paymentFrequency || "MONTHLY";
    if (freq === "MONTHLY") return 1;

    let anchor: Date;
    if (liability.nextDueDate) {
        const [y, m, d] = liability.nextDueDate.split('-').map(Number);
        anchor = new Date(y, m - 1, d);
    } else {
        const start = liability.startDate ? new Date(liability.startDate) : new Date();
        const dueDay = Math.min(Math.max(1, liability.dueDate || 1), 28);
        anchor = new Date(start.getFullYear(), start.getMonth(), dueDay);
    }

    if (Number.isNaN(anchor.getTime())) return 0;

    const intervalDays = freq === "WEEKLY" ? 7 : 14;
    const targetMonthStart = new Date(year, monthIndex, 1);
    const targetMonthEnd = new Date(year, monthIndex + 1, 0);

    let current = new Date(anchor);

    const maxIter = 5000;
    let iter = 0;

    if (current < targetMonthStart) {
        while (current < targetMonthStart && iter < maxIter) {
            current.setDate(current.getDate() + intervalDays);
            iter++;
        }
        current.setDate(current.getDate() - intervalDays);
    } 
    else if (current > targetMonthEnd) {
        while (current > targetMonthEnd && iter < maxIter) {
            current.setDate(current.getDate() - intervalDays);
            iter++;
        }
    }

    let count = 0;
    iter = 0;
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
    monthlyBudget: number,
    strategy: StrategyType,
    startDateStr: string = new Date().toISOString().split('T')[0]
): PayoffResult => {
    let currentLiabilities = liabilities.map(l => ({
        ...l,
        simBalance: l.balance,
        isPaid: l.balance <= 0.01
    }));

    const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
    let currentYear = startYear;
    let currentMonthIndex = startMonth - 1;

    const timeline: PayoffMonth[] = [];
    let totalInterestPaid = 0;
    let monthsElapsed = 0;

    const MAX_MONTHS = 360; 

    while (currentLiabilities.some(l => !l.isPaid) && monthsElapsed < MAX_MONTHS) {
        monthsElapsed++;
        
        let monthTotalInterest = 0;
        let monthTotalBalance = 0;
        const breakdown: LiabilityPaymentInfo[] = [];

        let totalMinRequired = 0;
        const payments: Record<string, { interest: number, minPayment: number, count: number }> = {};

        currentLiabilities.forEach(l => {
            if (l.isPaid) {
                payments[l.id] = { interest: 0, minPayment: 0, count: 0 };
                return;
            }

            const monthlyRate = (l.interestRate / 100) / 12;
            const interest = l.simBalance * monthlyRate;
            monthTotalInterest += interest;
            l.simBalance += interest;

            const monthlyAvgMin = getMinPayment(l, l.simBalance, interest, 0); 

            let perEventAmount = monthlyAvgMin;
            if (l.paymentFrequency === "BI_WEEKLY") {
                perEventAmount = monthlyAvgMin * 12 / 26;
            } else if (l.paymentFrequency === "WEEKLY") {
                perEventAmount = monthlyAvgMin * 12 / 52;
            }

            const count = getPaymentCountInMonth(l, currentYear, currentMonthIndex);
            
            let actualMin = perEventAmount * count;

            if (actualMin > l.simBalance) {
                actualMin = l.simBalance;
            }

            totalMinRequired += actualMin;
            payments[l.id] = { interest, minPayment: actualMin, count };
        });

        let availableExtra = monthlyBudget;

        const recoveredSnowball = liabilities.reduce((sum, l) => {
            const current = currentLiabilities.find(cl => cl.id === l.id);
            if (current && current.isPaid && l.balance > 0) {
                const initialMonthlyInterest = l.balance * (l.interestRate / 100 / 12);
                const initialAvgMin = getMinPayment(l, l.balance, initialMonthlyInterest, 0);
                return sum + initialAvgMin;
            }
            return sum;
        }, 0);

        availableExtra += recoveredSnowball;

        const activeLoans = currentLiabilities.filter(l => !l.isPaid);
        let sortedLoans = [...activeLoans];

        if (strategy === StrategyType.SNOWBALL) {
            sortedLoans.sort((a, b) => a.simBalance - b.simBalance);
        } else if (strategy === StrategyType.AVALANCHE) {
            sortedLoans.sort((a, b) => b.interestRate - a.interestRate);
        } else if (strategy === StrategyType.CUSTOM) {
             sortedLoans.sort((a, b) => (a.customOrder || 999) - (b.customOrder || 999));
        }

        currentLiabilities.forEach(l => {
            if (l.isPaid) return;

            let payment = payments[l.id].minPayment;
            l.simBalance -= payment;

            if (availableExtra > 0 && sortedLoans.length > 0 && sortedLoans[0].id === l.id) {
                const extra = availableExtra;
                if (l.simBalance > 0) {
                    const actualExtra = Math.min(l.simBalance, extra);
                    l.simBalance -= actualExtra;
                    payment += actualExtra;
                    availableExtra -= actualExtra;
                }
            }
        });

        if (availableExtra > 0) {
             for (const l of sortedLoans) {
                 if (l.isPaid) continue;
                 if (l.simBalance <= 0) continue; 
                 
                 const take = Math.min(l.simBalance, availableExtra);
                 l.simBalance -= take;
             }
        }

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
        });
    }

    currentLiabilities = liabilities.map(l => ({ ...l, simBalance: l.balance, isPaid: l.balance <= 0.01 }));
    currentYear = startYear;
    currentMonthIndex = startMonth - 1;
    timeline.length = 0;
    totalInterestPaid = 0;
    monthsElapsed = 0;

    while (currentLiabilities.some(l => !l.isPaid) && monthsElapsed < MAX_MONTHS) {
        monthsElapsed++;

        const startBalances = new Map<string, number>();
        currentLiabilities.forEach(l => startBalances.set(l.id, l.simBalance));

        let monthTotalInterest = 0;
        let monthTotalBalance = 0;

        const paymentSpecs: { id: string, min: number, interest: number }[] = [];
        
        currentLiabilities.forEach(l => {
            if (l.isPaid) return;

            const monthlyRate = (l.interestRate / 100) / 12;
            const interest = l.simBalance * monthlyRate;
            monthTotalInterest += interest;

            l.simBalance += interest;

            const monthlyAvgMin = getMinPayment(l, startBalances.get(l.id) || 0, interest, 0);
            let perEventAmount = monthlyAvgMin;
            if (l.paymentFrequency === "BI_WEEKLY") perEventAmount = monthlyAvgMin * 12 / 26;
            else if (l.paymentFrequency === "WEEKLY") perEventAmount = monthlyAvgMin * 12 / 52;

            const count = getPaymentCountInMonth(l, currentYear, currentMonthIndex);
            let actualMin = perEventAmount * count;

            if (actualMin > l.simBalance) actualMin = l.simBalance;

            paymentSpecs.push({ id: l.id, min: actualMin, interest });
        });

        paymentSpecs.forEach(spec => {
            const l = currentLiabilities.find(x => x.id === spec.id)!;
            l.simBalance -= spec.min;
        });

        let availableExtra = monthlyBudget;
        availableExtra += liabilities.reduce((sum, l) => {
            const current = currentLiabilities.find(cl => cl.id === l.id);
            if (current && current.isPaid && l.balance > 0) {
                const i = l.balance * (l.interestRate / 100 / 12);
                return sum + getMinPayment(l, l.balance, i, 0);
            }
            return sum;
        }, 0);

        const activeLoans = currentLiabilities.filter(l => !l.isPaid && l.simBalance > 0.01);
        if (strategy === StrategyType.SNOWBALL) activeLoans.sort((a, b) => a.simBalance - b.simBalance);
        else if (strategy === StrategyType.AVALANCHE) activeLoans.sort((a, b) => b.interestRate - a.interestRate);
        else if (strategy === StrategyType.CUSTOM) activeLoans.sort((a, b) => (a.customOrder || 999) - (b.customOrder || 999));

        for (const l of activeLoans) {
            if (availableExtra <= 0) break;
            const take = Math.min(l.simBalance, availableExtra);
            l.simBalance -= take;
            availableExtra -= take;
        }

        const breakdown: LiabilityPaymentInfo[] = [];
        const paidOffNames: string[] = [];
        let liabilitiesRemaining = 0;

        currentLiabilities.forEach(l => {
            const startBal = startBalances.get(l.id) || 0;
            const spec = paymentSpecs.find(s => s.id === l.id);
            const interest = spec ? spec.interest : 0;

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
            totalInterestPaid: monthTotalInterest,
            liabilitiesRemaining,
            paidOffNames,
            breakdown
        });

        currentMonthIndex++;
        if (currentMonthIndex > 11) {
            currentMonthIndex = 0;
            currentYear++;
        }
    }

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
