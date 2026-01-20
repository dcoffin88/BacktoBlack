
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Liability, StrategyType, STRATEGY_LABELS, BudgetSchedule, PayoffResult } from '../types';
import { calculatePayoff, getMinPayment } from '../server/liabilityAlgorithms';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
  BarChart, Bar, Legend, LineChart, Line 
} from 'recharts';
import { ChevronDown, Check, ArrowRight, Layers, PieChart, BarChart2, Table, AlertTriangle } from 'lucide-react';
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

const parseLocalDate = (value?: string | null) => {
  if (!value) return null;
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toLocalDateString = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split('T')[0];

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const getDueDayForMonth = (year: number, monthIndex: number, dueDay: number) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  if (dueDay === 30) return lastDay;
  return Math.min(Math.max(1, dueDay), lastDay);
};

const getPaymentAnchorDate = (liability: Liability) => {
  const parsed = parseLocalDate(liability.nextDueDate);
  if (parsed) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }
  const start = parseLocalDate(liability.startDate);
  const base = start || new Date();
  const dueDay = getDueDayForMonth(base.getFullYear(), base.getMonth(), liability.dueDate || 1);
  const anchor = new Date(base.getFullYear(), base.getMonth(), dueDay);
  anchor.setHours(0, 0, 0, 0);
  return anchor;
};

const getPeriodIndexFromDate = (liability: Liability, checkDate?: string | null) => {
  const target = parseLocalDate(checkDate);
  if (!target) return null;
  target.setHours(0, 0, 0, 0);
  let anchor = getPaymentAnchorDate(liability);
  const freq = liability.paymentFrequency || 'MONTHLY';

  if (freq === 'WEEKLY' || freq === 'BI_WEEKLY') {
    const intervalDays = freq === 'WEEKLY' ? 7 : 14;
    const start = parseLocalDate(liability.startDate);
    if (start && anchor < start) {
      let guard = 0;
      while (anchor < start && guard < 500) {
        anchor = addDays(anchor, intervalDays);
        guard++;
      }
    }
    const previousAnchor = addDays(anchor, -intervalDays);
    if (target >= previousAnchor && target < anchor) {
      return target.getTime() === previousAnchor.getTime() ? 0 : 1;
    }
    let period = 1;
    let cursor = new Date(anchor);
    let guard = 0;
    while (cursor < target && guard < 500) {
      cursor = addDays(cursor, intervalDays);
      period += 1;
      guard++;
    }
    while (cursor > target && guard < 1000) {
      cursor = addDays(cursor, -intervalDays);
      period -= 1;
      guard++;
    }
    return period;
  }

  const start = parseLocalDate(liability.startDate);
  if (start && anchor < start) {
    let guard = 0;
    while (anchor < start && guard < 120) {
      anchor = new Date(anchor.getFullYear(), anchor.getMonth() + 1, anchor.getDate());
      guard++;
    }
  }
  const previousAnchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, anchor.getDate());
  if (target >= previousAnchor && target < anchor) {
    return target.getTime() === previousAnchor.getTime() ? 0 : 1;
  }
  let period = 1;
  let cursor = new Date(anchor);
  let guard = 0;
  while (cursor < target && guard < 1200) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    period += 1;
    guard++;
  }
  while (cursor > target && guard < 2400) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, cursor.getDate());
    period -= 1;
    guard++;
  }
  return period;
};

const NO_STRATEGY = 'NONE' as const;
type StrategySelection = StrategyType | typeof NO_STRATEGY;
const NO_STRATEGY_LABEL = 'Minimum Payments Only';

const StrategyLab: React.FC<StrategyLabProps> = ({ liabilities, monthlyBudget }) => {
  const [activeTab, setActiveTab] = useState<'simulate' | 'compare' | 'schedule'>('schedule');
  const [selectedStrategy, setSelectedStrategy] = useState<StrategySelection>(NO_STRATEGY);
  const [customOrderMap, setCustomOrderMap] = useState<Record<string, number>>({});
  const [chartsReady, setChartsReady] = useState(false);
  const [scheduleSavedAt, setScheduleSavedAt] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [hasJustSentSchedule, setHasJustSentSchedule] = useState(false);
  const [showAnchorModal, setShowAnchorModal] = useState(false);
  const { ref: compareChartRef, size: compareChartSize } = useChartDimensions();
  const [strategySimulations, setStrategySimulations] = useState<Record<StrategyType, PayoffResult>>({});
  const [amortizationSchedules, setAmortizationSchedules] = useState<
    Record<
      string,
      {
        timeline: {
          month: number;
          remainingBalance: number;
          payment?: number;
          interest?: number;
          principal?: number;
          fees?: number;
          extraPayment?: number;
          actualDate?: string | null;
          isHistorical?: boolean;
        }[];
      }
    >
  >({});
  
  // For Comparison Mode
  const [compareSelection, setCompareSelection] = useState<StrategySelection[]>([
    StrategyType.SNOWBALL, 
    StrategyType.AVALANCHE
  ]);

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
            if (remote.schedule.strategyLabel === NO_STRATEGY_LABEL) {
              setSelectedStrategy(NO_STRATEGY);
              return;
            }
            if (remote.schedule.strategy && STRATEGY_LABELS[remote.schedule.strategy]) {
              setSelectedStrategy(remote.schedule.strategy as StrategyType);
              return;
            }
          }
        }
        setSelectedStrategy(NO_STRATEGY);
      } catch {
        if (active) {
          setScheduleSavedAt(null);
          setSelectedStrategy(NO_STRATEGY);
        }
      }
    };
    loadSchedule();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadSimulations = async () => {
      const strategies = Object.values(StrategyType);
      const results = await Promise.all(
        strategies.map(async (strat) => {
          try {
            const remote = await dbAPI.getStrategySimulation(strat, monthlyBudget);
            return [strat, remote.simulation] as const;
          } catch {
            return [strat, null] as const;
          }
        })
      );
      if (!active) return;
      setStrategySimulations((prev) => {
        const next: Record<StrategyType, PayoffResult> = { ...prev };
        results.forEach(([strat, simulation]) => {
          if (simulation) {
            next[strat] = simulation;
          }
        });
        return next;
      });
    };
    loadSimulations();
    return () => {
      active = false;
    };
  }, [customOrderMap, liabilities, monthlyBudget]);

  useEffect(() => {
    let active = true;
    const loadAmortizations = async () => {
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
      const next: Record<
        string,
        {
          timeline: {
            month: number;
            remainingBalance: number;
            payment?: number;
            principal?: number;
            fees?: number;
            actualDate?: string | null;
            isHistorical?: boolean;
          }[];
        }
      > = {};
      results.forEach(([id, schedule]) => {
        if (schedule?.timeline?.length) {
          next[id] = schedule;
        }
      });
      setAmortizationSchedules(next);
    };
    loadAmortizations();
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
        const fallbackBalance =
          (Number.isFinite(liability.balance ?? NaN) ? liability.balance : null) ??
          (Number.isFinite(liability.startingBalance ?? NaN) ? liability.startingBalance : null) ??
          0;
        next[liability.id] = fallbackBalance as number;
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

      const startDate = parseLocalDate(liability.startDate ?? null);
      const nextDueDate = parseLocalDate(liability.nextDueDate ?? null);
      const anchor = startDate || nextDueDate;
      if (anchor) {
        anchor.setHours(0, 0, 0, 0);
      }

      const firstRow = schedule.timeline.reduce<typeof schedule.timeline[number] | null>(
        (acc, cur) => {
          if (cur.month <= 0) return acc;
          if (!acc || cur.month < acc.month) return cur;
          return acc;
        },
        null
      );

      if (anchor && anchor > today) {
        if (firstRow) {
          const inferredStartingBalance =
            firstRow.remainingBalance + (firstRow.principal || 0) - (firstRow.fees || 0);
          if (Number.isFinite(inferredStartingBalance) && inferredStartingBalance > 0) {
            next[liability.id] = inferredStartingBalance;
            return;
          }
        }
        if (Number.isFinite(liability.startingBalance ?? NaN)) {
          next[liability.id] = liability.startingBalance as number;
          return;
        }
      }

      const period = getPeriodIndexFromDate(liability, toLocalDateString(today));
      if (period !== null && period !== undefined) {
        const matchingRow = schedule.timeline.find((row) => row.month === period);
        if (matchingRow) {
          next[liability.id] = matchingRow.remainingBalance;
          return;
        }
        const priorRow = schedule.timeline
          .filter((row) => row.month <= period && row.month > 0)
          .reduce<typeof schedule.timeline[number] | null>(
            (acc, cur) => (!acc || cur.month > acc.month ? cur : acc),
            null
          );
        if (priorRow) {
          next[liability.id] = priorRow.remainingBalance;
          return;
        }
      }

      if (firstRow) {
        next[liability.id] = firstRow.remainingBalance;
        return;
      }

      const fallbackBalance =
        (Number.isFinite(liability.balance ?? NaN) ? liability.balance : null) ??
        (Number.isFinite(liability.startingBalance ?? NaN) ? liability.startingBalance : null) ??
        0;
      next[liability.id] = fallbackBalance as number;
    });
    return next;
  }, [amortizationSchedules, liabilities]);

  const liabilitiesWithDerivedBalance = useMemo(
    () =>
      liabilities.map((liability) => ({
        ...liability,
        balance: scheduleBalanceById[liability.id] ?? liability.balance,
      })),
    [liabilities, scheduleBalanceById]
  );

  const orderedLiabilities = useMemo(() => {
    return liabilitiesWithDerivedBalance.map((l, idx) => ({
      ...l,
      customOrder: customOrderMap[l.id] ?? l.customOrder ?? idx + 1,
    }));
  }, [liabilitiesWithDerivedBalance, customOrderMap]);

  const orderedMatrixLiabilities = useMemo(() => {
    const list = [...liabilitiesWithDerivedBalance];
    const baseMin = (liability: Liability) => {
      const monthlyInterest = liability.balance * (liability.interestRate / 100 / 12);
      return getMinPayment(liability, liability.balance, monthlyInterest, 0);
    };
    switch (selectedStrategy) {
      case NO_STRATEGY:
        return list;
      case StrategyType.SNOWBALL:
        return list.sort((a, b) => a.balance - b.balance);
      case StrategyType.AVALANCHE:
        return list.sort((a, b) => b.interestRate - a.interestRate);
      case StrategyType.HYBRID:
        return list.sort((a, b) => (b.interestRate / (b.balance || 1)) - (a.interestRate / (a.balance || 1)));
      case StrategyType.CFI:
        return list.sort((a, b) => {
          const minA = baseMin(a);
          const minB = baseMin(b);
          const cfiA = minA > 0 ? a.balance / minA : Infinity;
          const cfiB = minB > 0 ? b.balance / minB : Infinity;
          return cfiA - cfiB;
        });
      case StrategyType.HIGHEST_PAYMENT:
        return list.sort((a, b) => baseMin(b) - baseMin(a));
      case StrategyType.HIGHEST_UTILIZATION:
        return list.sort((a, b) => {
          const utilA = a.creditLimit ? a.balance / a.creditLimit : 0;
          const utilB = b.creditLimit ? b.balance / b.creditLimit : 0;
          return utilB - utilA;
        });
      case StrategyType.HIGHEST_INTEREST_AMT:
        return list.sort((a, b) => {
          const intA = a.balance * (a.interestRate / 100 / 12);
          const intB = b.balance * (b.interestRate / 100 / 12);
          return intB - intA;
        });
      case StrategyType.CUSTOM:
        return list.sort((a, b) => {
          const orderA = customOrderMap[a.id] ?? a.customOrder ?? 0;
          const orderB = customOrderMap[b.id] ?? b.customOrder ?? 0;
          return orderA - orderB;
        });
      default:
        return list;
    }
  }, [customOrderMap, liabilitiesWithDerivedBalance, selectedStrategy]);

  const minOnlyResult = useMemo<PayoffResult | null>(() => {
    if (!liabilitiesWithDerivedBalance.length) return null;
    const scheduleEntries = liabilitiesWithDerivedBalance.map((liability) => ({
      id: liability.id,
      name: liability.name,
      timeline: amortizationSchedules[liability.id]?.timeline || [],
    }));
    const maxMonth = scheduleEntries.reduce((max, entry) => {
      return entry.timeline.reduce((innerMax, row) => (row.month > innerMax ? row.month : innerMax), max);
    }, 0);
    if (!maxMonth) return null;

    const prevRemaining: Record<string, number> = {};
    liabilitiesWithDerivedBalance.forEach((liability) => {
      prevRemaining[liability.id] = liability.balance || 0;
    });
    const zeroMinById = liabilitiesWithDerivedBalance.reduce<Record<string, boolean>>((acc, liability) => {
      acc[liability.id] =
        (liability.minPaymentAmount || 0) <= 0 &&
        (liability.minPaymentPercentage || 0) <= 0 &&
        (liability.minPaymentFloor || 0) <= 0 &&
        !liability.minPaymentPlusInterest &&
        !liability.minPaymentPlusFees;
      return acc;
    }, {});

    let totalInterestPaid = 0;
    const timeline = [];
    for (let month = 1; month <= maxMonth; month += 1) {
      let totalPaid = 0;
      let totalBalance = 0;
      let liabilitiesRemaining = 0;
      let nonZeroMinRemaining = 0;
      const paidOffNames: string[] = [];
      const breakdown = scheduleEntries.map((entry) => {
        const row = entry.timeline.find((item) => item.month === month);
        const extra = row?.extraPayment || 0;
        const payment = row?.payment ? Math.max(0, row.payment - extra) : 0;
        const remaining = Math.max(0, row?.remainingBalance ?? prevRemaining[entry.id] ?? 0);
        const interest = row?.interest || 0;
        const isZeroMin = zeroMinById[entry.id];

        totalPaid += payment;
        totalBalance += remaining;
        totalInterestPaid += interest;

        const previous = prevRemaining[entry.id] ?? remaining;
        if (previous > 0.01 && remaining <= 0.01) {
          paidOffNames.push(entry.name);
        }
        prevRemaining[entry.id] = remaining;
        if (remaining > 0.01) {
          liabilitiesRemaining += 1;
          if (!isZeroMin) nonZeroMinRemaining += 1;
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
  }, [amortizationSchedules, liabilitiesWithDerivedBalance]);

  // Single Simulation Result
  const singleResult = useMemo(() => {
    if (selectedStrategy === NO_STRATEGY) {
      return minOnlyResult || {
        strategy: StrategyType.CUSTOM,
        monthsToFreedom: 0,
        totalInterestPaid: 0,
        timeline: [],
      };
    }
    const strat = selectedStrategy as StrategyType;
    return strategySimulations[strat] || calculatePayoff(orderedLiabilities, monthlyBudget, strat);
  }, [orderedLiabilities, monthlyBudget, selectedStrategy, strategySimulations, minOnlyResult]);

  const strategyMatrixRows = useMemo(() => {
    const simulation =
      selectedStrategy === NO_STRATEGY
        ? minOnlyResult
        : strategySimulations[selectedStrategy as StrategyType];
    if (!simulation?.timeline?.length) return [];
    const lastRemaining: Record<string, number> = {};
    liabilitiesWithDerivedBalance.forEach((liability) => {
      lastRemaining[liability.id] = liability.balance;
    });

    return simulation.timeline.map((row) => {
      let totalPaid = 0;
      const paymentsById: Record<string, number> = {};
      const remainingById: Record<string, number> = {};

      row.breakdown?.forEach((entry) => {
        const paid = entry.payment || 0;
        const remaining = Math.max(0, entry.balance || 0);
        paymentsById[entry.liabilityId] = paid;
        remainingById[entry.liabilityId] = remaining;
        lastRemaining[entry.liabilityId] = remaining;
        totalPaid += paid;
      });

    liabilitiesWithDerivedBalance.forEach((liability) => {
      if (paymentsById[liability.id] === undefined) {
        paymentsById[liability.id] = 0;
      }
      if (remainingById[liability.id] === undefined) {
        remainingById[liability.id] = Math.max(0, lastRemaining[liability.id] || 0);
      }
    });

      return {
        month: row.month,
        totalPaid,
        totalRemaining: Math.max(0, row.totalBalance),
        paymentsById,
        remainingById,
      };
    });
  }, [liabilitiesWithDerivedBalance, selectedStrategy, strategySimulations, minOnlyResult]);

  const matrixRows = strategyMatrixRows;
  const matrixPayoffMonths =
    selectedStrategy === NO_STRATEGY
      ? minOnlyResult?.monthsToFreedom ?? singleResult.monthsToFreedom
      : strategySimulations[selectedStrategy as StrategyType]?.monthsToFreedom ?? singleResult.monthsToFreedom;
  const strategyLoaded =
    selectedStrategy === NO_STRATEGY
      ? !!minOnlyResult?.timeline?.length
      : !!strategySimulations[selectedStrategy as StrategyType];

  // Comparison Results (Calculate all for data table)
  const allStrategies = Object.values(StrategyType);
  const compareOptions = useMemo(
    () => [
      { key: NO_STRATEGY as StrategySelection, label: NO_STRATEGY_LABEL, color: '#f97316' },
      ...allStrategies.map((strategy) => ({
        key: strategy as StrategySelection,
        label: STRATEGY_LABELS[strategy],
        color: COLORS[strategy],
      })),
    ],
    [allStrategies]
  );
  const comparisonResults = useMemo(() => {
    return compareOptions.map((option) => {
      if (option.key === NO_STRATEGY) {
        const res = minOnlyResult || {
          strategy: StrategyType.CUSTOM,
          monthsToFreedom: 0,
          totalInterestPaid: 0,
          timeline: [],
        };
        return {
          strategy: option.key,
          label: option.label,
          interest: res.totalInterestPaid,
          months: res.monthsToFreedom,
          timeline: res.timeline,
          color: option.color,
        };
      }
      const strat = option.key as StrategyType;
      const res =
        strategySimulations[strat] ||
        calculatePayoff(orderedLiabilities, monthlyBudget, strat);
      return {
        strategy: strat,
        label: option.label,
        interest: res.totalInterestPaid,
        months: res.monthsToFreedom,
        timeline: res.timeline,
        color: option.color,
      };
    });
  }, [compareOptions, minOnlyResult, orderedLiabilities, monthlyBudget, strategySimulations]);

  // Best/Worst for stats
  const bestInterest = comparisonResults.reduce((min, cur) => cur.interest < min.interest ? cur : min, comparisonResults[0]);
  const bestTime = comparisonResults.reduce((min, cur) => cur.months < min.months ? cur : min, comparisonResults[0]);

  // Chart Data Construction for Comparison
  const comparisonChartData = useMemo(() => {
    const activeComparisons = comparisonResults.filter(r => compareSelection.includes(r.strategy));
    if (activeComparisons.length === 0) return [];

    const maxMonths = Math.max(...activeComparisons.map(r => r.months));
    const initialBalance = liabilitiesWithDerivedBalance.reduce((sum, d) => sum + d.balance, 0);

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
  }, [comparisonResults, compareSelection, liabilitiesWithDerivedBalance]);

  // --- Handlers ---
  const toggleComparisonStrategy = (s: StrategySelection) => {
    setCompareSelection(prev => {
      const next = prev.includes(s) ? prev.filter(i => i !== s) : [...prev, s];
      // Keep the active selected strategy always included
      if (!next.includes(selectedStrategy)) {
        next.push(selectedStrategy);
      }
      return next;
    });
  };
  
  const handleCustomOrderChange = (id: string, value: number) => {
    setCustomOrderMap(prev => ({ ...prev, [id]: value }));
  };

  const handleConfirmSchedule = async () => {
    await saveScheduleToBudget();
    setShowAnchorModal(false);
  };

  const handleClearSchedule = async () => {
    try {
      await dbAPI.deleteBudgetSchedule();
      setScheduleSavedAt(null);
      setHasJustSentSchedule(false);
    } catch {
      // keep state if delete fails
    }
  };

  const saveScheduleToBudget = async () => {
    const anchorIso =
      anchorDate && !Number.isNaN(new Date(anchorDate).getTime())
        ? `${anchorDate}T12:00:00.000Z` // use midday UTC to avoid timezone shifting the date back
        : new Date().toISOString();
    const payload: BudgetSchedule = {
      strategy: selectedStrategy === NO_STRATEGY ? StrategyType.CUSTOM : (selectedStrategy as StrategyType),
      strategyLabel:
        selectedStrategy === NO_STRATEGY ? NO_STRATEGY_LABEL : STRATEGY_LABELS[selectedStrategy as StrategyType],
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
          onChange={(e) => setSelectedStrategy(e.target.value as StrategySelection)}
          className="w-full appearance-none bg-slate-50 border border-slate-300 text-slate-900 rounded-lg px-4 py-3 pr-8 focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          <option value={NO_STRATEGY}>{NO_STRATEGY_LABEL}</option>
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
                {compareOptions.map(option => (
                  <label 
                    key={option.key} 
                    className={`flex items-start p-3 rounded-lg border cursor-pointer transition-all ${
                      compareSelection.includes(option.key) 
                        ? 'bg-indigo-50 border-indigo-200' 
                        : 'bg-white border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    <input 
                      type="checkbox" 
                      className="mt-1 w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                      checked={compareSelection.includes(option.key)}
                      onChange={() => toggleComparisonStrategy(option.key)}
                    />
                    <div className="ml-3">
                      <span className={`block text-sm font-bold ${compareSelection.includes(option.key) ? 'text-indigo-900' : 'text-slate-700'}`}>
                        {option.label}
                      </span>
                      {option.key !== NO_STRATEGY && (
                        <span className="block text-xs text-slate-500 mt-0.5">
                          {option.key === StrategyType.SNOWBALL && "Smallest Balance First"}
                          {option.key === StrategyType.AVALANCHE && "Highest Interest Rate First"}
                          {option.key === StrategyType.CFI && "Optimizes Cash Flow"}
                          {option.key === StrategyType.CUSTOM && "Your manual priority order"}
                        </span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Comparison Chart */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col">
              <h3 className="font-bold text-slate-900 mb-6">Balance Over Time Comparison</h3>
              <div className="flex-1 min-h-[350px] min-w-[260px]" ref={compareChartRef}>
                {chartsReady && compareChartSize.width > 0 && compareChartSize.height > 0 && (
                  <LineChart
                    width={Math.max(200, compareChartSize.width)}
                    height={Math.max(240, compareChartSize.height)}
                    data={comparisonChartData}
                  >
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

      {activeTab === 'schedule' && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between mb-8 gap-6">
              <StrategySelector />
              <div className="w-full md:w-2/3 flex flex-col md:flex-row items-end md:items-center justify-end gap-4 md:gap-6">
                <div className="flex flex-col items-end gap-2 w-full md:w-auto">
                  <div className="text-right">
                    <p className="text-slate-500 text-sm">Total Payoff Time</p>
                    {strategyLoaded ? (
                      <p className="text-xl font-bold text-slate-900">
                        {Math.floor(matrixPayoffMonths / 12)}y {matrixPayoffMonths % 12}m
                      </p>
                    ) : (
                      <div className="ml-auto mt-2 h-6 w-24 rounded bg-slate-100 animate-pulse" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAnchorModal(true)}
                      className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold shadow-sm hover:bg-indigo-700 transition-colors"
                    >
                      <ArrowRight size={16} className="mr-2" />
                      Send schedule to Budget
                    </button>
                    {scheduleSavedAt && (
                      <button
                        type="button"
                        onClick={handleClearSchedule}
                        className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-semibold hover:border-slate-300 hover:text-slate-800 transition-colors"
                      >
                        Clear saved schedule
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {scheduleSavedAt && hasJustSentSchedule && (
              <div className="mb-6 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-800 flex items-center justify-between">
                <span>
                  Schedule sent to Budget using <strong>{selectedStrategy === NO_STRATEGY ? NO_STRATEGY_LABEL : STRATEGY_LABELS[selectedStrategy as StrategyType]}</strong>. Month 1 is anchored to {new Date(scheduleSavedAt).toLocaleDateString()}.
                </span>
              </div>
            )}
           
           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
             <h3 className="font-bold text-slate-900 flex items-center">
               <Table size={18} className="mr-2 text-indigo-600" />
               Monthly Payment Matrix
             </h3>
           </div>
           
           <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[600px] overflow-y-auto relative">
             {!strategyLoaded ? (
               <div className="p-6 space-y-3">
                 {Array.from({ length: 6 }).map((_, idx) => (
                   <div key={idx} className="h-5 w-full rounded bg-slate-100 animate-pulse" />
                 ))}
               </div>
             ) : (
               <table className="w-full text-left border-collapse">
                 <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                   <tr>
                     <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 sticky left-0 bg-slate-50 z-20 shadow-[1px_0_0_0_#e2e8f0]">Month</th>
                     <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right bg-slate-50">Total Paid</th>
                     {orderedMatrixLiabilities.map(d => (
                       <th key={d.id} className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right min-w-[100px] bg-slate-50">
                         {d.name}
                       </th>
                     ))}
                     <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right bg-slate-50">Remaining</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 font-mono">
                    {matrixRows.map((row) => {
                       return (
                         <tr key={row.month} className="hover:bg-slate-50 transition-colors">
                           <td className="px-4 py-3 text-sm font-bold text-slate-700 sticky left-0 bg-white shadow-[1px_0_0_0_#e2e8f0] group-hover:bg-slate-50">
                             {row.month}
                           </td>
                           <td className="px-4 py-3 text-sm font-bold text-indigo-700 text-right">
                             ${row.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                           </td>
                           {orderedMatrixLiabilities.map(d => {
                              const paid = row.paymentsById[d.id] || 0;
                              const remaining = row.remainingById[d.id] || 0;
                              const isPaidOff = remaining < 0.01;
                              const isZeroMin =
                                (d.minPaymentAmount || 0) <= 0 &&
                                (d.minPaymentPercentage || 0) <= 0 &&
                                (d.minPaymentFloor || 0) <= 0 &&
                                !d.minPaymentPlusInterest &&
                                !d.minPaymentPlusFees;
                              
                              return (
                                <td key={d.id} className="px-4 py-3 text-sm text-right border-l border-slate-50">
                                  {paid > 0 ? (
                                    <span className="text-slate-700">${paid.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  ) : (
                                    isPaidOff ? (
                                      <span className="text-green-500 text-xs font-bold">PAID</span>
                                    ) : isZeroMin && remaining > 0.01 ? (
                                      <span className="inline-flex items-center text-amber-600 text-xs font-semibold">
                                        <AlertTriangle size={12} className="mr-1" />
                                        MIN $0
                                      </span>
                                    ) : (
                                      <span className="text-slate-300">-</span>
                                    )
                                  )}
                                </td>
                              );
                           })}
                           <td className="px-4 py-3 text-sm font-mono text-slate-500 text-right bg-slate-50/50">
                             ${row.totalRemaining.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                           </td>
                         </tr>
                       );
                    })}
                 </tbody>
               </table>
             )}
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
