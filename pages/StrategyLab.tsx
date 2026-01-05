
import React, { useState, useMemo, useEffect } from 'react';
import { Liability, StrategyType, STRATEGY_LABELS, BudgetSchedule } from '../types';
import { calculatePayoff, calculateIndividualAmortization, getMinPayment } from '../server/liabilityAlgorithms';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, Legend, LineChart, Line 
} from 'recharts';
import { ChevronDown, Check, ArrowRight, Info, Layers, PieChart, BarChart2, Table, CreditCard, Percent, Calendar, AlertTriangle, TrendingUp, DollarSign, Landmark } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dbAPI } from '../server/db';

interface StrategyLabProps {
  liabilities: Liability[];
  monthlyBudget: number;
}

const COLORS: Record<StrategyType, string> = {
  [StrategyType.SNOWBALL]: '#3b82f6', // Blue
  [StrategyType.AVALANCHE]: '#10b981', // Emerald
  [StrategyType.HYBRID]: '#8b5cf6', // Violet
  [StrategyType.CFI]: '#f59e0b', // Amber
  [StrategyType.HIGHEST_PAYMENT]: '#ec4899', // Pink
  [StrategyType.HIGHEST_UTILIZATION]: '#ef4444', // Red
  [StrategyType.HIGHEST_INTEREST_AMT]: '#06b6d4', // Cyan
  [StrategyType.CUSTOM]: '#6366f1', // Indigo
};

const StrategyLab: React.FC<StrategyLabProps> = ({ liabilities, monthlyBudget }) => {
  const [activeTab, setActiveTab] = useState<'simulate' | 'compare' | 'schedule' | 'balanceTransfer'>('schedule');
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>(StrategyType.AVALANCHE);
  const [customOrderMap, setCustomOrderMap] = useState<Record<string, number>>({});
  const [chartsReady, setChartsReady] = useState(false);
  const [scheduleSavedAt, setScheduleSavedAt] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [hasJustSentSchedule, setHasJustSentSchedule] = useState(false);
  const [showAnchorModal, setShowAnchorModal] = useState(false);
  
  // For Comparison Mode
  const [compareSelection, setCompareSelection] = useState<StrategyType[]>([
    StrategyType.SNOWBALL, 
    StrategyType.AVALANCHE
  ]);

  // For Balance Transfer / Consolidation Mode
  const [scenarioType, setScenarioType] = useState<'TRANSFER' | 'CONSOLIDATION'>('TRANSFER');
  const [btSettings, setBtSettings] = useState({
    feePercent: 3,
    introDuration: 18,
    introApr: 0,
    limit: 0
  });
  const [selectedBtLiabilities, setSelectedBtLiabilities] = useState<string[]>([]);

  // --- Calculations ---

  useEffect(() => {
    setCustomOrderMap(() => {
      const next: Record<string, number> = {};
      liabilities.forEach((l, idx) => {
        next[l.id] = l.customOrder ?? idx + 1;
      });
      return next;
    });
  }, [liabilities]);

  useEffect(() => {
    // Avoid ResponsiveContainer measuring at -1/-1 before mount
    setChartsReady(true);
  }, []);

  useEffect(() => {
    setCompareSelection(prev => {
      if (prev.includes(selectedStrategy)) return prev;
      return [...prev, selectedStrategy];
    });
  }, [selectedStrategy]);
  useEffect(() => {
    let active = true;
    const loadSchedule = async () => {
      try {
        const remote = await dbAPI.getBudgetSchedule();
        if (!active) return;
        setScheduleSavedAt(remote?.schedule?.savedAt || null);
        if (remote?.schedule?.savedAt) {
          const d = new Date(remote.schedule.savedAt);
          if (!Number.isNaN(d.getTime())) {
            setAnchorDate(d.toISOString().split('T')[0]);
            if (remote.schedule.strategy && STRATEGY_LABELS[remote.schedule.strategy]) {
              setSelectedStrategy(remote.schedule.strategy as StrategyType);
            }
          }
        }
      } catch {
        if (active) {
          setScheduleSavedAt(null);
        }
      }
    };
    loadSchedule();
    return () => {
      active = false;
    };
  }, []);

  const orderedLiabilities = useMemo(() => {
    return liabilities.map((l, idx) => ({
      ...l,
      customOrder: customOrderMap[l.id] ?? l.customOrder ?? idx + 1,
    }));
  }, [liabilities, customOrderMap]);

  // Single Simulation Result
  const singleResult = useMemo(() => {
    return calculatePayoff(orderedLiabilities, monthlyBudget, selectedStrategy);
  }, [orderedLiabilities, monthlyBudget, selectedStrategy]);

  // Comparison Results (Calculate all for data table)
  const allStrategies = Object.values(StrategyType);
  const comparisonResults = useMemo(() => {
    return allStrategies.map(strat => {
      const res = calculatePayoff(orderedLiabilities, monthlyBudget, strat);
      return {
        strategy: strat,
        label: STRATEGY_LABELS[strat],
        interest: res.totalInterestPaid,
        months: res.monthsToFreedom,
        timeline: res.timeline,
        color: COLORS[strat]
      };
    });
  }, [orderedLiabilities, monthlyBudget]);

  // Best/Worst for stats
  const bestInterest = comparisonResults.reduce((min, cur) => cur.interest < min.interest ? cur : min, comparisonResults[0]);
  const bestTime = comparisonResults.reduce((min, cur) => cur.months < min.months ? cur : min, comparisonResults[0]);

  // Chart Data Construction for Comparison
  const comparisonChartData = useMemo(() => {
    const activeComparisons = comparisonResults.filter(r => compareSelection.includes(r.strategy));
    if (activeComparisons.length === 0) return [];

    const maxMonths = Math.max(...activeComparisons.map(r => r.months));
    const initialBalance = liabilities.reduce((sum, d) => sum + d.balance, 0);

    const data = [];
    // Include Month 0
    const point0: any = { month: 0 };
    activeComparisons.forEach(r => point0[r.label] = initialBalance);
    data.push(point0);

    for (let i = 1; i <= maxMonths; i++) {
      const point: any = { month: i };
      activeComparisons.forEach(r => {
        // Find balance at month i. If i > timeline, balance is 0.
        const entry = r.timeline.find(t => t.month === i);
        point[r.label] = entry ? entry.totalBalance : 0;
      });
      data.push(point);
    }
    return data;
  }, [comparisonResults, compareSelection, liabilities]);

  // Balance Transfer Analysis
  const btAnalysis = useMemo(() => {
    const targets = liabilities.filter(d => selectedBtLiabilities.includes(d.id));
    const totalTransferBalance = targets.reduce((sum, d) => sum + d.balance, 0);
    const transferFee = totalTransferBalance * (btSettings.feePercent / 100);
    const newBalance = totalTransferBalance + transferFee;
    
    // 1. Calculate Baseline Interest (If we did nothing) over the duration
    let baselineInterest = 0;
    let currentMinPaymentSum = 0;

    targets.forEach(d => {
        // Calculate min payment for this liability
        const monthlyInt = d.balance * (d.interestRate / 100 / 12);
        const estFee = d.isFeeMonthly ? (d.annualFee / 12) : 0;
        const min = getMinPayment(d, d.balance, monthlyInt, estFee);
        currentMinPaymentSum += min;

        // Get projection
        const amo = calculateIndividualAmortization(d);
        // Sum interest for the promo duration
        const relevantRows = amo.timeline.filter(r => r.month <= btSettings.introDuration);
        const interestInPeriod = relevantRows.reduce((sum, r) => sum + r.interest, 0);
        
        // If liability is paid off before promo ends, include remaining interest (which is 0)
        baselineInterest += interestInPeriod;
    });

    // 2. Calculate New Scenario Interest
    // Create virtual liability
    const virtualLiability: Liability = {
        id: 'temp-bt',
        name: 'Balance Transfer',
        balance: newBalance,
        interestRate: btSettings.introApr,
        minPaymentAmount: currentMinPaymentSum, // Assume we keep paying the same total volume
        paymentFrequency: 'MONTHLY',
        minPaymentPercentage: 0,
        minPaymentPlusInterest: false,
        minPaymentPlusFees: false,
        minPaymentFloor: 0,
        annualFee: 0,
        isFeeMonthly: false,
        feeMonth: 1,
        dueDate: 1,
        startingBalance: newBalance,
        startDate: new Date().toISOString()
    };

    const newAmo = calculateIndividualAmortization(virtualLiability);
    const newRelevantRows = newAmo.timeline.filter(r => r.month <= btSettings.introDuration);
    const newInterest = newRelevantRows.reduce((sum, r) => sum + r.interest, 0);
    
    const balanceAfterPromo = newRelevantRows.length > 0 
      ? newRelevantRows[newRelevantRows.length - 1].remainingBalance 
      : 0;

    const netSavings = baselineInterest - newInterest - transferFee;
    
    // Payoff Goal (to clear in duration)
    // Simple PMT-like calculation or division if 0%
    let requiredMonthlyPayment = 0;
    if (btSettings.introApr === 0) {
        requiredMonthlyPayment = newBalance / btSettings.introDuration;
    } else {
         // Amortization formula: P * (r(1+r)^n) / ((1+r)^n - 1)
         const r = btSettings.introApr / 100 / 12;
         const n = btSettings.introDuration;
         if (r === 0) {
            requiredMonthlyPayment = newBalance / n;
         } else {
            requiredMonthlyPayment = newBalance * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
         }
    }

    return {
        totalTransferBalance,
        transferFee,
        newBalance,
        baselineInterest,
        newInterest,
        netSavings,
        currentMinPaymentSum,
        requiredMonthlyPayment,
        balanceAfterPromo
    };

  }, [liabilities, selectedBtLiabilities, btSettings]);

  // --- Handlers ---
  const toggleComparisonStrategy = (s: StrategyType) => {
    setCompareSelection(prev => {
      const next = prev.includes(s) ? prev.filter(i => i !== s) : [...prev, s];
      // Keep the active selected strategy always included
      if (!next.includes(selectedStrategy)) {
        next.push(selectedStrategy);
      }
      return next;
    });
  };
  
  const toggleBtLiability = (id: string) => {
    setSelectedBtLiabilities(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);
  };
  const handleCustomOrderChange = (id: string, value: number) => {
    setCustomOrderMap(prev => ({ ...prev, [id]: value }));
  };

  const toggleScenario = (type: 'TRANSFER' | 'CONSOLIDATION') => {
    setScenarioType(type);
    if (type === 'TRANSFER') {
      setBtSettings(prev => ({ ...prev, feePercent: 3, introApr: 0, introDuration: 18 }));
    } else {
      setBtSettings(prev => ({ ...prev, feePercent: 0, introApr: 10, introDuration: 36 }));
    }
  };

  const handleConfirmSchedule = async () => {
    await saveScheduleToBudget();
    setShowAnchorModal(false);
  };

  const saveScheduleToBudget = async () => {
    const anchorIso =
      anchorDate && !Number.isNaN(new Date(anchorDate).getTime())
        ? `${anchorDate}T12:00:00.000Z` // use midday UTC to avoid timezone shifting the date back
        : new Date().toISOString();
    const payload: BudgetSchedule = {
      strategy: selectedStrategy,
      strategyLabel: STRATEGY_LABELS[selectedStrategy],
      savedAt: anchorIso,
      monthlyBudget,
      timeline: singleResult.timeline
    };
    try {
      const res = await dbAPI.saveBudgetSchedule(payload);
      const stored = (res as any)?.schedule || payload;
      setScheduleSavedAt(stored.savedAt || payload.savedAt);
      if (stored.savedAt) {
        const d = new Date(stored.savedAt);
        if (!Number.isNaN(d.getTime())) {
          setAnchorDate(d.toISOString().split('T')[0]);
        }
      }
      setHasJustSentSchedule(true);
    } catch {
      // keep local state untouched on failure
    }
  };

  if (liabilities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-white rounded-xl shadow-sm border border-slate-100 p-8 text-center">
        <div className="bg-slate-100 p-4 rounded-full mb-4">
          <BarChart2 size={32} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">No Liabilities to Analyze</h3>
        <p className="text-slate-500 mb-6 max-w-sm">Add your current liabilities to unlock powerful payoff strategies and comparisons.</p>
        <Link to="/liabilities" className="text-indigo-600 font-medium hover:text-indigo-800 flex items-center">
          Go to Liabilities <ArrowRight size={16} className="ml-1" />
        </Link>
      </div>
    );
  }

  const StrategySelector = () => (
    <div className="w-full md:w-1/3">
      <label className="block text-sm font-medium text-slate-700 mb-2">Strategy</label>
      <div className="relative">
        <select 
          value={selectedStrategy}
          onChange={(e) => setSelectedStrategy(e.target.value as StrategyType)}
          className="w-full appearance-none bg-slate-50 border border-slate-300 text-slate-900 rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          {allStrategies.map((strat) => (
            <option key={strat} value={strat}>{STRATEGY_LABELS[strat]}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-3.5 text-slate-400 pointer-events-none" size={16} />
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:space-x-3 space-y-3 md:space-y-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-500 text-white rounded-lg">
              <PieChart size={20} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Strategy Lab
              </h1>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="bg-slate-100 p-1.5 rounded-lg flex space-x-1 overflow-x-auto max-w-full md:ml-auto">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`flex items-center space-x-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                activeTab === 'schedule' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table size={16} />
              <span>Schedule</span>
            </button>
            <button
              onClick={() => setActiveTab('compare')}
              className={`flex items-center space-x-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                activeTab === 'compare' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers size={16} />
              <span>Compare</span>
            </button>
            <button
              onClick={() => setActiveTab('balanceTransfer')}
              className={`flex items-center space-x-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                activeTab === 'balanceTransfer' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CreditCard size={16} />
              <span>Transfers</span>
            </button>
          </div>
        </div>

      {activeTab === 'compare' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Control Panel */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-900 mb-4 flex items-center">
                <Check size={18} className="mr-2 text-slate-400" />
                Select Strategies
              </h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                {allStrategies.map(strat => (
                  <label 
                    key={strat} 
                    className={`flex items-start p-3 rounded-lg border cursor-pointer transition-all ${
                      compareSelection.includes(strat) 
                        ? 'bg-indigo-50 border-indigo-200' 
                        : 'bg-white border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <input 
                      type="checkbox" 
                      className="mt-1 w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                      checked={compareSelection.includes(strat)}
                      onChange={() => toggleComparisonStrategy(strat)}
                    />
                    <div className="ml-3">
                      <span className={`block text-sm font-bold ${compareSelection.includes(strat) ? 'text-indigo-900' : 'text-slate-700'}`}>
                        {STRATEGY_LABELS[strat]}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {strat === StrategyType.SNOWBALL && "Smallest Balance First"}
                        {strat === StrategyType.AVALANCHE && "Highest Interest Rate First"}
                        {strat === StrategyType.CFI && "Optimizes Cash Flow"}
                        {strat === StrategyType.CUSTOM && "Your manual priority order"}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Comparison Chart */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col">
              <h3 className="font-bold text-slate-900 mb-6">Balance Over Time Comparison</h3>
              <div className="flex-1 min-h-[350px] min-w-[260px]">
                {chartsReady && (
                  <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={240}>
                    <LineChart data={comparisonChartData}>
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
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [`$${value.toFixed(0)}`]}
                      />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      {comparisonResults
                        .filter(r => compareSelection.includes(r.strategy))
                        .map(r => (
                          <Line 
                            key={r.strategy}
                            type="monotone" 
                            dataKey={r.label} 
                            stroke={r.color} 
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 6 }}
                          />
                        ))
                      }
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
             <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
               <h3 className="font-bold text-slate-900">Performance Matrix</h3>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-left border-collapse">
                 <thead>
                   <tr className="bg-white border-b border-slate-100">
                     <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Strategy</th>
                     <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Time to Freedom</th>
                     <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Total Interest</th>
                     <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Cost Difference</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100">
                   {comparisonResults.sort((a,b) => a.interest - b.interest).map((res) => {
                     const isSelected = compareSelection.includes(res.strategy);
                     const diff = res.interest - bestInterest.interest;
                     
                     return (
                       <tr key={res.strategy} className={`transition-colors ${isSelected ? 'bg-indigo-50/30' : 'hover:bg-slate-50'}`}>
                         <td className="px-6 py-4">
                           <div className="flex items-center">
                             <div className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: res.color }}></div>
                             <span className={`text-sm font-medium ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>
                               {res.label}
                               {res.strategy === bestInterest.strategy && (
                                 <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                   Cheapest
                                 </span>
                               )}
                               {res.strategy === bestTime.strategy && res.strategy !== bestInterest.strategy && (
                                 <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                   Fastest
                                 </span>
                               )}
                             </span>
                           </div>
                         </td>
                         <td className="px-6 py-4 text-right text-sm text-slate-700">
                           {Math.floor(res.months / 12)}y {res.months % 12}m
                         </td>
                         <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">
                           ${res.interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                         </td>
                         <td className="px-6 py-4 text-right text-sm text-slate-500">
                           {diff === 0 ? '-' : `+$${diff.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                         </td>
                       </tr>
                     );
                   })}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      )}

      {activeTab === 'balanceTransfer' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left: Input & Selection */}
            <div className="space-y-6">
               <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                  <div className="flex bg-slate-100 p-1 rounded-lg mb-4">
                    <button 
                      onClick={() => toggleScenario('TRANSFER')} 
                      className={`flex-1 flex items-center justify-center py-2 text-xs font-bold rounded-md transition-all ${scenarioType === 'TRANSFER' ? 'bg-white shadow text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      <CreditCard size={14} className="mr-1.5" /> Card Transfer
                    </button>
                    <button 
                      onClick={() => toggleScenario('CONSOLIDATION')} 
                      className={`flex-1 flex items-center justify-center py-2 text-xs font-bold rounded-md transition-all ${scenarioType === 'CONSOLIDATION' ? 'bg-white shadow text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      <Landmark size={14} className="mr-1.5" /> Loan / LOC
                    </button>
                  </div>

                  <h3 className="font-bold text-slate-900 mb-4 flex items-center">
                    {scenarioType === 'TRANSFER' ? 'Transfer Offer Details' : 'Loan / LOC Details'}
                  </h3>
                  <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-medium text-slate-500 mb-1">
                             {scenarioType === 'TRANSFER' ? 'Transfer Fee (%)' : 'Origination Fee (%)'}
                           </label>
                           <div className="relative">
                             <input 
                               type="number" step="0.1" min="0" max="100"
                               className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                               value={btSettings.feePercent}
                               onChange={e => setBtSettings({...btSettings, feePercent: parseFloat(e.target.value)})}
                             />
                             <Percent size={14} className="absolute left-3 top-2.5 text-slate-400" />
                           </div>
                        </div>
                        <div>
                           <label className="block text-xs font-medium text-slate-500 mb-1">
                             {scenarioType === 'TRANSFER' ? 'Intro APR (%)' : 'Interest Rate (%)'}
                           </label>
                           <div className="relative">
                             <input 
                               type="number" step="0.1" min="0" max="100"
                               className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                               value={btSettings.introApr}
                               onChange={e => setBtSettings({...btSettings, introApr: parseFloat(e.target.value)})}
                             />
                             <Percent size={14} className="absolute left-3 top-2.5 text-slate-400" />
                           </div>
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-medium text-slate-500 mb-1">
                             {scenarioType === 'TRANSFER' ? 'Promo Duration (Mo)' : 'Loan Term (Mo)'}
                           </label>
                           <div className="relative">
                             <input 
                               type="number" step="1" min="1" max="120"
                               className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                               value={btSettings.introDuration}
                               onChange={e => setBtSettings({...btSettings, introDuration: parseFloat(e.target.value)})}
                             />
                             <Calendar size={14} className="absolute left-3 top-2.5 text-slate-400" />
                           </div>
                        </div>
                        <div>
                           <label className="block text-xs font-medium text-slate-500 mb-1">Limit (Optional)</label>
                           <div className="relative">
                             <input 
                               type="number" step="100" min="0"
                               className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                               placeholder="No Limit"
                               value={btSettings.limit || ''}
                               onChange={e => setBtSettings({...btSettings, limit: parseFloat(e.target.value)})}
                             />
                             <DollarSign size={14} className="absolute left-3 top-2.5 text-slate-400" />
                           </div>
                        </div>
                     </div>
                  </div>
               </div>

               <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col flex-1">
                  <h3 className="font-bold text-slate-900 mb-4">Liabilities to Move</h3>
                  <p className="text-xs text-slate-500 mb-3">Select higher interest liabilities to consolidate.</p>
                  
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                     {[...liabilities].sort((a,b) => b.interestRate - a.interestRate).map(liability => (
                        <label 
                          key={liability.id} 
                          className={`flex items-start p-3 rounded-lg border cursor-pointer transition-all ${
                             selectedBtLiabilities.includes(liability.id) 
                               ? 'bg-indigo-50 border-indigo-200' 
                               : 'bg-white border-slate-100 hover:border-slate-200'
                          }`}
                        >
                           <input 
                              type="checkbox" 
                              className="mt-1 w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                              checked={selectedBtLiabilities.includes(liability.id)}
                              onChange={() => toggleBtLiability(liability.id)}
                           />
                           <div className="ml-3 flex-1">
                              <div className="flex justify-between">
                                 <span className="text-sm font-bold text-slate-800">{liability.name}</span>
                                 <span className="text-sm font-medium text-slate-600">${liability.balance.toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between mt-1">
                                 <span className="text-xs text-red-500 font-medium">{liability.interestRate}% APR</span>
                              </div>
                           </div>
                        </label>
                     ))}
                  </div>
                  
                  {btSettings.limit > 0 && btAnalysis.totalTransferBalance > btSettings.limit && (
                     <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
                        <div className="text-xs text-red-700">
                           <strong>Over Limit:</strong> Selected ${btAnalysis.totalTransferBalance.toLocaleString()} but limit is ${btSettings.limit.toLocaleString()}.
                        </div>
                     </div>
                  )}
               </div>
            </div>

            {/* Right: Analysis & Results */}
            <div className="lg:col-span-2 space-y-6">
                
                {selectedBtLiabilities.length === 0 ? (
                    <div className="h-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                        <TrendingUp size={48} className="mb-4 opacity-50"/>
                        <p className="text-lg font-medium">Select liabilities to analyze savings</p>
                        <p className="text-sm mt-2">Choose liabilities on the left to simulate a transfer or consolidation.</p>
                    </div>
                ) : (
                    <>
                        {/* Key Metrics Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div className={`p-6 rounded-xl border shadow-sm ${btAnalysis.netSavings > 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                               <div className="flex items-center space-x-2 mb-2">
                                  {btAnalysis.netSavings > 0 
                                     ? <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-full"><TrendingUp size={16} /></div>
                                     : <div className="p-1.5 bg-red-100 text-red-600 rounded-full"><AlertTriangle size={16} /></div>
                                  }
                                  <span className={`text-sm font-bold uppercase tracking-wide ${btAnalysis.netSavings > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                    Interest Savings
                                  </span>
                               </div>
                               <p className={`text-3xl font-extrabold ${btAnalysis.netSavings > 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                                  {btAnalysis.netSavings > 0 ? '+' : ''}${Math.round(btAnalysis.netSavings).toLocaleString()}
                               </p>
                               <p className={`text-xs mt-2 ${btAnalysis.netSavings > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  Net savings over {btSettings.introDuration} months
                               </p>
                           </div>

                           <div className="p-6 rounded-xl border border-slate-100 bg-white shadow-sm">
                               <div className="flex items-center space-x-2 mb-2">
                                  <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-full"><CreditCard size={16} /></div>
                                  <span className="text-sm font-bold uppercase tracking-wide text-indigo-900">
                                    New Balance
                                  </span>
                               </div>
                               <p className="text-3xl font-extrabold text-slate-900">
                                  ${Math.round(btAnalysis.newBalance).toLocaleString()}
                               </p>
                               <p className="text-xs mt-2 text-slate-500">
                                  Includes <strong>${Math.round(btAnalysis.transferFee).toLocaleString()}</strong> fee ({btSettings.feePercent}%)
                               </p>
                           </div>
                        </div>
                        
                        {/* Breakdown Table */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                           <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                              <h3 className="font-bold text-slate-900">Scenario Comparison ({btSettings.introDuration} Months)</h3>
                           </div>
                           <div className="p-6">
                              <div className="space-y-4">
                                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                                      <span className="text-slate-600 font-medium">1. Keep Current Liabilities</span>
                                      <div className="text-right">
                                          <span className="block font-bold text-red-500">-${Math.round(btAnalysis.baselineInterest).toLocaleString()}</span>
                                          <span className="text-xs text-slate-400">Interest Paid</span>
                                      </div>
                                  </div>
                                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                                      <span className="text-slate-600 font-medium">
                                        {scenarioType === 'TRANSFER' ? '2. Balance Transfer' : '2. Consolidation Loan'}
                                      </span>
                                      <div className="text-right">
                                          <span className="block font-bold text-orange-500">-${Math.round(btAnalysis.transferFee).toLocaleString()}</span>
                                          <span className="text-xs text-slate-400">{scenarioType === 'TRANSFER' ? 'Transfer Fee' : 'Origination Fee'}</span>
                                      </div>
                                  </div>
                                   <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                                      <span className="text-slate-600 font-medium">3. New Interest Cost</span>
                                      <div className="text-right">
                                          <span className="block font-bold text-slate-700">-${Math.round(btAnalysis.newInterest).toLocaleString()}</span>
                                          <span className="text-xs text-slate-400">{btSettings.introApr}% APR</span>
                                      </div>
                                  </div>
                              </div>
                              <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center">
                                  <span className="font-bold text-slate-900">Net Result</span>
                                  <span className={`text-xl font-extrabold ${btAnalysis.netSavings > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                      {btAnalysis.netSavings > 0 ? 'Save' : 'Lose'} ${Math.abs(Math.round(btAnalysis.netSavings)).toLocaleString()}
                                  </span>
                              </div>
                           </div>
                        </div>

                        {/* Payoff Strategy Recommendation */}
                        <div className="bg-slate-900 text-white rounded-xl shadow-lg p-6">
                            <h3 className="font-bold text-lg mb-4 flex items-center">
                               <Check className="mr-2 text-indigo-400" /> Payoff Strategy
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">To Finish in {btSettings.introDuration} Months</p>
                                    <p className="text-3xl font-bold text-white mb-1">
                                       ${Math.ceil(btAnalysis.requiredMonthlyPayment).toLocaleString()}<span className="text-sm font-normal text-slate-400">/mo</span>
                                    </p>
                                    <p className="text-sm text-slate-400">
                                       Required to reach $0 balance by end of term.
                                    </p>
                                </div>
                                <div className="border-l border-slate-700 pl-8">
                                    <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">Current Minimums</p>
                                    <p className="text-2xl font-bold text-slate-300 mb-1">
                                       ${Math.ceil(btAnalysis.currentMinPaymentSum).toLocaleString()}<span className="text-sm font-normal text-slate-500">/mo</span>
                                    </p>
                                    <p className="text-sm text-slate-400">
                                       Difference: <span className={btAnalysis.requiredMonthlyPayment > btAnalysis.currentMinPaymentSum ? 'text-red-400' : 'text-emerald-400'}>
                                          {btAnalysis.requiredMonthlyPayment > btAnalysis.currentMinPaymentSum ? '+' : ''}
                                          ${Math.ceil(btAnalysis.requiredMonthlyPayment - btAnalysis.currentMinPaymentSum)}/mo
                                       </span>
                                    </p>
                                </div>
                            </div>
                            {btAnalysis.balanceAfterPromo > 100 && (
                               <div className="mt-6 bg-slate-800 p-3 rounded-lg flex items-start space-x-3">
                                  <AlertTriangle className="text-orange-400 shrink-0 mt-0.5" size={16} />
                                  <p className="text-xs text-slate-300 leading-relaxed">
                                     <strong>Warning:</strong> If you only pay the current minimums, you will still owe 
                                     <strong className="text-white"> ${Math.round(btAnalysis.balanceAfterPromo).toLocaleString()} </strong> 
                                     when the term ends.
                                     {scenarioType === 'TRANSFER' && " Be prepared for the APR to jump!"}
                                  </p>
                               </div>
                            )}
                        </div>
                    </>
                )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between mb-8 gap-6">
              <StrategySelector />
              <div className="w-full md:w-2/3 flex flex-col md:flex-row items-end md:items-center justify-end gap-4 md:gap-6">
                <div className="flex flex-col items-end gap-2 w-full md:w-auto">
                  <div className="text-right">
                    <p className="text-slate-500 text-sm">Total Payoff Time</p>
                    <p className="text-xl font-bold text-slate-900">
                      {Math.floor(singleResult.monthsToFreedom / 12)}y {singleResult.monthsToFreedom % 12}m
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAnchorModal(true)}
                    className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 transition-colors"
                  >
                    <ArrowRight size={16} className="mr-2" />
                    Send schedule to Budget
                  </button>
                </div>
              </div>
            </div>
            {scheduleSavedAt && hasJustSentSchedule && (
              <div className="mb-6 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-800 flex items-center justify-between">
                <span>
                  Schedule sent to Budget using <strong>{STRATEGY_LABELS[selectedStrategy]}</strong>. Month 1 is anchored to {new Date(scheduleSavedAt).toLocaleDateString()}.
                </span>
              </div>
            )}
           
           <h3 className="font-bold text-slate-900 mb-4 flex items-center">
             <Table size={18} className="mr-2 text-indigo-600" />
             Monthly Payment Matrix
           </h3>
           
           <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[600px] overflow-y-auto relative">
             <table className="w-full text-left border-collapse">
               <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                 <tr>
                   <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 sticky left-0 bg-slate-50 z-20 shadow-[1px_0_0_0_#e2e8f0]">Month</th>
                   <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right bg-slate-50">Total Paid</th>
                   {liabilities.map(d => (
                     <th key={d.id} className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right min-w-[100px] bg-slate-50">
                       {d.name}
                     </th>
                   ))}
                   <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right bg-slate-50">Remaining</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {singleResult.timeline.map((row) => {
                     // Calculate total payment for this month from the breakdown
                     const monthTotalPayment = row.breakdown?.reduce((sum, b) => sum + b.payment, 0) || 0;
                     
                     return (
                       <tr key={row.month} className="hover:bg-slate-50 transition-colors">
                         <td className="px-4 py-3 text-sm font-bold text-slate-700 sticky left-0 bg-white shadow-[1px_0_0_0_#e2e8f0] group-hover:bg-slate-50">
                           {row.month}
                         </td>
                         <td className="px-4 py-3 text-sm font-bold text-indigo-700 text-right">
                           ${monthTotalPayment.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                         </td>
                         {liabilities.map(d => {
                            const info = row.breakdown?.find(b => b.liabilityId === d.id);
                            const paid = info?.payment || 0;
                            const isPaidOff = info && info.balance < 0.01;
                            
                            return (
                              <td key={d.id} className="px-4 py-3 text-sm text-right border-l border-slate-50">
                                {paid > 0 ? (
                                  <span className="text-slate-700">${paid.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                ) : (
                                  isPaidOff ? <span className="text-green-500 text-xs font-bold">PAID</span> : <span className="text-slate-300">-</span>
                                )}
                              </td>
                            );
                         })}
                         <td className="px-4 py-3 text-sm font-mono text-slate-500 text-right bg-slate-50/50">
                           ${row.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                         </td>
                       </tr>
                     );
                  })}
               </tbody>
             </table>
           </div>
        </div>
      )}

      {showAnchorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setShowAnchorModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-slate-100 w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Schedule</p>
                <h3 className="text-lg font-bold text-slate-900 mt-1">Set Month 1 Anchor Date</h3>
                <p className="text-sm text-slate-500 mt-1">Choose when your schedule starts before sending to Budget.</p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-600"
                onClick={() => setShowAnchorModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-2">
              <label className="font-semibold text-slate-800 text-xs uppercase tracking-wide">
                Month 1 Anchor Date
              </label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                onClick={() => setShowAnchorModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSchedule}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 transition-colors"
              >
                <ArrowRight size={16} className="mr-2" />
                Send schedule to Budget
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrategyLab;
