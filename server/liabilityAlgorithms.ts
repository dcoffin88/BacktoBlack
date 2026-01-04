import { Liability, PayoffMonth, PayoffResult, StrategyType, IncomeSource } from '../types';

// Helper to deep copy liabilities to avoid mutating state during simulation
const copyLiabilities = (liabilities: Liability[]): Liability[] => JSON.parse(JSON.stringify(liabilities));

export interface AmortizationRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  fees: number;
  remainingBalance: number;
  extraPayment?: number;
}

// Helper to calculate monthly equivalent of income sources
export const calculateMonthlyIncome = (sources: IncomeSource[]): number => {
  return sources.reduce((total, source) => {
    let monthlyAmount = 0;
    switch (source.frequency) {
      case 'WEEKLY':
        monthlyAmount = source.amount * (52 / 12);
        break;
      case 'BI_WEEKLY':
        monthlyAmount = source.amount * (26 / 12);
        break;
      case 'SEMI_MONTHLY':
        monthlyAmount = source.amount * 2; // 24 checks per year
        break;
      case 'MONTHLY':
        monthlyAmount = source.amount;
        break;
      case 'ANNUAL':
        monthlyAmount = source.amount / 12;
        break;
      default:
        monthlyAmount = source.amount;
    }
    return total + monthlyAmount;
  }, 0);
};

// Helper to calculate current minimum payment based on flexible atoms
export const getMinPayment = (liability: Liability, currentPrincipal: number, accruedInterest: number, feesChargedThisMonth: number = 0): number => {
  const totalBalance = currentPrincipal + accruedInterest;
  // Use logical OR for compatibility instead of ??
  const floor = liability.minPaymentFloor || 0;

  // 1. Explicit Floor Check: If total balance is less than the floor, pay the full balance.
  if (totalBalance < floor) {
    return totalBalance;
  }

  // 2. Calculate Components
  // Percent Component
  const percentAmount = totalBalance * (liability.minPaymentPercentage / 100);
  
  // Interest Component
  const interestAmount = liability.minPaymentPlusInterest ? accruedInterest : 0;
  
  // Fee Component (if configured to be part of min payment)
  const feeAmount = liability.minPaymentPlusFees ? feesChargedThisMonth : 0;

  // Fixed Amount Component - ADJUSTED FOR FREQUENCY
  // If frequency is Bi-Weekly or Weekly and the user wants the *entire* payment on that cadence
  // treat the entered minPaymentAmount as the per-period payment and convert to monthly equivalent.
  let fixedAmount = liability.minPaymentAmount || 0;
  if (liability.paymentFrequency === 'BI_WEEKLY') {
    fixedAmount = fixedAmount * (26 / 12);
  } else if (liability.paymentFrequency === 'WEEKLY') {
    fixedAmount = fixedAmount * (52 / 12);
  }

  // Sum it up
  let calculated = percentAmount + interestAmount + feeAmount + fixedAmount;

  // 3. Apply Floor (The "Greater of [Calc] or [Floor]" rule)
  calculated = Math.max(calculated, floor);

  // 4. Final Cap: Never pay more than the total balance
  return Math.min(calculated, totalBalance);
};

export const calculateIndividualAmortization = (
  liability: Liability,
  extraPaymentsByPeriod?: Record<number, number>,
  plannedPaymentsByPeriod?: Record<number, number>
) => {
  let balance = liability.balance;
  const rate = liability.interestRate;
  
  const timeline: AmortizationRow[] = [];
  let totalInterest = 0;
  let totalFees = 0;
  let periodsElapsed = 0;

  const isBiWeekly = liability.paymentFrequency === 'BI_WEEKLY';
  const isWeekly = liability.paymentFrequency === 'WEEKLY';
  const periodsPerYear = isBiWeekly ? 26 : isWeekly ? 52 : 12;

  const periodRate = rate / 100 / periodsPerYear;
  const startMonthIndex = new Date().getMonth(); // 0-11

  // Initial sanity check for infinite loops (use period-equivalent)
  const firstInterest = balance * periodRate;
  const firstFee = liability.isFeeMonthly 
    ? (liability.annualFee / periodsPerYear) 
    : ((liability.feeMonth || 1) === startMonthIndex + 1 ? liability.annualFee : 0);
  const hasExternalPayments =
    Object.values(extraPaymentsByPeriod || {}).some(v => v > 0) ||
    Object.values(plannedPaymentsByPeriod || {}).some(v => v > 0);

  const firstMin = (() => {
    const percentAmount = balance * (liability.minPaymentPercentage / 100);
    const feePart = liability.minPaymentPlusFees ? firstFee : 0;
    const interestPart = liability.minPaymentPlusInterest ? firstInterest : 0;
    const fixed = liability.minPaymentAmount || 0;
    const floor = liability.minPaymentFloor || 0;
    const raw = percentAmount + feePart + interestPart + fixed;
    return Math.max(raw, floor, 0);
  })();
  
  // Only warn if balance is stable/growing AND it's not a temporary fee spike issue
  // We relax this check slightly to allow for fee months, but if standard interest > min, warn.
  if (
    liability.minPaymentPercentage === 0 &&
    !liability.minPaymentPlusInterest &&
    firstMin <= firstInterest &&
    balance > 0 &&
    !hasExternalPayments // allow loading if schedule/extras will cover it
  ) {
      // Allow it if user has fees included in payment, as that might cover it
      if (!liability.minPaymentPlusFees) {
          return {
              isInfinite: true,
              timeline: [],
              totalInterest: 0,
              totalFees: 0,
              months: 0
          };
      }
  }

  while (balance > 0.01 && periodsElapsed < 3000) {
    periodsElapsed++;
    
    // Fee Charge Logic
    let currentMonthFee = 0;
    if (liability.annualFee > 0) {
      if (liability.isFeeMonthly) {
        currentMonthFee = liability.annualFee / periodsPerYear;
      } else {
        // Calculate current calendar month of simulation (0-11) based on elapsed periods
        const periodsPerMonth = periodsPerYear / 12;
        const simMonthIndex = Math.floor((periodsElapsed - 1) / periodsPerMonth + startMonthIndex) % 12;
        if (simMonthIndex + 1 === (liability.feeMonth || 1)) {
          currentMonthFee = liability.annualFee;
        }
      }
    }
    balance += currentMonthFee;
    totalFees += currentMonthFee;

    const interest = balance * periodRate;
    
    // Calculate required minimum for this period (use raw per-period components, no monthly scaling)
    const floor = liability.minPaymentFloor || 0;
    const percentComponent = balance * (liability.minPaymentPercentage / 100);
    const feeComponent = liability.minPaymentPlusFees ? currentMonthFee : 0;
    const interestComponent = liability.minPaymentPlusInterest ? interest : 0;
    const fixedComponent = liability.minPaymentAmount || 0;

    let requiredPayment = percentComponent + feeComponent + interestComponent + fixedComponent;
    if (requiredPayment < floor) requiredPayment = floor;

    let currentTotalDue = balance + interest;

    // Cap payment at total due
    if (requiredPayment > currentTotalDue) {
        requiredPayment = currentTotalDue;
    }

    const extraPayment = extraPaymentsByPeriod?.[periodsElapsed] || 0;
    const plannedPayment = plannedPaymentsByPeriod?.[periodsElapsed];

    // If a planned payment exists, treat anything above the required amount as additional extra
    const plannedExtra =
      plannedPayment !== undefined
        ? Math.max(0, plannedPayment - requiredPayment)
        : 0;

    let principal = requiredPayment - interest + extraPayment + plannedExtra;
    let payment = requiredPayment + extraPayment + plannedExtra;

    // Final month adjustment
    if (balance < principal) {
        principal = balance;
        payment = principal + interest;
    }

    balance -= principal;
    if (balance < 0) balance = 0;
    
    totalInterest += interest;

    timeline.push({
      month: periodsElapsed,
      payment: payment,
      interest: interest,
      principal: principal,
      fees: currentMonthFee,
      remainingBalance: balance,
      extraPayment:
        extraPayment + plannedExtra > 0
          ? extraPayment + plannedExtra
          : undefined,
    });
  }
  
  const months = Math.ceil((periodsElapsed / periodsPerYear) * 12);

  return {
    isInfinite: false,
    timeline,
    totalInterest,
    totalFees,
    months
  };
};

export const calculatePayoff = (
  initialLiabilities: Liability[],
  extraBudget: number,
  strategy: StrategyType
): PayoffResult => {
  let liabilities = copyLiabilities(initialLiabilities);
  let totalInterestPaid = 0;
  let months = 0;
  const timeline: PayoffMonth[] = [];
  const startMonthIndex = new Date().getMonth(); // 0-11
  
  // Sorting Function
  const sortLiabilities = (currentLiabilities: Liability[]) => {
    return currentLiabilities.sort((a, b) => {
      // Estimate min payment for sorting purposes (ignoring fees for sort stability)
      const intA = a.balance * (a.interestRate / 100 / 12);
      const intB = b.balance * (b.interestRate / 100 / 12);
      
      const minPaymentA = getMinPayment(a, a.balance, intA, 0);
      const minPaymentB = getMinPayment(b, b.balance, intB, 0);

      switch (strategy) {
        case StrategyType.SNOWBALL:
          return a.balance - b.balance;
        case StrategyType.AVALANCHE:
          return b.interestRate - a.interestRate;
        case StrategyType.HYBRID:
          return (b.interestRate / (b.balance || 1)) - (a.interestRate / (a.balance || 1));
        case StrategyType.CFI:
          const cfiA = minPaymentA > 0 ? a.balance / minPaymentA : Infinity;
          const cfiB = minPaymentB > 0 ? b.balance / minPaymentB : Infinity;
          return cfiA - cfiB; 
        case StrategyType.HIGHEST_PAYMENT:
          return minPaymentB - minPaymentA;
        case StrategyType.HIGHEST_UTILIZATION:
           const utilA = a.creditLimit ? a.balance / a.creditLimit : 0;
           const utilB = b.creditLimit ? b.balance / b.creditLimit : 0;
           return utilB - utilA;
        case StrategyType.HIGHEST_INTEREST_AMT:
           return intB - intA;
        case StrategyType.CUSTOM:
          return (a.customOrder || 0) - (b.customOrder || 0);
        default:
          return 0;
      }
    });
  };

  // 1. Calculate Target Monthly Outflow (Baseline)
  const initialMinTotal = initialLiabilities.reduce((sum, d) => {
     const int = d.balance * (d.interestRate / 100 / 12);
     // For baseline, assume monthly fee if applicable, or 0 if annual (averaged out is too complex for baseline)
     const fee = d.isFeeMonthly ? (d.annualFee / 12) : 0;
     return sum + getMinPayment(d, d.balance, int, fee);
  }, 0);
  
  const targetMonthlyOutflow = initialMinTotal + extraBudget;

  liabilities = copyLiabilities(initialLiabilities);
  months = 0;
  totalInterestPaid = 0;
  
  while (liabilities.some(d => d.balance > 0.01) && months < 600) {
      months++;
      let monthlyInterestTotal = 0;
      const paidOffThisMonth: string[] = [];
      const simMonthIndex = (startMonthIndex + months - 1) % 12;

      // Track detailed breakdown for this month
      const monthlyBreakdown: Record<string, { name: string, interest: number, payment: number, balance: number }> = {};
      liabilities.forEach(d => {
          monthlyBreakdown[d.id] = { name: d.name, interest: 0, payment: 0, balance: 0 };
      });

      // A. Accrue Interest & Fees
      liabilities.forEach(d => {
        if (d.balance > 0) {
          // Charge Fee
          let currentMonthFee = 0;
          if (d.annualFee > 0) {
            if (d.isFeeMonthly) {
               currentMonthFee = d.annualFee / 12;
            } else if (simMonthIndex + 1 === (d.feeMonth || 1)) {
               currentMonthFee = d.annualFee;
            }
          }
          d.balance += currentMonthFee;
          
          // Store fee on object temporarily to pass to getMinPayment below
          (d as any)._tempFee = currentMonthFee;

          const interest = d.balance * (d.interestRate / 100 / 12);
          d.balance += interest; // Balance now includes this month's interest
          monthlyInterestTotal += interest;

          monthlyBreakdown[d.id].interest = interest;
        }
      });
      totalInterestPaid += monthlyInterestTotal;

      // B. Calculate Required Minimums for this month
      let currentMonthRequiredMinSum = 0;
      liabilities.forEach(d => {
          if (d.balance > 0.01) {
              const monthlyRate = d.interestRate / 100 / 12;
              const principal = d.balance / (1 + monthlyRate);
              const interest = d.balance - principal;
              const fee = (d as any)._tempFee || 0;

              const min = getMinPayment(d, principal, interest, fee);
              currentMonthRequiredMinSum += min;
          }
      });

      // C. Determine Snowball Amount
      let availableSnowball = Math.max(0, targetMonthlyOutflow - currentMonthRequiredMinSum);
      
      // D. Pay Required Minimums
      liabilities.forEach(d => {
         if (d.balance > 0.01) {
             const monthlyRate = d.interestRate / 100 / 12;
             const principal = d.balance / (1 + monthlyRate);
             const interest = d.balance - principal;
             const fee = (d as any)._tempFee || 0;
             
             const totalDue = d.balance;
             const required = getMinPayment(d, principal, interest, fee);
             
             let payment = Math.min(totalDue, required);
             d.balance -= payment;
             monthlyBreakdown[d.id].payment += payment;
             
             // Check unused budget if payment was capped by balance
             const unused = required - payment;
             if (unused > 0) availableSnowball += unused;
         }
      });

      // E. Apply Snowball
      const activeLiabilities = liabilities.filter(d => d.balance > 0.01);
      sortLiabilities(activeLiabilities);

      for (const liability of activeLiabilities) {
          if (availableSnowball <= 0.01) break;
          const payment = Math.min(liability.balance, availableSnowball);
          liability.balance -= payment;
          monthlyBreakdown[liability.id].payment += payment;
          availableSnowball -= payment;

          if (liability.balance <= 0.01) {
             paidOffThisMonth.push(liability.name);
          }
      }
      
      // Update final balances in breakdown
      liabilities.forEach(d => {
          monthlyBreakdown[d.id].balance = Math.max(0, d.balance);
      });

      const breakdown = Object.keys(monthlyBreakdown).map(id => ({
          liabilityId: id,
          ...monthlyBreakdown[id]
      }));
      
      const currentTotalBalance = liabilities.reduce((sum, d) => sum + d.balance, 0);
      timeline.push({
        month: months,
        totalBalance: Math.max(0, currentTotalBalance),
        totalInterestPaid,
        liabilitiesRemaining: liabilities.filter(d => d.balance > 0.01).length,
        paidOffNames: paidOffThisMonth,
        breakdown
      });
  }

  return {
    strategy,
    monthsToFreedom: months,
    totalInterestPaid,
    timeline
  };
};
