import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Liability, Expense, Asset, StrategyType, STRATEGY_LABELS, UserSettings, IncomeSource, BudgetSchedule } from '../types';
import { calculatePayoff, getMinPayment, calculateMonthlyIncomeByMode } from '../server/liabilityAlgorithms';
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
  const totalLiability = liabilities.reduce((sum, d) => sum + d.balance, 0);
  const creditLimitLiabilities = liabilities.filter(
    (liability) => (liability.creditLimit || 0) > 0
  );
  const totalCreditLimit = creditLimitLiabilities.reduce(
    (sum, liability) => sum + (liability.creditLimit || 0),
    0
  );
  const totalCreditBalance = creditLimitLiabilities.reduce(
    (sum, liability) => sum + liability.balance,
    0
  );
  const creditAvailable = totalCreditLimit - totalCreditBalance;
  const totalMinPayment = liabilities.reduce((sum, d) => {
    const monthlyInterest = d.balance * (d.interestRate / 100 / 12);
    const estFee = d.isFeeMonthly ? (d.annualFee / 12) : 0;
    return sum + getMinPayment(d, d.balance, monthlyInterest, estFee);
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
      const monthlyInterest = l.balance * (l.interestRate / 100 / 12);
      const estFee = l.isFeeMonthly ? l.annualFee / 12 : 0;
      return sum + getMinPayment(l, l.balance, monthlyInterest, estFee);
    }, 0);
  }, [activeLiabilities]);
  const currentMonthIncome = useMemo(() => {
    if (budgetedIncomes.length === 0) return 0;
    const periodStart = new Date(currentYear, currentMonthIndex, 1);
    const periodEnd = new Date(currentYear, currentMonthIndex + 1, 0);
    const startBoundary =
      budgetStartDate && budgetStartDate.getTime() > periodStart.getTime()
        ? budgetStartDate
        : periodStart;

    const getPayDates = (source: IncomeSource, startDate: Date, endDate: Date): Date[] => {
      if (!source.nextPayDate) return [];
      const [y, m, d] = source.nextPayDate.split('-').map(Number);
      const seed = new Date(y, m - 1, d);
      if (Number.isNaN(seed.getTime())) return [];

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
          case 'SEMI_MONTHLY':
            prev.setDate(prev.getDate() - 15);
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
          case 'SEMI_MONTHLY':
            current.setDate(current.getDate() + 15);
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

  const projection = useMemo(() => {
    if (savedPlan?.timeline?.length) {
      const last = savedPlan.timeline[savedPlan.timeline.length - 1];
      return {
        strategy: savedPlan.strategy as StrategyType,
        monthsToFreedom: last?.month ?? savedPlan.timeline.length,
        totalInterestPaid: last?.totalInterestPaid ?? 0,
        timeline: savedPlan.timeline,
      };
    }
    return calculatePayoff(liabilities, monthlyBudget, StrategyType.AVALANCHE);
  }, [liabilities, monthlyBudget, savedPlan]);

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

  const StatCard = ({ title, value, subValue }: any) => (
    <div>
      <div>
        <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
        <h3 className="text-3xl font-bold text-slate-900 mt-2">{value}</h3>
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
          />
        </Link>
        <Link to="/liabilities" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <StatCard 
            title={`Total ${liabilityLabel}`}
            value={`${currencySymbol}${totalLiability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} 
          />
        </Link>
        <Link to="/liabilities" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <StatCard 
            title="Credit Available"
            value={formatCurrency(creditAvailable, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          />
        </Link>
        <Link to="/strategy" className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <StatCard 
            title={`${liabilityLabel} Free Date`}
            value={projection.monthsToFreedom === 0 ? `${liabilityLabel} Free!` : `${Math.floor(projection.monthsToFreedom / 12)}y ${projection.monthsToFreedom % 12}m`} 
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
            {chartsReady && payoffSize.width > 0 && payoffSize.height > 0 && (
              <AreaChart
                width={Math.max(200, payoffSize.width)}
                height={Math.max(200, payoffSize.height)}
                data={projection.timeline}
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
            
            
            {/* Quick Stats: Assets vs Liabilities */}
            {assets.length > 0 && liabilities.length > 0 && (
               <div className="mt-8 pt-6 border-t border-slate-100">
                  <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Health Check</h4>
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
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
