import React, { useState, useEffect, useMemo } from 'react';
import { Liability, Expense, Asset, StrategyType, STRATEGY_LABELS, UserSettings, IncomeSource, BudgetSchedule } from '../types';
import { calculatePayoff, getMinPayment, calculateMonthlyIncome } from '../server/liabilityAlgorithms';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, Calendar, Wallet, LayoutDashboard, DollarSign, Receipt, Landmark, Calculator, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { dbAPI } from '../server/db';

interface DashboardProps {
  liabilities: Liability[];
  expenses: Expense[];
  assets: Asset[];
  incomes?: IncomeSource[];
  monthlyBudget: number; // This is now the Calculated Surplus (Snowball)
  userSettings?: UserSettings;
}

const Dashboard: React.FC<DashboardProps> = ({ liabilities, expenses, assets, incomes = [], monthlyBudget, userSettings }) => {
  const [showAnnual, setShowAnnual] = useState(false);
  const [chartsReady, setChartsReady] = useState(false);
  const [savedPlan, setSavedPlan] = useState<BudgetSchedule | null>(null);

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
    // Delay chart render until after mount to avoid ResponsiveContainer measuring at -1/-1
    setChartsReady(true);
  }, []);
  const simpleTerms = userSettings?.useSimpleTerms;
  const liabilityLabel = simpleTerms ? 'Loan' : 'Liability';
  const liabilityPlural = simpleTerms ? 'Loans' : 'Liabilities';
  const expenseLabel = simpleTerms ? 'Bill' : 'Expense';
  const expensePlural = simpleTerms ? 'Bills' : 'Expenses';
  const currencySymbol = userSettings?.currencySymbol || '$';
  const totalLiability = liabilities.reduce((sum, d) => sum + d.balance, 0);
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
  const totalIncome = calculateMonthlyIncome(budgetedIncomes);
  const totalPartnerIncome = calculateMonthlyIncome(
    budgetedIncomes.filter((i) => i.isPartner)
  );
  const totalMyIncome = totalIncome - totalPartnerIncome;
  // const totalAnnualIncome = totalIncome * 12;
  // const totalAnnualPartnerIncome = totalPartnerIncome * 12;
  // const totalAnnualMyIncome = totalMyIncome * 12;
  
  // Total Monthly Outflow (Liabilities + Expenses + Extra)
  // This essentially reconstructs the Total Income if budget was derived correctly
  const totalCommitment = totalMinPayment + totalMonthlyExpenses + monthlyBudget;
  const freeCashFlow = totalIncome - totalMonthlyExpenses - totalMinPayment;
  const isDeficit = freeCashFlow < 0;

  // Use saved plan if present, else default Avalanche projection
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

  const scaleAmount = (val: number) => showAnnual ? val * 12 : val;
  const formatCurrency = (val: number, opts?: Intl.NumberFormatOptions) => {
    return `${currencySymbol}${scaleAmount(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0, ...opts })}`;
  };
  const periodLabel = showAnnual ? 'Annual' : 'Monthly';
  
  const StatCard = ({ title, value, icon: Icon, color, subValue }: any) => (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-start justify-between">
      <div>
        <p className="text-slate-500 text-sm font-medium mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
        {subValue && <p className="text-xs text-slate-400 mt-1">{subValue}</p>}
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon size={24} className="text-white" />
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
        <div className="flex items-center space-x-2 ml-auto text-sm">
          <span className={`font-medium ${!showAnnual ? 'text-indigo-600' : ''}`}>Monthly</span>
          <button
            type="button"
            onClick={() => setShowAnnual(!showAnnual)}
            className={`w-12 h-6 rounded-full border transition-colors flex items-center ${showAnnual ? 'bg-indigo-600 border-indigo-600 justify-end' : 'bg-slate-200 border-slate-300 justify-start'}`}
            aria-label="Toggle annualized view"
          >
            <span className="w-5 h-5 bg-white rounded-full shadow-sm"></span>
          </button>
          <span className={`font-medium ${showAnnual ? 'text-indigo-600' : ''}`}>Annual</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard 
          title="Net Worth" 
          value={`${currencySymbol}${netWorth.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} 
          subValue={totalAssets > 0 ? `${currencySymbol}${totalAssets.toLocaleString()} Assets` : undefined}
          icon={Landmark} 
          color={netWorth >= 0 ? "bg-green-500" : "bg-orange-500"} 
        />
        <StatCard 
          title={`Total ${liabilityLabel}`} 
          value={`${currencySymbol}${totalLiability.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} 
          icon={DollarSign} 
          color="bg-red-500" 
        />
        <StatCard 
          title={`${liabilityLabel} Free Date`} 
          value={projection.monthsToFreedom === 0 ? `${liabilityLabel} Free!` : `${Math.floor(projection.monthsToFreedom / 12)}y ${projection.monthsToFreedom % 12}m`} 
          icon={Calendar} 
          color="bg-indigo-500" 
        />
        <StatCard 
          title={`${periodLabel} Income`} 
          value={formatCurrency(totalIncome)} 
          subValue={`You: ${formatCurrency(totalMyIncome)} • Partner: ${formatCurrency(totalPartnerIncome)}`} 
          icon={Wallet} 
          color="bg-emerald-500" 
        />
        <StatCard 
          title={`${periodLabel} ${expensePlural}`} 
          value={formatCurrency(totalMonthlyExpenses)} 
          icon={Receipt} 
          color="bg-purple-500" 
        />
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
          <div className="h-72 w-full min-w-[240px]">
            {chartsReady && (
              <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
                <AreaChart data={projection.timeline}>
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
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-6">


          {/* Quick Summary */}
          <div className={`bg-white p-6 rounded-xl shadow-sm border ${isDeficit ? 'border-red-200' : 'border-slate-100'} space-y-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Calculator size={18} className="text-slate-500" />
                <h3 className="text-lg font-bold text-slate-900">{periodLabel} Breakdown</h3>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 flex items-center">
                  Total Monthly Income <Link to="/income" className="ml-1 text-xs text-indigo-400 hover:text-indigo-600"><ArrowRight size={10}/></Link>
                </span>
                <span className="font-bold text-emerald-600">+{formatCurrency(totalIncome, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500 flex items-center">
                  {expensePlural} <Link to="/expenses" className="ml-1 text-xs text-indigo-400 hover:text-indigo-600"><ArrowRight size={10}/></Link>
                </span>
                <span className="font-medium text-slate-700">-{formatCurrency(totalMonthlyExpenses)}</span>
              </div>
              <div className="flex justify-between items-center text-sm pb-3 border-b border-slate-100">
                <span className="text-slate-500 flex items-center">
                  {liabilityLabel} Minimums <Link to="/liabilities" className="ml-1 text-xs text-indigo-400 hover:text-indigo-600"><ArrowRight size={10}/></Link>
                </span>
                <span className="font-medium text-slate-700">-{formatCurrency(totalMinPayment)}</span>
              </div>
            </div>
            <div className="pt-1">
              <div className="flex justify-between items-end mb-1">
                <span className="text-sm font-bold text-slate-800">Leftover ({periodLabel})</span>
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
