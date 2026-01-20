import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Liability, Expense, Asset, StrategyType, STRATEGY_LABELS, UserSettings, IncomeSource, BudgetSchedule, PayoffResult } from '../types';
import { calculatePayoff, getMinPayment, calculateMonthlyIncomeByMode, AmortizationRow } from '../server/liabilityAlgorithms';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Calendar, Wallet, LayoutDashboard, DollarSign, Receipt, Landmark, Calculator, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { dbAPI } from '../server/db';

const useChartDimensions = () => {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((el: HTMLDivElement | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: rect.width > 0 ? rect.width : 0,
        height: rect.height > 0 ? rect.height : 0,
      });
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref, size };
};

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
};

type AmortizationOverride = {
  payment: number;
  interest: number;
  purchase?: number;
  checkDate?: string | null;
};

const parseLocalDate = (value?: string | null) => {
  if (!value) return null;
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

interface DashboardProps {
  liabilities: Liability[];
  expenses: Expense[];
  assets: Asset[];
  incomes?: IncomeSource[];
  monthlyBudget: number;
  userSettings?: UserSettings;
}

const Dashboard: React.FC<DashboardProps> = ({ liabilities, expenses, assets, incomes = [], monthlyBudget, userSettings }) => {
  const [chartsReady, setChartsReady] = useState(false);
  const [savedPlan, setSavedPlan] = useState<BudgetSchedule | null>(null);
  const [projection, setProjection] = useState<PayoffResult | null>(null);
  const [amortizationSchedules, setAmortizationSchedules] = useState<Record<string, AmortizationDataView>>({});
  const [amortizationLoaded, setAmortizationLoaded] = useState(false);
  const [extraPayments, setExtraPayments] = useState<ExtraPayment[]>([]);
  const [amortizationOverrides, setAmortizationOverrides] = useState<
    Record<string, Record<number, AmortizationOverride>>
  >({});
  const [extrasLoaded, setExtrasLoaded] = useState(false);
  const [overridesLoaded, setOverridesLoaded] = useState(false);
  const { ref: payoffChartRef, size: payoffSize } = useChartDimensions();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const remote = await dbAPI.getBudgetSchedule();
        if (!active) return;
        setSavedPlan(remote?.schedule || null);
      } catch {
        if (active) setSavedPlan(null);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

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
    return () => {
      active = false;
    };
  }, [liabilities]);

  useEffect(() => {
    let active = true;
    const loadExtras = async () => {
      try {
        const remote = await dbAPI.getExtraPayments();
        if (!active || !remote?.extras) return;
        setExtraPayments(remote.extras || []);
      } catch {
        /* ignore fetch errors */
      } finally {
        if (active) setExtrasLoaded(true);
      }
    };
    const loadOverrides = async () => {
      try {
        const remote = await dbAPI.getAmortizationOverrides();
        if (!active || !remote?.overrides) return;
        const mapped = remote.overrides.reduce<
          Record<string, Record<number, AmortizationOverride>>
        >((acc, row) => {
          if (!acc[row.liabilityId]) {
            acc[row.liabilityId] = {};
          }
          acc[row.liabilityId][row.period] = {
            payment: row.payment,
            interest: row.interest,
            purchase: row.purchase ?? 0,
            checkDate: row.checkDate ?? null,
          };
          return acc;
        }, {});
        setAmortizationOverrides(mapped);
      } catch {
        /* ignore override fetch errors */
      } finally {
        if (active) setOverridesLoaded(true);
      }
    };
    loadExtras();
    loadOverrides();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setChartsReady(true);
  }, []);
  const simpleTerms = userSettings?.useSimpleTerms;
  const liabilityLabel = simpleTerms ? 'Loan' : 'Liability';
  const liabilityPlural = simpleTerms ? 'Loans' : 'Liabilities';
  const expenseLabel = simpleTerms ? 'Bill' : 'Expense';
  const expensePlural = simpleTerms ? 'Bills' : 'Expenses';
  const currencySymbol = userSettings?.currencySymbol || '$';
  const monthlyIncomeMode = userSettings?.monthlyIncomeMode || 'ANNUALIZED';
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();
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
      const historicalRows = schedule.timeline.filter((row) => {
        if (!(row.isHistorical || row.month <= 0)) return false;
        const parsed = parseLocalDate(row.actualDate ?? null);
        return !parsed || parsed <= today;
      });
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

  const totalLiability = liabilities.reduce(
    (sum, d) => sum + (scheduleBalanceById[d.id] ?? d.balance),
    0
  );
  const balancesReady =
    liabilities.length === 0 || (amortizationLoaded && extrasLoaded && overridesLoaded);
  const creditLimitLiabilities = liabilities.filter(
    (liability) => (liability.creditLimit || 0) > 0
  );
  const totalCreditLimit = creditLimitLiabilities.reduce(
    (sum, liability) => sum + (liability.creditLimit || 0),
    0
  );
  const isMinimumPaymentId = (id: string) => id.startsWith('min-');
  const getHistoricalPaidAmount = (liability: Liability) => {
    return extraPayments
      .filter(
        (p) =>
          p.liabilityId === liability.id &&
          !isMinimumPaymentId(p.id) &&
          (p.amount || 0) !== 0
      )
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  };
  const getDisplayBalance = (liability: Liability) => {
    const scheduleBalance = scheduleBalanceById[liability.id];
    if (Number.isFinite(scheduleBalance ?? NaN)) {
      return Math.max(0, scheduleBalance as number);
    }
    return Math.max(0, liability.balance || 0);
  };
  const totalCreditBalance = creditLimitLiabilities.reduce(
    (sum, liability) =>
      sum + (balancesReady ? getDisplayBalance(liability) : liability.balance),
    0
  );
  const creditAvailable = totalCreditLimit - totalCreditBalance;
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
  const totalMinPayment = liabilities.reduce((sum, d) => {
    const scheduled = getMonthlyPaymentFromSchedule(d);
    if (scheduled !== null) return sum + scheduled;
    const currentBalance = getDisplayBalance(d);
    const monthlyInterest = currentBalance * (d.interestRate / 100 / 12);
    const estFee = d.isFeeMonthly ? (d.annualFee / 12) : 0;
    return sum + getMinPayment(d, currentBalance, monthlyInterest, estFee);
  }, 0);
  const avgInterest = liabilities.length > 0 
    ? liabilities.reduce((sum, d) => sum + d.interestRate, 0) / liabilities.length 
    : 0;

  // Expense Calculations
  const totalMonthlyExpenses = expenses.reduce((sum, b) => {
    const multiplier =
      b.frequency === 'BI_WEEKLY'
        ? 2
        : b.frequency === 'WEEKLY'
        ? 52 / 12
        : b.frequency === 'QUARTERLY'
        ? 1 / 3
        : b.frequency === 'ANNUAL'
        ? 1 / 12
        : 1;
    return sum + b.amount * multiplier;
  }, 0);
  
  // Asset Calculations
  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  const netWorth = totalAssets - totalLiability;
  const budgetedIncomes = incomes.filter((i) => i.includeInPlanner !== false);
  const budgetStartDate = useMemo(() => {
    if (!userSettings?.startDate) return null;
    const parsed = new Date(userSettings.startDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }, [userSettings?.startDate]);
  const activeLiabilities = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return liabilities.filter((liability) => {
      if (!liability.startDate) return true;
      const start = new Date(`${liability.startDate}T12:00:00`);
      if (Number.isNaN(start.getTime())) return true;
      start.setHours(0, 0, 0, 0);
      return start <= today;
    });
  }, [liabilities]);
  const currentMonthLiabilityMins = useMemo(() => {
    return activeLiabilities.reduce((sum, l) => {
      const scheduled = getMonthlyPaymentFromSchedule(l);
      if (scheduled !== null) return sum + scheduled;
      const currentBalance = getDisplayBalance(l);
      const monthlyInterest = currentBalance * (l.interestRate / 100 / 12);
      const estFee = l.isFeeMonthly ? l.annualFee / 12 : 0;
      return sum + getMinPayment(l, currentBalance, monthlyInterest, estFee);
    }, 0);
  }, [activeLiabilities, amortizationSchedules]);
  const currentMonthIncome = useMemo(() => {
    if (budgetedIncomes.length === 0) return 0;
    const periodStart = new Date(currentYear, currentMonthIndex, 1);
    const periodEnd = new Date(currentYear, currentMonthIndex + 1, 0);
    const startBoundary =
      budgetStartDate && budgetStartDate.getTime() > periodStart.getTime()
        ? budgetStartDate
        : periodStart;

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

    const getPayDates = (source: IncomeSource, startDate: Date, endDate: Date): Date[] => {
      if (!source.nextPayDate) return [];
      const [y, m, d] = source.nextPayDate.split('-').map(Number);
      const seed = new Date(y, m - 1, d);
      if (Number.isNaN(seed.getTime())) return [];
      if (source.frequency === 'SEMI_MONTHLY') {
        return getSemiMonthlyDates(seed.getDate(), startDate, endDate);
      }

      let current = new Date(seed);
      const dates: Date[] = [];
      let iterations = 0;
      while (current > startDate && iterations < 5000) {
        const prev = new Date(current);
        switch (source.frequency) {
          case 'WEEKLY':
            prev.setDate(prev.getDate() - 7);
            break;
          case 'BI_WEEKLY':
            prev.setDate(prev.getDate() - 14);
            break;
          case 'MONTHLY':
            prev.setMonth(prev.getMonth() - 1);
            break;
          case 'ANNUAL':
            prev.setFullYear(prev.getFullYear() - 1);
            break;
          default:
            prev.setDate(prev.getDate() - 30);
        }
        if (prev < startDate) break;
        current = prev;
        iterations += 1;
      }

      iterations = 0;
      while (current <= endDate && iterations < 5000) {
        if (current >= startDate) {
          dates.push(new Date(current));
        }
        iterations += 1;
        switch (source.frequency) {
          case 'WEEKLY':
            current.setDate(current.getDate() + 7);
            break;
          case 'BI_WEEKLY':
            current.setDate(current.getDate() + 14);
            break;
          case 'MONTHLY':
            current.setMonth(current.getMonth() + 1);
            break;
          case 'ANNUAL':
            current.setFullYear(current.getFullYear() + 1);
            break;
          default:
            current.setDate(current.getDate() + 30);
        }
      }
      return dates;
    };

    return budgetedIncomes.reduce((sum, source) => {
      const count = getPayDates(source, startBoundary, periodEnd).length;
      return sum + count * source.amount;
    }, 0);
  }, [budgetStartDate, budgetedIncomes, currentMonthIndex, currentYear]);
  const totalPartnerIncome = calculateMonthlyIncomeByMode(
    budgetedIncomes.filter((i) => i.isPartner),
    monthlyIncomeMode
  );
  const totalMyIncome = calculateMonthlyIncomeByMode(
    budgetedIncomes.filter((i) => !i.isPartner),
    monthlyIncomeMode
  );
  const totalIncome = totalMyIncome + totalPartnerIncome;
  const totalCommitment = totalMinPayment + totalMonthlyExpenses + monthlyBudget;
  const freeCashFlow = currentMonthIncome - totalMonthlyExpenses - currentMonthLiabilityMins;
  const isDeficit = freeCashFlow < 0;

  useEffect(() => {
    let active = true;
    const loadProjection = async () => {
      if (savedPlan?.timeline?.length) {
        const last = savedPlan.timeline[savedPlan.timeline.length - 1];
        const planned = {
          strategy: savedPlan.strategy as StrategyType,
          monthsToFreedom: last?.month ?? savedPlan.timeline.length,
          totalInterestPaid: last?.totalInterestPaid ?? 0,
          timeline: savedPlan.timeline,
        };
        if (active) setProjection(planned);
        return;
      }
      try {
        const remote = await dbAPI.getStrategySimulation(StrategyType.AVALANCHE, monthlyBudget);
        if (active) setProjection(remote.simulation);
      } catch {
        if (active) {
          setProjection({
            strategy: StrategyType.AVALANCHE,
            monthsToFreedom: 0,
            totalInterestPaid: 0,
            timeline: [],
          });
        }
      }
    };
    loadProjection();
    return () => {
      active = false;
    };
  }, [monthlyBudget, savedPlan]);

  const safeProjection = projection || {
    strategy: StrategyType.AVALANCHE,
    monthsToFreedom: 0,
    totalInterestPaid: 0,
    timeline: [],
  };
  const scheduleMonths = useMemo(() => {
    if (!savedPlan?.timeline?.length) return null;
    const last = savedPlan.timeline[savedPlan.timeline.length - 1];
    return last?.month ?? savedPlan.timeline.length;
  }, [savedPlan]);
  const minOnlyMonths = useMemo(() => {
    if (!liabilities.length) return 0;
    let maxMonths = 0;
    liabilities.forEach((liability) => {
      const isZeroMin =
        (liability.minPaymentAmount || 0) <= 0 &&
        (liability.minPaymentPercentage || 0) <= 0 &&
        (liability.minPaymentFloor || 0) <= 0 &&
        !liability.minPaymentPlusInterest &&
        !liability.minPaymentPlusFees;
      if (isZeroMin) return;
      const schedule = amortizationSchedules[liability.id];
      if (!schedule?.timeline?.length) return;
      const lastMonth = schedule.timeline.reduce((acc, row) => {
        if (row.remainingBalance > 0.01 && row.month > acc) return row.month;
        return acc;
      }, 0);
      if (lastMonth > maxMonths) maxMonths = lastMonth;
    });
    return maxMonths;
  }, [amortizationSchedules, liabilities]);
  const minOnlyProjection = useMemo<PayoffResult | null>(() => {
    if (!liabilities.length) return null;
    const scheduleEntries = liabilities.map((liability) => ({
      id: liability.id,
      name: liability.name,
      timeline: amortizationSchedules[liability.id]?.timeline || [],
      isZeroMin:
        (liability.minPaymentAmount || 0) <= 0 &&
        (liability.minPaymentPercentage || 0) <= 0 &&
        (liability.minPaymentFloor || 0) <= 0 &&
        !liability.minPaymentPlusInterest &&
        !liability.minPaymentPlusFees,
    }));
    const maxMonth = scheduleEntries.reduce((max, entry) => {
      if (entry.isZeroMin) return max;
      return entry.timeline.reduce((innerMax, row) => (row.month > innerMax ? row.month : innerMax), max);
    }, 0);
    if (!maxMonth) return null;

    const prevRemaining: Record<string, number> = {};
    liabilities.forEach((liability) => {
      prevRemaining[liability.id] = scheduleBalanceById[liability.id] ?? liability.balance;
    });

    let totalInterestPaid = 0;
    const timeline = [];
    for (let month = 1; month <= maxMonth; month += 1) {
      let totalBalance = 0;
      let liabilitiesRemaining = 0;
      let nonZeroMinRemaining = 0;
      const paidOffNames: string[] = [];
      const breakdown = scheduleEntries.map((entry) => {
        const row = entry.timeline.find((item) => item.month === month);
        const remaining = Math.max(0, row?.remainingBalance ?? prevRemaining[entry.id] ?? 0);
        const interest = row?.interest || 0;
        const payment = row?.payment || 0;

        totalBalance += remaining;
        totalInterestPaid += interest;

        const previous = prevRemaining[entry.id] ?? remaining;
        if (previous > 0.01 && remaining <= 0.01) {
          paidOffNames.push(entry.name);
        }
        prevRemaining[entry.id] = remaining;
        if (remaining > 0.01) {
          liabilitiesRemaining += 1;
          if (!entry.isZeroMin) nonZeroMinRemaining += 1;
        }

        return {
          liabilityId: entry.id,
          name: entry.name,
          interest,
          payment,
          balance: remaining,
        };
      });

      timeline.push({
        month,
        totalBalance,
        totalInterestPaid,
        liabilitiesRemaining,
        paidOffNames,
        breakdown,
      });

      if (nonZeroMinRemaining === 0) break;
    }

    return {
      strategy: StrategyType.CUSTOM,
      monthsToFreedom: timeline.length,
      totalInterestPaid,
      timeline,
    };
  }, [amortizationSchedules, liabilities, scheduleBalanceById]);
  const displayProjection =
    savedPlan?.timeline?.length ? safeProjection : (minOnlyProjection || safeProjection);

  const defaultPlanLabel = STRATEGY_LABELS[StrategyType.AVALANCHE];
  const planLabel = useMemo(() => {
    if (!savedPlan) return defaultPlanLabel;
    return savedPlan.strategyLabel || STRATEGY_LABELS[savedPlan.strategy as StrategyType] || defaultPlanLabel;
  }, [savedPlan, defaultPlanLabel]);
  const availableForLabel = savedPlan ? planLabel : 'Snowball/Avalanche';
  const planSavedAt = savedPlan?.savedAt ? new Date(savedPlan.savedAt) : null;

  const formatCurrency = (val: number, opts?: Intl.NumberFormatOptions) => {
    return `${currencySymbol}${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0, ...opts })}`;
  };
  const currentMonthLabel = now.toLocaleDateString(undefined, { month: 'long' });

  const StatCard = ({ title, value, subValue, loading }: any) => (
    <div>
      <div>
        <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
        {loading ? (
          <div className="mt-3 h-8 w-32 rounded bg-slate-100 animate-pulse" />
        ) : (
          <h3 className="text-3xl font-bold text-slate-900 mt-2">{value}</h3>
        )}
        {subValue && <p className="text-xs text-slate-400 mt-1">{subValue}</p>}
      </div>
    </div>
  );

  if (liabilities.length === 0 && expenses.length === 0 && assets.length === 0 && incomes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20">
        <div className="bg-indigo-50 p-6 rounded-full mb-6">
          <TrendingUp size={48} className="text-indigo-600" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-4">Welcome to BacktoBlack!</h2>
        <p className="text-slate-600 max-w-md mb-8">
          You haven't added any financial info yet. Let's get started by adding your loans, expenses, or assets to see your path to freedom.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
            <Link to="/liabilities" className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-full font-medium transition-all shadow-lg hover:shadow-indigo-500/30 flex items-center">
                Add {liabilityLabel} <ArrowRight className="ml-2" size={18} />
            </Link>
             <Link to="/expenses" className="bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-6 py-3 rounded-full font-medium transition-all flex items-center">
                Add {expensePlural}
            </Link>
            <Link to="/assets" className="bg-white text-green-700 border border-green-200 hover:bg-green-50 px-6 py-3 rounded-full font-medium transition-all flex items-center">
                Add Assets
            </Link>
            <Link to="/income" className="bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 px-6 py-3 rounded-full font-medium transition-all flex items-center">
                Add Income
            </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-indigo-500 text-white rounded-lg">
          <LayoutDashboard size={20} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link to="/assets" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <StatCard 
            title="Net Worth"
            value={`${currencySymbol}${netWorth.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} 
            loading={!balancesReady}
          />
        </Link>
        <Link to="/liabilities" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <StatCard 
            title={`Total ${liabilityLabel}`}
            value={`${currencySymbol}${totalLiability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
            loading={!balancesReady}
          />
        </Link>
        <Link to="/liabilities" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <StatCard 
            title="Credit Available"
            value={formatCurrency(creditAvailable, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            loading={!balancesReady}
          />
        </Link>
        <Link to="/strategy" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <StatCard 
            title={`${liabilityLabel} Free Date`}
            value={
              (savedPlan?.timeline?.length ? scheduleMonths : (minOnlyMonths || safeProjection.monthsToFreedom)) === 0
                ? `${liabilityLabel} Free!`
                : `${Math.floor((savedPlan?.timeline?.length ? scheduleMonths : (minOnlyMonths || safeProjection.monthsToFreedom)) / 12)}y ${(savedPlan?.timeline?.length ? scheduleMonths : (minOnlyMonths || safeProjection.monthsToFreedom)) % 12}m`
            }
            loading={!balancesReady}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Payoff Projection</h3>
              {savedPlan && (
                <p className="text-xs text-slate-500">
                  Using saved schedule{planSavedAt ? ` from ${planSavedAt.toLocaleDateString()}` : ''}.
                </p>
              )}
            </div>
            <Link to="/strategy" className="text-indigo-600 text-sm font-medium hover:text-indigo-800">Compare Strategies &rarr;</Link>
          </div>
          <div className="h-72 w-full min-w-[240px]" ref={payoffChartRef}>
            {!balancesReady && (
              <div className="h-72 w-full rounded-lg bg-slate-100 animate-pulse" />
            )}
            {balancesReady && chartsReady && payoffSize.width > 0 && payoffSize.height > 0 && (
              <AreaChart
                width={Math.max(200, payoffSize.width)}
                height={Math.max(200, payoffSize.height)}
                data={displayProjection.timeline}
              >
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="month" 
                  tickLine={false} 
                  axisLine={false} 
                  tick={{ fill: '#94a3b8', fontSize: 12 }}
                  tickFormatter={(val) => `M${val}`}
                />
                <YAxis 
                  tickLine={false} 
                  axisLine={false} 
                  tick={{ fill: '#94a3b8', fontSize: 12 }}
                  tickFormatter={(val) => `$${val/1000}k`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => [`$${value.toFixed(0)}`, 'Balance']}
                />
                <Area 
                  type="monotone" 
                  dataKey="totalBalance" 
                  stroke="#6366f1" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorBalance)" 
                />
              </AreaChart>
            )}
          </div>
        </div>

        <div className="space-y-6">


          {/* Quick Summary */}
          <div className={`bg-white p-6 rounded-xl shadow-sm border ${isDeficit ? 'border-red-200' : 'border-slate-100'} space-y-4`}>
            <div className="flex items-center justify-between">
              <Link to="/reports">
              <div className="flex items-center space-x-2">
                  <h3 className="text-lg font-bold text-slate-900">{currentMonthLabel} Breakdown</h3><p className="ml-1 text-xs text-indigo-400 hover:text-indigo-600"><ArrowRight size={10}/></p>
              </div>
              </Link>
            </div>
            {!balancesReady ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="h-4 w-24 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 w-20 rounded bg-slate-100 animate-pulse" />
                </div>
                <div className="flex justify-between items-center">
                  <div className="h-4 w-28 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 w-20 rounded bg-slate-100 animate-pulse" />
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <div className="h-4 w-36 rounded bg-slate-100 animate-pulse" />
                  <div className="h-4 w-20 rounded bg-slate-100 animate-pulse" />
                </div>
                <div className="pt-1">
                  <div className="flex justify-between items-end mb-1">
                    <div className="h-4 w-32 rounded bg-slate-100 animate-pulse" />
                    <div className="h-6 w-24 rounded bg-slate-100 animate-pulse" />
                  </div>
                  <div className="h-3 w-32 rounded bg-slate-100 animate-pulse ml-auto" />
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <Link to="/income">
                      <span className="text-slate-500 flex items-center">
                        Income <p className="ml-1 text-xs text-indigo-400 hover:text-indigo-600"><ArrowRight size={10}/></p>
                      </span>
                    </Link>
                    <span className="font-bold text-emerald-600">+{formatCurrency(currentMonthIncome, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <Link to="/expenses">
                      <span className="text-slate-500 flex items-center">
                        {expensePlural} <p className="ml-1 text-xs text-indigo-400 hover:text-indigo-600"><ArrowRight size={10}/></p>
                      </span>
                    </Link>
                    <span className="font-medium text-slate-700">-{formatCurrency(totalMonthlyExpenses)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm pb-3 border-b border-slate-100">
                    <Link to="/liabilities">
                      <span className="text-slate-500 flex items-center">
                        {liabilityLabel} Minimums <p className="ml-1 text-xs text-indigo-400 hover:text-indigo-600"><ArrowRight size={10}/></p>
                      </span>
                    </Link>
                    <span className="font-medium text-slate-700">-{formatCurrency(currentMonthLiabilityMins)}</span>
                  </div>
                </div>
                <div className="pt-1">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-sm font-bold text-slate-800">Leftover ({currentMonthLabel})</span>
                    <span className={`text-2xl font-bold ${isDeficit ? 'text-red-600' : 'text-indigo-600'}`}>
                      {freeCashFlow >= 0 ? '+' : ''}{formatCurrency(freeCashFlow)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 text-right">Available for {availableForLabel}</p>
                  {isDeficit && (
                    <div className="mt-3 bg-red-50 p-3 rounded-lg flex items-start space-x-2 border border-red-100">
                      <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-700 leading-tight">
                        Income is lower than expenses and minimums. Reduce spending or increase income.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
            
            
            {/* Quick Stats: Assets vs Liabilities */}
            {assets.length > 0 && liabilities.length > 0 && (
               <div className="mt-8 pt-6 border-t border-slate-100">
                  <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Health Check</h4>
                  {!balancesReady ? (
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
                        <div className="flex-1 h-2 rounded bg-slate-100 animate-pulse" />
                        <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
                      </div>
                      <div className="flex items-center space-x-2 text-sm">
                        <div className="h-4 w-20 rounded bg-slate-100 animate-pulse" />
                        <div className="flex-1 h-2 rounded bg-slate-100 animate-pulse" />
                        <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center space-x-2 text-sm">
                          <span className="w-16 text-slate-500">Assets</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-2">
                              <div 
                                className="bg-green-500 h-2 rounded-full" 
                                style={{ width: `${Math.min(100, (totalAssets / (totalAssets + totalLiability)) * 100)}%` }}
                              ></div>
                          </div>
                          <span className="text-xs font-bold text-slate-900">{currencySymbol}{totalAssets.toLocaleString(undefined, {notation: 'compact'})}</span>
                      </div>
                       <div className="flex items-center space-x-2 text-sm mt-2">
                          <span className="w-16 text-slate-500">{liabilityPlural}</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-2">
                              <div 
                                className="bg-red-500 h-2 rounded-full" 
                                style={{ width: `${Math.min(100, (totalLiability / (totalAssets + totalLiability)) * 100)}%` }}
                              ></div>
                          </div>
                          <span className="text-xs font-bold text-slate-900">{currencySymbol}{totalLiability.toLocaleString(undefined, {notation: 'compact'})}</span>
                      </div>
                    </>
                  )}
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
