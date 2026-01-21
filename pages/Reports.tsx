import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Asset, Expense, IncomeSource, Liability, UserSettings } from '../types';
import { calculateMonthlyIncome, getMinPayment, AmortizationRow, getAnnualizedIncomeAmount } from '../server/liabilityAlgorithms';
import { generatePaychecks, getPerCheckExpenseAmount, getPerCheckLiabilityAmount, PaycheckOccurrence } from '../utils/paycheckLogic';
import { dbAPI } from '../server/db';
import { CalendarRange, ChevronDown, ChevronUp, Calculator, ArrowRightLeft, Receipt, FileText, Wallet } from 'lucide-react';

interface ReportsProps {
  liabilities: Liability[];
  expenses: Expense[];
  assets: Asset[];
  incomes: IncomeSource[];
  settings: UserSettings;
}

const getMonthlyExpenseAmount = (expense: Expense) => {
  if (expense.frequency === 'BI_WEEKLY') return expense.amount * 2;
  if (expense.frequency === 'WEEKLY') return expense.amount * (52 / 12);
  if (expense.frequency === 'QUARTERLY') return expense.amount / 3;
  if (expense.frequency === 'ANNUAL') return expense.amount / 12;
  return expense.amount;
};

const parseLocalDate = (value?: string | null) => {
  if (!value) return null;
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const getMonthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

type AmortizationDataView = {
  isInfinite: boolean;
  timeline: AmortizationRow[];
  totalInterest: number;
  totalFees: number;
  months: number;
};



type ExtraPayment = {
  id: string;
  liabilityId: string;
  amount: number;
  checkDate?: string | null;
  isChecked?: boolean;
};

const Reports: React.FC<ReportsProps> = ({ liabilities, expenses, assets, incomes, settings }) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth() + 1;
  const defaultMonth = String(currentMonthIndex).padStart(2, '0');
  const [startMonth, setStartMonth] = useState(defaultMonth);
  const [endMonth, setEndMonth] = useState(defaultMonth);

  const currencySymbol = settings.currencySymbol || '$';
  const monthlyIncomeMode = settings.monthlyIncomeMode || 'ANNUALIZED';
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [selectedCheckKey, setSelectedCheckKey] = useState<string | null>(null);
  const [amortizationSchedules, setAmortizationSchedules] = useState<Record<string, AmortizationDataView>>({});
  const [amortizationLoaded, setAmortizationLoaded] = useState(false);
  const [allExtraPayments, setAllExtraPayments] = useState<ExtraPayment[]>([]);
  const budgetStartDate = useMemo(() => {
    if (!settings.startDate) return null;
    const parsed = new Date(settings.startDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }, [settings.startDate]);

  const budgetedIncomes = useMemo(
    () => incomes.filter((i) => i.includeInPlanner !== false),
    [incomes]
  );

  useEffect(() => {
    let active = true;
    const loadAmortizations = async () => {
      setAmortizationLoaded(liabilities.length === 0);
      if (liabilities.length === 0) {
        if (active) setAmortizationSchedules({});
        return;
      }
      const results = await Promise.all(
        liabilities.map(async (liability) => {
          try {
            const remote = await dbAPI.getLiabilityAmortization(liability.id);
            if (remote?.schedule) {
              return [liability.id, remote.schedule] as const;
            }
          } catch {
            /* ignore fetch errors */
          }
          return [liability.id, null] as const;
        })
      );
      if (!active) return;
      const next: Record<string, AmortizationDataView> = {};
      results.forEach(([id, schedule]) => {
        if (schedule) {
          next[id] = schedule as AmortizationDataView;
        }
      });
      setAmortizationSchedules(next);
      setAmortizationLoaded(true);
    };
    loadAmortizations();
    dbAPI.getExtraPayments().then((response) => {
      if (active && response?.extras) {
        setAllExtraPayments(response.extras);
      }
    });

    return () => {
      active = false;
    };
  }, [liabilities]);

  const scheduleBalanceById = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next: Record<string, number> = {};
    liabilities.forEach((liability) => {
      const schedule = amortizationSchedules[liability.id];
      if (!schedule?.timeline?.length) {
        next[liability.id] = liability.balance;
        return;
      }
      let latestDate: Date | null = null;
      let latestBalance: number | null = null;
      schedule.timeline.forEach((row) => {
        const parsed = parseLocalDate(row.actualDate ?? null);
        if (!parsed || parsed > today) return;
        if (!latestDate || parsed > latestDate) {
          latestDate = parsed;
          latestBalance = row.remainingBalance;
        }
      });
      if (latestBalance !== null) {
        next[liability.id] = latestBalance;
        return;
      }
      const historicalRows = schedule.timeline.filter(
        (row) => row.isHistorical || row.month <= 0
      );
      if (historicalRows.length) {
        const latestHistorical = historicalRows.reduce((acc, cur) =>
          cur.month > acc.month ? cur : acc
        );
        next[liability.id] = latestHistorical.remainingBalance;
        return;
      }
      next[liability.id] = liability.balance;
    });
    return next;
  }, [amortizationSchedules, liabilities]);

  const getMonthlyPaymentFromSchedule = (liability: Liability) => {
    const schedule = amortizationSchedules[liability.id];
    if (!schedule?.timeline?.length) return null;
    const isBiWeekly = liability.paymentFrequency === 'BI_WEEKLY';
    const isWeekly = liability.paymentFrequency === 'WEEKLY';
    const periodsPerYear = isBiWeekly ? 26 : isWeekly ? 52 : 12;
    const periodsPerMonth = periodsPerYear / 12;
    let total = 0;
    schedule.timeline.forEach((row) => {
      if (row.month <= 0) return;
      const monthIndex = Math.max(1, Math.ceil(row.month / periodsPerMonth));
      if (monthIndex === 1) {
        total += row.payment;
      }
    });
    return total;
  };

  const monthlyBudget = settings.monthlyBudget || 0;

  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  const totalLiabilities = liabilities.reduce(
    (sum, l) => sum + (scheduleBalanceById[l.id] ?? l.balance),
    0
  );
  const netWorth = totalAssets - totalLiabilities;

  const liabilityCostRatings = useMemo(() => {
    return liabilities
      .map(liability => {
        const balance = scheduleBalanceById[liability.id] ?? liability.balance;
        if (balance <= 0) {
          return null;
        }
        const monthlyInterest = balance * (liability.interestRate / 100 / 12);
        const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
        const minPayment = getMinPayment(liability, balance, monthlyInterest, estFee);
        const rating = minPayment / balance;
        return {
          id: liability.id,
          name: liability.name,
          rating: rating,
          balance: balance,
          minPayment: minPayment
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.rating - a.rating);
  }, [liabilities, scheduleBalanceById]);

  const toMonthIndex = (value: string) => {
    const month = Number(value) || 1;
    return month - 1;
  };

  const monthCount = (() => {
    const startIdx = toMonthIndex(startMonth);
    const endIdx = toMonthIndex(endMonth);
    return Math.max(1, endIdx - startIdx + 1);
  })();

  const periodRange = useMemo(() => {
    const startValue = Number(startMonth) || currentMonthIndex;
    const endValue = Number(endMonth) || startValue;
    const normalizedEnd = endValue < startValue ? startValue : endValue;
    return {
      start: new Date(currentYear, startValue - 1, 1),
      end: new Date(currentYear, normalizedEnd, 0),
    };
  }, [currentYear, currentMonthIndex, endMonth, startMonth]);

  const activeLiabilities = useMemo(() => {
    const rangeEnd = new Date(periodRange.end);
    rangeEnd.setHours(0, 0, 0, 0);
    return liabilities.filter((liability) => {
      if (!liability.startDate) return true;
      const start = new Date(`${liability.startDate}T12:00:00`);
      if (Number.isNaN(start.getTime())) return true;
      start.setHours(0, 0, 0, 0);
      return start <= rangeEnd;
    });
  }, [liabilities, periodRange.end]);

  const getActiveMonthsForLiability = useCallback(
    (liability: Liability) => {
      if (!liability.startDate) return monthCount;
      const start = new Date(`${liability.startDate}T12:00:00`);
      if (Number.isNaN(start.getTime())) return monthCount;
      const rangeStart = new Date(periodRange.start);
      const rangeEnd = new Date(periodRange.end);
      const effectiveStart = start > rangeStart ? start : rangeStart;
      if (effectiveStart > rangeEnd) return 0;
      const startIndex = effectiveStart.getFullYear() * 12 + effectiveStart.getMonth();
      const endIndex = rangeEnd.getFullYear() * 12 + rangeEnd.getMonth();
      return Math.max(1, endIndex - startIndex + 1);
    },
    [monthCount, periodRange.end, periodRange.start]
  );

  const userSplitRatio = useMemo(() => {
    if (!settings.enablePartner) return 1;
    if (settings.expenseSplitMethod === 'PERCENTAGE') {
      return (settings.userSplitPercentage || 50) / 100;
    }
    if (settings.expenseSplitMethod === 'INCOME') {
      const mine = budgetedIncomes
        .filter((i) => !i.isPartner && !i.excludeFromSplitting)
        .reduce((sum, source) => sum + getAnnualizedIncomeAmount(source), 0);
      const partner = budgetedIncomes
        .filter((i) => i.isPartner && !i.excludeFromSplitting)
        .reduce((sum, source) => sum + getAnnualizedIncomeAmount(source), 0);
      const total = mine + partner;
      if (total <= 0) return 0.5;
      return mine / total;
    }
    return 0.5;
  }, [budgetedIncomes, settings]);

  const formatCurrency = (value: number) =>
    `${currencySymbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatCurrencyPrecise = formatCurrency;
  const balancesReady = liabilities.length === 0 || amortizationLoaded;

  const toggleReport = (key: string) => {
    setExpandedReport((current) => (current === key ? null : key));
  };

  const paychecks = useMemo(() => {
    return generatePaychecks(budgetedIncomes, periodRange.start, periodRange.end, {
      budgetStartDate
    });
  }, [budgetStartDate, budgetedIncomes, periodRange]);

  const paychecksInPeriod = useMemo(
    () =>
      paychecks.filter(
        (paycheck) => paycheck.date >= periodRange.start && paycheck.date <= periodRange.end
      ),
    [paychecks, periodRange]
  );

  const incomeTotalsById = useMemo(() => {
    const totals = new Map<string, number>();
    paychecksInPeriod.forEach((paycheck) => {
      const current = totals.get(paycheck.source.id) || 0;
      totals.set(paycheck.source.id, current + paycheck.source.amount);
    });
    return totals;
  }, [paychecksInPeriod]);

  const periodIncomeTotal = useMemo(
    () => paychecksInPeriod.reduce((sum, paycheck) => sum + paycheck.source.amount, 0),
    [paychecksInPeriod]
  );

  const transferChecks = useMemo(() => {
    return paychecks.map((paycheck) => {
      const dateKey = paycheck.date.toISOString().split('T')[0];
      return {
        key: `${paycheck.source.id}-${dateKey}`,
        date: paycheck.date,
        label: `${paycheck.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} - ${paycheck.source.name}`,
        paycheck,
      };
    });
  }, [paychecks]);

  const defaultTransferKey = useMemo(() => {
    if (transferChecks.length === 0) return null;
    const today = new Date();
    const next = transferChecks.find((check) => check.date >= today);
    return (next || transferChecks[transferChecks.length - 1]).key;
  }, [transferChecks]);

  useEffect(() => {
    if (!selectedCheckKey && defaultTransferKey) {
      setSelectedCheckKey(defaultTransferKey);
      return;
    }
    if (selectedCheckKey && !transferChecks.some((check) => check.key === selectedCheckKey)) {
      setSelectedCheckKey(defaultTransferKey);
    }
  }, [defaultTransferKey, selectedCheckKey, transferChecks]);

  const selectedTransfer = transferChecks.find((check) => check.key === selectedCheckKey) || null;

  const liabilityWithMins = useMemo(() => {
    return activeLiabilities.map((liability) => {
      const currentBalance = scheduleBalanceById[liability.id] ?? liability.balance;
      const monthlyInterest = currentBalance * (liability.interestRate / 100 / 12);
      const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
      return {
        ...liability,
        plannedPayment: getMinPayment(liability, currentBalance, monthlyInterest, estFee),
        scheduledFrequency: liability.paymentFrequency || 'MONTHLY',
      };
    });
  }, [activeLiabilities, scheduleBalanceById]);

  const monthPaychecksByKey = useMemo(() => {
    const buckets = new Map<string, PaycheckOccurrence[]>();
    paychecks.forEach((paycheck) => {
      const key = getMonthKey(paycheck.date);
      const existing = buckets.get(key);
      if (existing) {
        existing.push(paycheck);
        return;
      }
      buckets.set(key, [paycheck]);
    });
    return buckets;
  }, [paychecks]);

  const getMonthPaychecksFor = useCallback(
    (date: Date) => monthPaychecksByKey.get(getMonthKey(date)) || [],
    [monthPaychecksByKey]
  );

  const monthPaychecks = useMemo(() => {
    if (!selectedTransfer) return paychecks;
    const key = getMonthKey(selectedTransfer.date);
    return monthPaychecksByKey.get(key) || paychecks;
  }, [monthPaychecksByKey, paychecks, selectedTransfer]);



  const getPerCheckExpenseFor = useCallback((expense: Expense, currentPaycheck: PaycheckOccurrence | null, monthPaychecksForCheck: PaycheckOccurrence[]) => {
    return getPerCheckExpenseAmount(expense, currentPaycheck, monthPaychecksForCheck, budgetedIncomes, userSplitRatio);
  }, [userSplitRatio, budgetedIncomes]);

  const getPerCheckExpense = (expense: Expense) => {
    const currentPaycheck = selectedTransfer?.paycheck || null;
    if (!currentPaycheck) return 0;
    const monthPaychecksForCheck = getMonthPaychecksFor(currentPaycheck.date);
    return getPerCheckExpenseFor(expense, currentPaycheck, monthPaychecksForCheck);
  };

  const getPerCheckLiabilityFor = useCallback((liability: typeof liabilityWithMins[number], currentPaycheck: PaycheckOccurrence | null, monthPaychecksForCheck: PaycheckOccurrence[]) => {
    return getPerCheckLiabilityAmount(
      liability,
      currentPaycheck,
      monthPaychecksForCheck,
      budgetedIncomes,
      allExtraPayments,
      userSplitRatio,
      { includeUnchecked: false }
    );
  }, [userSplitRatio, budgetedIncomes, allExtraPayments]);

  const getPerCheckLiability = (liability: typeof liabilityWithMins[number]) => {
    const currentPaycheck = selectedTransfer?.paycheck || null;
    if (!currentPaycheck) return 0;
    const monthPaychecksForCheck = getMonthPaychecksFor(currentPaycheck.date);
    return getPerCheckLiabilityFor(liability, currentPaycheck, monthPaychecksForCheck);
  };

  const getExpensePeriodTotal = useCallback(
    (expense: Expense) => {
      return paychecksInPeriod.reduce((sum, paycheck) => {
        const monthPaychecksForCheck = getMonthPaychecksFor(paycheck.date);
        return sum + getPerCheckExpenseFor(expense, paycheck, monthPaychecksForCheck);
      }, 0);
    },
    [getMonthPaychecksFor, getPerCheckExpenseFor, paychecksInPeriod]
  );

  const getLiabilityPeriodTotal = useCallback(
    (liability: typeof liabilityWithMins[number]) => {
      return paychecksInPeriod.reduce((sum, paycheck) => {
        const monthPaychecksForCheck = getMonthPaychecksFor(paycheck.date);
        return sum + getPerCheckLiabilityFor(liability, paycheck, monthPaychecksForCheck);
      }, 0);
    },
    [getMonthPaychecksFor, getPerCheckLiabilityFor, paychecksInPeriod]
  );

  const periodExpenseTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + getExpensePeriodTotal(expense), 0),
    [expenses, getExpensePeriodTotal]
  );

  const periodLiabilityTotal = useMemo(
    () => liabilityWithMins.reduce((sum, liability) => sum + getLiabilityPeriodTotal(liability), 0),
    [getLiabilityPeriodTotal, liabilityWithMins]
  );

  const expenseCategoryRows = useMemo(() => {
    const buckets = new Map<string, { items: Expense[]; total: number }>();
    expenses.forEach((expense) => {
      const amount = getExpensePeriodTotal(expense);
      if (amount === 0) return;
      const key = expense.category?.trim() || 'Uncategorized';
      const existing = buckets.get(key) || { items: [], total: 0 };
      existing.items.push(expense);
      existing.total += amount;
      buckets.set(key, existing);
    });
    return Array.from(buckets.entries())
      .map(([category, data]) => ({
        category,
        items: data.items.slice().sort((a, b) => a.name.localeCompare(b.name)),
        total: data.total,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [expenses, getExpensePeriodTotal]);

  const liabilityCategoryRows = useMemo(() => {
    const buckets = new Map<string, { items: typeof liabilityWithMins[number][]; total: number }>();
    liabilityWithMins.forEach((liability) => {
      const amount = getLiabilityPeriodTotal(liability);
      if (amount === 0) return;
      const key = liability.category?.trim() || 'Uncategorized';
      const existing = buckets.get(key) || { items: [], total: 0 };
      existing.items.push(liability);
      existing.total += amount;
      buckets.set(key, existing);
    });
    return Array.from(buckets.entries())
      .map(([category, data]) => ({
        category,
        items: data.items.slice().sort((a, b) => a.name.localeCompare(b.name)),
        total: data.total,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [getLiabilityPeriodTotal, liabilityWithMins]);

  const periodCashOut = useMemo(
    () => periodExpenseTotal + periodLiabilityTotal + monthlyBudget * monthCount,
    [monthCount, monthlyBudget, periodExpenseTotal, periodLiabilityTotal]
  );
  const periodNet = useMemo(() => periodIncomeTotal - periodCashOut, [periodCashOut, periodIncomeTotal]);

  const transferGroups = useMemo(() => {
    if (!selectedTransfer) return [];
    const buckets = new Map<string, { account: string; total: number; items: { name: string; amount: number; type: string }[] }>();
    expenses.forEach((expense) => {
      const account = expense.transferAccount?.trim();
      if (!account) return;
      const amount = getPerCheckExpense(expense);
      if (amount <= 0) return;
      const existing = buckets.get(account) || { account, total: 0, items: [] };
      existing.total += amount;
      existing.items.push({
        name: expense.name,
        amount,
        type: 'Expense',
      });
      buckets.set(account, existing);
    });
    liabilityWithMins.forEach((liability) => {
      const account = liability.transferAccount?.trim();
      if (!account) return;
      const amount = getPerCheckLiability(liability);
      if (amount <= 0) return;
      const existing = buckets.get(account) || { account, total: 0, items: [] };
      existing.total += amount;
      existing.items.push({
        name: liability.name,
        amount,
        type: 'Liability',
      });
      buckets.set(account, existing);
    });
    return Array.from(buckets.values()).sort((a, b) =>
      a.account.localeCompare(b.account)
    );
  }, [expenses, getPerCheckExpense, getPerCheckLiability, liabilityWithMins, selectedTransfer]);

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, idx) => {
        const value = String(idx + 1).padStart(2, '0');
        return {
          value,
          label: new Date(now.getFullYear(), idx, 1).toLocaleDateString(undefined, {
            month: 'long',
          }),
        };
      }),
    [now]
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-indigo-500 text-white rounded-lg">
          <FileText size={20} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 space-y-1">
              <button
                type="button"
                onClick={() => toggleReport('budget')}
                className="flex items-center justify-between w-full text-left"
                aria-expanded={expandedReport === 'budget'}
              >
                <span className="flex items-center space-x-2">
                  <span className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                    <Calculator size={18} />
                  </span>
                  <span className="text-lg font-bold text-slate-900 hover:text-indigo-600 transition-colors">
                    Budget
                  </span>
                </span>
                <span className="text-slate-500">
                  {expandedReport === 'budget' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </span>
              </button>
            </div>
            <div>
              <div className="flex flex-col sm:flex-row gap-3">
                <div>
                  <select
                    value={startMonth}
                    onChange={(e) => setStartMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {monthOptions.map((option) => (
                      <option key={`start-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center">
                  <p className="text-xs text-slate-400 items-center">to</p>
                </div>
                <div>
                  <select
                    value={endMonth}
                    onChange={(e) => setEndMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {monthOptions.map((option) => (
                      <option key={`end-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4 space-y-4 font-mono text-sm">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Income</p>
              {budgetedIncomes.length === 0 ? (
                <p className="text-xs text-slate-400">No income sources recorded.</p>
              ) : (
                <div className="space-y-2">
                  <div>
                    {expandedReport !== 'budget' ? (
                      <div className="space-y-1">
                        {budgetedIncomes
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((income) => {
                            const amount = incomeTotalsById.get(income.id) || 0;
                            if (amount === 0) return null;
                            return (
                              <div key={income.id} className="flex items-center justify-between text-slate-600 pl-3 pr-24">
                                <span className="font-medium">{income.name}</span>
                                <span className="font-semibold">
                                  {formatCurrency(amount)}
                                </span>
                              </div>
                            );
                          })}
                        <div className="flex items-center justify-end pt-2 text-slate-600 border-t border-slate-100">
                          <span className="font-semibold">+{formatCurrency(periodIncomeTotal)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 pl-3 text-xs text-slate-400">
                        {budgetedIncomes
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((income) => {
                            const amount = incomeTotalsById.get(income.id) || 0;
                            if (amount === 0) return null;
                            return (
                              <div key={income.id} className="flex items-center justify-between pr-24">
                                <span>{income.name}</span>
                                <span>{formatCurrency(amount)}</span>
                              </div>
                            );
                          })}
                        <div className="flex items-center justify-end border-t border-slate-100">
                          <span className="font-semibold text-slate-700">+{formatCurrency(periodIncomeTotal)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Expenses</p>
              {expenses.length === 0 ? (
                <p className="text-xs text-slate-400">No expenses recorded.</p>
              ) : (
                <div className="space-y-2">
                  {expenseCategoryRows.map((row) => (
                    <div key={`budget-exp-${row.category}`} className="space-y-1">
                      <div className="flex items-center justify-between text-slate-600 pl-3 pr-24">
                        <span className="font-medium">{row.category}</span>
                        {expandedReport !== 'budget' && (
                          <span className="font-semibold">-{formatCurrency(row.total)}</span>
                        )}
                      </div>
                      {expandedReport === 'budget' && (
                        <div className="space-y-1 pl-6 text-xs text-slate-400">
                          {row.items.map((expense) => {
                            const amount = getExpensePeriodTotal(expense);
                            if (amount === 0) return null;
                            return (
                              <div key={expense.id} className="flex items-center justify-between pr-24">
                                <span>{expense.name}</span>
                                <span>{formatCurrency(amount)}</span>
                              </div>
                            );
                          })}
                          <div className="flex items-center justify-end pt-2 text-slate-600 border-t border-slate-100">
                            <span className="font-semibold">-{formatCurrency(row.total)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              {expandedReport !== 'budget' ? (
                <div className="flex items-center justify-end border-t border-slate-100">
                  <span className="font-semibold text-slate-700">-{formatCurrency(periodExpenseTotal)}</span>
                </div>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Liability Minimums</p>
              {liabilities.length === 0 ? (
                <p className="text-xs text-slate-400">No liabilities recorded.</p>
              ) : !balancesReady ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={`budget-liability-skeleton-${idx}`} className="flex items-center justify-between pl-3 pr-24">
                      <div className="h-4 w-32 rounded bg-slate-100 animate-pulse" />
                      <div className="h-4 w-20 rounded bg-slate-100 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {liabilityCategoryRows.map((row) => (
                    <div key={`budget-liability-${row.category}`} className="space-y-1">
                      <div className="flex items-center justify-between text-slate-600 pl-3 pr-24">
                        <span className="font-medium">{row.category}</span>
                        {expandedReport !== 'budget' && (
                          <span className="font-semibold">-{formatCurrency(row.total)}</span>
                        )}
                      </div>
                      {expandedReport === 'budget' && (
                        <div className="space-y-1 pl-6 text-xs text-slate-400">
                          {row.items.map((liability) => {
                            const amount = getLiabilityPeriodTotal(liability);
                            if (amount === 0) return null;
                            return (
                              <div key={liability.id} className="flex items-center justify-between pr-24">
                                <div>
                                  <span>{liability.name}{liability.subtitle ? ` • ${liability.subtitle}` : ''}</span>
                                </div>
                                <span>{formatCurrency(amount)}</span>
                              </div>
                            );
                          })}
                          <div className="flex items-center justify-end pt-2 text-slate-600 border-t border-slate-100">
                            <span className="font-semibold">-{formatCurrency(row.total)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              {expandedReport !== 'budget' ? (
                <div className="space-y-1 flex items-center justify-end border-t border-slate-100">
                  {balancesReady ? (
                    <span className="font-semibold">-{formatCurrency(periodLiabilityTotal)}</span>
                  ) : (
                    <div className="h-4 w-24 rounded bg-slate-100 animate-pulse" />
                  )}
                </div>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="font-semibold text-slate-700">Remaining</span>
              {balancesReady ? (
                <span className={`font-semibold ${periodNet >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                  {formatCurrency(periodNet)}
                </span>
              ) : (
                <div className="h-4 w-24 rounded bg-slate-100 animate-pulse" />
              )}
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 space-y-1">
              <button
                type="button"
                onClick={() => toggleReport('transfers')}
                className="flex items-center justify-between w-full text-left"
                aria-expanded={expandedReport === 'transfers'}
              >
                <span className="flex items-center space-x-2">
                  <span className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                    <ArrowRightLeft size={18} />
                  </span>
                  <span className="text-lg font-bold text-slate-900 hover:text-indigo-600 transition-colors">
                    Transfers
                  </span>
                </span>
                <span className="text-slate-500">
                  {expandedReport === 'transfers' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </span>
              </button>
            </div>
            <div>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                value={selectedCheckKey || ''}
                onChange={(e) => setSelectedCheckKey(e.target.value)}
                disabled={transferChecks.length === 0}
              >
                {transferChecks.length === 0 && <option value="">No checks</option>}
                {transferChecks.map((check) => (
                  <option key={check.key} value={check.key}>
                    {check.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {transferGroups.length === 0 ? (
            <p className="text-sm text-slate-400">No transfers configured for this check.</p>
          ) : (
            <div className="space-y-4 text-sm">
              {transferGroups.map((group) => (
                <div key={group.account} className="space-y-1">
                  <div className="flex items-center justify-between font-mono text-slate-600">
                    <span className="font-semibold text-slate-700">{group.account}</span>
                    {expandedReport !== 'transfers' && (
                      <span className="font-semibold text-slate-900">{formatCurrencyPrecise(group.total)}</span>
                    )}
                  </div>
                  {expandedReport === 'transfers' && (
                    <div className="space-y-1 pl-3 text-xs text-slate-400">
                      {group.items.map((item, idx) => (
                        <div key={`${group.account}-${item.name}-${idx}`} className="flex items-center justify-between pr-24">
                          <span>{item.name}</span>
                          <span>{formatCurrencyPrecise(item.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-end pt-2 text-slate-600 border-t border-slate-100">
                        <span className="font-semibold text-slate-900">{formatCurrencyPrecise(group.total)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 space-y-1">
              <button
                type="button"
                onClick={() => toggleReport('costRating')}
                className="flex items-center justify-between w-full text-left"
                aria-expanded={expandedReport === 'costRating'}
              >
                <span className="flex items-center space-x-2">
                  <span className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                    <Wallet size={18} />
                  </span>
                  <span className="text-lg font-bold text-slate-900 hover:text-indigo-600 transition-colors">
                    Liability Cost Rating
                  </span>
                </span>
                <span className="text-slate-500">
                  {expandedReport === 'costRating' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </span>
              </button>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4 space-y-4 text-sm">
            {liabilityCostRatings.length === 0 ? (
              <p className="text-xs text-slate-400">No liabilities with a balance to rate.</p>
            ) : (
              liabilityCostRatings.map(item => (
                <div key={item.id}>
                  <div className="flex justify-between items-center font-medium text-slate-700">
                    <span>{item.name}</span>
                    <span className="font-mono font-semibold">{(item.rating * 100).toFixed(2)}%</span>
                  </div>
                  {expandedReport === 'costRating' && (
                    <div className="text-xs text-slate-500 pl-4 mt-1">
                      Min. payment of {formatCurrency(item.minPayment)} on a {formatCurrency(item.balance)} balance.
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
