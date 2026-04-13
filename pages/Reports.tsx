import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Asset, BudgetSchedule, Expense, IncomeSource, Liability, PaychequeOccurrence, TransferLedgerFundingStatus, TransferLedgerPayment, UserSettings } from '../types';
import { calculateMonthlyIncome, getMinPayment, AmortizationRow, getAnnualizedIncomeAmount } from '../server/liabilityAlgorithms';
import { generatePaycheques, getPerChequeExpenseAmount, getPerChequeLiabilityAmount } from '../utils/paychequeLogic';
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
const getLedgerMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatLedgerMonth = (monthKey: string) => {
  const parts = monthKey.split('-').map(Number);
  if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  const [year, month] = parts;
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
};
const toLocalIsoDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
const buildTransferLedgerPaymentId = (
  transferAccount: string,
  sourceType: 'Expense' | 'Liability',
  sourceId: string,
  monthKey: string
) => `${transferAccount}::${sourceType}::${sourceId}::${monthKey}`;
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const getLiabilityLedgerAnchorDate = (liability: Liability) => {
  const nextDue = parseLocalDate(liability.nextDueDate ?? null);
  if (nextDue) {
    nextDue.setHours(0, 0, 0, 0);
    return nextDue;
  }
  const start = parseLocalDate(liability.startDate);
  if (start) {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};
const getLiabilityPaymentOccurrenceKey = (liability: Liability, contributionDate: Date) => {
  if (liability.paymentFrequency !== 'BI_WEEKLY' && liability.paymentFrequency !== 'WEEKLY') {
    return getLedgerMonthKey(contributionDate);
  }
  const intervalDays = liability.paymentFrequency === 'WEEKLY' ? 7 : 14;
  let anchor = getLiabilityLedgerAnchorDate(liability);
  let guard = 0;

  while (anchor < contributionDate && guard < 1000) {
    anchor = addDays(anchor, intervalDays);
    guard += 1;
  }
  while (anchor > contributionDate && guard < 2000) {
    const previous = addDays(anchor, -intervalDays);
    if (previous < contributionDate) break;
    anchor = previous;
    guard += 1;
  }

  return toLocalIsoDate(anchor);
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
  chequeDate?: string | null;
  isChecked?: boolean;
};

type TransferContributionEntry = {
  id: string;
  transferAccount: string;
  sourceId: string;
  sourceType: 'Expense' | 'Liability';
  sourceName: string;
  subtitle?: string;
  category: string;
  amount: number;
  date: Date;
  dateLabel: string;
  monthKey: string;
};

type TransferLedgerSuggestedPayment = {
  id: string;
  transferAccount: string;
  sourceId: string;
  sourceType: 'Expense' | 'Liability';
  sourceName: string;
  subtitle?: string;
  category: string;
  monthKey: string;
  amount: number;
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const Reports: React.FC<ReportsProps> = ({ liabilities, expenses, assets, incomes, settings }) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth() + 1;
  const defaultMonth = String(currentMonthIndex).padStart(2, '0');
  const [startMonth, setStartMonth] = useState(defaultMonth);
  const [endMonth, setEndMonth] = useState(defaultMonth);

  const currencySymbol = settings.currencySymbol || '$';
  const monthlyIncomeMode = settings.monthlyIncomeMode || 'ANNUALIZED';
  const disabledTransferLedgerAccounts = useMemo(
    () => new Set((settings.transferLedgerDisabledAccounts || []).map((account) => account.trim()).filter(Boolean)),
    [settings.transferLedgerDisabledAccounts]
  );
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [selectedChequeKey, setSelectedChequeKey] = useState<string | null>(null);
  const [amortizationSchedules, setAmortizationSchedules] = useState<Record<string, AmortizationDataView>>({});
  const [amortizationLoaded, setAmortizationLoaded] = useState(false);
  const [allExtraPayments, setAllExtraPayments] = useState<ExtraPayment[]>([]);
  const [savedSchedule, setSavedSchedule] = useState<BudgetSchedule | null>(null);
  const [transferLedgerPayments, setTransferLedgerPayments] = useState<TransferLedgerPayment[]>([]);
  const [transferLedgerFundingStatuses, setTransferLedgerFundingStatuses] = useState<TransferLedgerFundingStatus[]>([]);
  const [savingTransferLedgerIds, setSavingTransferLedgerIds] = useState<string[]>([]);
  const [savingTransferLedgerFundingIds, setSavingTransferLedgerFundingIds] = useState<string[]>([]);
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
    const loadSavedSchedule = async () => {
      try {
        const remote = await dbAPI.getBudgetSchedule();
        if (!active) return;
        setSavedSchedule(remote?.schedule || null);
      } catch {
        if (active) {
          setSavedSchedule(null);
        }
      }
    };
    const loadTransferLedgerPayments = async () => {
      try {
        const remote = await dbAPI.getTransferLedgerPayments();
        if (!active) return;
        setTransferLedgerPayments(remote?.payments || []);
      } catch {
        if (active) {
          setTransferLedgerPayments([]);
        }
      }
    };
    const loadTransferLedgerFundingStatuses = async () => {
      try {
        const remote = await dbAPI.getTransferLedgerFundingStatuses();
        if (!active) return;
        setTransferLedgerFundingStatuses(remote?.statuses || []);
      } catch {
        if (active) {
          setTransferLedgerFundingStatuses([]);
        }
      }
    };
    loadAmortizations();
    loadSavedSchedule();
    loadTransferLedgerPayments();
    loadTransferLedgerFundingStatuses();
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

  const getFallbackMonthlyPayment = useCallback((liability: Liability) => {
    const currentBalance = scheduleBalanceById[liability.id] ?? liability.balance;
    const monthlyInterest = currentBalance * (liability.interestRate / 100 / 12);
    const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
    return getMinPayment(liability, currentBalance, monthlyInterest, estFee);
  }, [scheduleBalanceById]);

  const getSavedSchedulePaymentForDate = useCallback((liability: Liability, date: Date) => {
    if (!savedSchedule?.savedAt || !savedSchedule.timeline?.length) return null;
    const savedDate = new Date(savedSchedule.savedAt);
    if (Number.isNaN(savedDate.getTime())) return null;
    const savedMonthCount = savedDate.getFullYear() * 12 + savedDate.getMonth();
    const targetMonthCount = date.getFullYear() * 12 + date.getMonth();
    const monthIndex = Math.max(1, targetMonthCount - savedMonthCount + 1);
    const row = savedSchedule.timeline.find((item) => item.month === monthIndex);
    const payment = row?.breakdown?.find((entry) => entry.liabilityId === liability.id)?.payment;
    return typeof payment === 'number' ? payment : null;
  }, [savedSchedule]);

  const getPlannedMonthlyPayment = useCallback((liability: Liability, date: Date) => {
    return getSavedSchedulePaymentForDate(liability, date) ?? getFallbackMonthlyPayment(liability);
  }, [getFallbackMonthlyPayment, getSavedSchedulePaymentForDate]);

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

  const paycheques = useMemo(() => {
    return generatePaycheques(budgetedIncomes, periodRange.start, periodRange.end, {
      budgetStartDate
    });
  }, [budgetStartDate, budgetedIncomes, periodRange]);

  const paychequesInPeriod = useMemo(
    () =>
      paycheques.filter(
        (paycheque) => paycheque.date >= periodRange.start && paycheque.date <= periodRange.end
      ),
    [paycheques, periodRange]
  );

  const incomeTotalsById = useMemo(() => {
    const totals = new Map<string, number>();
    paychequesInPeriod.forEach((paycheque) => {
      const current = totals.get(paycheque.source.id) || 0;
      totals.set(paycheque.source.id, current + paycheque.source.amount);
    });
    return totals;
  }, [paychequesInPeriod]);

  const periodIncomeTotal = useMemo(
    () => paychequesInPeriod.reduce((sum, paycheque) => sum + paycheque.source.amount, 0),
    [paychequesInPeriod]
  );

  const transferCheques = useMemo(() => {
    return paycheques.map((paycheque) => {
      const dateKey = paycheque.date.toISOString().split('T')[0];
      return {
        key: `${paycheque.source.id}-${dateKey}`,
        date: paycheque.date,
        label: `${paycheque.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} - ${paycheque.source.name}`,
        paycheque,
      };
    });
  }, [paycheques]);

  const defaultTransferKey = useMemo(() => {
    if (transferCheques.length === 0) return null;
    const today = new Date();
    const next = transferCheques.find((cheque) => cheque.date >= today);
    return (next || transferCheques[transferCheques.length - 1]).key;
  }, [transferCheques]);

  useEffect(() => {
    if (!selectedChequeKey && defaultTransferKey) {
      setSelectedChequeKey(defaultTransferKey);
      return;
    }
    if (selectedChequeKey && !transferCheques.some((cheque) => cheque.key === selectedChequeKey)) {
      setSelectedChequeKey(defaultTransferKey);
    }
  }, [defaultTransferKey, selectedChequeKey, transferCheques]);

  const selectedTransfer = transferCheques.find((cheque) => cheque.key === selectedChequeKey) || null;

  const hasSavedStrategySchedule = !!savedSchedule?.timeline?.length;

  const monthPaychequesByKey = useMemo(() => {
    const buckets = new Map<string, PaychequeOccurrence[]>();
    paycheques.forEach((paycheque) => {
      const key = getMonthKey(paycheque.date);
      const existing = buckets.get(key);
      if (existing) {
        existing.push(paycheque);
        return;
      }
      buckets.set(key, [paycheque]);
    });
    return buckets;
  }, [paycheques]);

  const getMonthPaychequesFor = useCallback(
    (date: Date) => monthPaychequesByKey.get(getMonthKey(date)) || [],
    [monthPaychequesByKey]
  );

  const monthPaycheques = useMemo(() => {
    if (!selectedTransfer) return paycheques;
    const key = getMonthKey(selectedTransfer.date);
    return monthPaychequesByKey.get(key) || paycheques;
  }, [monthPaychequesByKey, paycheques, selectedTransfer]);



  const getPerChequeExpenseFor = useCallback((expense: Expense, currentPaycheque: PaychequeOccurrence | null, monthPaychequesForCheque: PaychequeOccurrence[]) => {
    return getPerChequeExpenseAmount(expense, currentPaycheque, monthPaychequesForCheque, budgetedIncomes, userSplitRatio);
  }, [userSplitRatio, budgetedIncomes]);

  const getPerChequeExpense = (expense: Expense) => {
    const currentPaycheque = selectedTransfer?.paycheque || null;
    if (!currentPaycheque) return 0;
    const monthPaychequesForCheque = getMonthPaychequesFor(currentPaycheque.date);
    return getPerChequeExpenseFor(expense, currentPaycheque, monthPaychequesForCheque);
  };

  const getPerChequeLiabilityFor = useCallback((liability: Liability, currentPaycheque: PaychequeOccurrence | null, monthPaychequesForCheque: PaychequeOccurrence[]) => {
    const liabilityWithPlan = {
      ...liability,
      plannedPayment: currentPaycheque ? getPlannedMonthlyPayment(liability, currentPaycheque.date) : getFallbackMonthlyPayment(liability),
      scheduledFrequency: liability.paymentFrequency || 'MONTHLY',
    };
    return getPerChequeLiabilityAmount(
      liabilityWithPlan,
      currentPaycheque,
      monthPaychequesForCheque,
      budgetedIncomes,
      allExtraPayments,
      userSplitRatio,
      { includeUnchecked: false }
    );
  }, [allExtraPayments, budgetedIncomes, getFallbackMonthlyPayment, getPlannedMonthlyPayment, userSplitRatio]);

  const getPerChequeLiability = (liability: Liability) => {
    const currentPaycheque = selectedTransfer?.paycheque || null;
    if (!currentPaycheque) return 0;
    const monthPaychequesForCheque = getMonthPaychequesFor(currentPaycheque.date);
    return getPerChequeLiabilityFor(liability, currentPaycheque, monthPaychequesForCheque);
  };

  const getExpensePeriodTotal = useCallback(
    (expense: Expense) => {
      return paychequesInPeriod.reduce((sum, paycheque) => {
        const monthPaychequesForCheque = getMonthPaychequesFor(paycheque.date);
        return sum + getPerChequeExpenseFor(expense, paycheque, monthPaychequesForCheque);
      }, 0);
    },
    [getMonthPaychequesFor, getPerChequeExpenseFor, paychequesInPeriod]
  );

  const getLiabilityPeriodTotal = useCallback(
    (liability: Liability) => {
      return paychequesInPeriod.reduce((sum, paycheque) => {
        const monthPaychequesForCheque = getMonthPaychequesFor(paycheque.date);
        return sum + getPerChequeLiabilityFor(liability, paycheque, monthPaychequesForCheque);
      }, 0);
    },
    [getMonthPaychequesFor, getPerChequeLiabilityFor, paychequesInPeriod]
  );

  const periodExpenseTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + getExpensePeriodTotal(expense), 0),
    [expenses, getExpensePeriodTotal]
  );

  const periodLiabilityTotal = useMemo(
    () => activeLiabilities.reduce((sum, liability) => sum + getLiabilityPeriodTotal(liability), 0),
    [activeLiabilities, getLiabilityPeriodTotal]
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
    const buckets = new Map<string, { items: Liability[]; total: number }>();
    activeLiabilities.forEach((liability) => {
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
  }, [activeLiabilities, getLiabilityPeriodTotal]);

  const periodCashOut = useMemo(
    () => periodExpenseTotal + periodLiabilityTotal + monthlyBudget * monthCount,
    [monthCount, monthlyBudget, periodExpenseTotal, periodLiabilityTotal]
  );
  const periodNet = useMemo(() => periodIncomeTotal - periodCashOut, [periodCashOut, periodIncomeTotal]);

  const transferGroups = useMemo(() => {
    if (!selectedTransfer) return [];
    const buckets = new Map<string, { account: string; total: number; items: { name: string; amount: number; type: string; category: string; subtitle?: string }[] }>();
    expenses.forEach((expense) => {
      const account = expense.transferAccount?.trim();
      if (!account) return;
      const amount = getPerChequeExpense(expense);
      if (amount <= 0) return;
      const existing = buckets.get(account) || { account, total: 0, items: [] };
      existing.total += amount;
      existing.items.push({
        name: expense.name,
        amount,
        type: 'Expense',
        category: expense.category?.trim() || 'Uncategorized',
        subtitle: expense.subtitle || undefined,
      });
      buckets.set(account, existing);
    });
    activeLiabilities.forEach((liability) => {
      const account = liability.transferAccount?.trim();
      if (!account) return;
      const amount = getPerChequeLiability(liability);
      if (amount <= 0) return;
      const existing = buckets.get(account) || { account, total: 0, items: [] };
      existing.total += amount;
      existing.items.push({
        name: liability.name,
        amount,
        type: 'Liability',
        category: liability.category?.trim() || 'Uncategorized',
        subtitle: liability.subtitle || undefined,
      });
      buckets.set(account, existing);
    });
    return Array.from(buckets.values()).sort((a, b) =>
      a.account.localeCompare(b.account)
    );
  }, [activeLiabilities, expenses, getPerChequeExpense, getPerChequeLiability, selectedTransfer]);

  const transferLedgerPaymentById = useMemo(
    () => new Map(transferLedgerPayments.map((payment) => [payment.id, payment])),
    [transferLedgerPayments]
  );
  const transferLedgerFundingStatusById = useMemo(
    () => new Map(transferLedgerFundingStatuses.map((status) => [status.id, status.isChecked])),
    [transferLedgerFundingStatuses]
  );

  const pastTransferContributions = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const entries: TransferContributionEntry[] = [];

    paycheques.forEach((paycheque) => {
      if (paycheque.date > today) return;
      const monthPaychequesForCheque = getMonthPaychequesFor(paycheque.date);

      expenses.forEach((expense) => {
        const transferAccount = expense.transferAccount?.trim();
        if (!transferAccount) return;
        if (disabledTransferLedgerAccounts.has(transferAccount)) return;
        const amount = getPerChequeExpenseFor(expense, paycheque, monthPaychequesForCheque);
        if (amount <= 0) return;
        const dateLabel = paycheque.date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        entries.push({
          id: `in-${transferAccount}-${expense.id}-${paycheque.source.id}-${toLocalIsoDate(paycheque.date)}`,
          transferAccount,
          sourceId: expense.id,
          sourceType: 'Expense',
          sourceName: expense.name,
          subtitle: expense.subtitle || undefined,
          category: expense.category?.trim() || 'Uncategorized',
          amount,
          date: paycheque.date,
          dateLabel,
          monthKey: getLedgerMonthKey(paycheque.date),
        });
      });

      activeLiabilities.forEach((liability) => {
        const transferAccount = liability.transferAccount?.trim();
        if (!transferAccount) return;
        if (disabledTransferLedgerAccounts.has(transferAccount)) return;
        const amount = getPerChequeLiabilityFor(liability, paycheque, monthPaychequesForCheque);
        if (amount <= 0) return;
        const dateLabel = paycheque.date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        entries.push({
          id: `in-${transferAccount}-${liability.id}-${paycheque.source.id}-${toLocalIsoDate(paycheque.date)}`,
          transferAccount,
          sourceId: liability.id,
          sourceType: 'Liability',
          sourceName: liability.name,
          subtitle: liability.subtitle || undefined,
          category: liability.category?.trim() || 'Uncategorized',
          amount,
          date: paycheque.date,
          dateLabel,
          monthKey: getLedgerMonthKey(paycheque.date),
        });
      });
    });

    return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [activeLiabilities, disabledTransferLedgerAccounts, expenses, getMonthPaychequesFor, getPerChequeExpenseFor, getPerChequeLiabilityFor, paycheques]);

  const getTransferLedgerOutgoingAmount = useCallback(
    (
      sourceType: 'Expense' | 'Liability',
      sourceId: string,
      paymentKey: string
    ) => {
      if (sourceType === 'Expense') {
        const expense = expenses.find((item) => item.id === sourceId);
        return expense ? roundToCents(expense.amount) : 0;
      }

      const liability = activeLiabilities.find((item) => item.id === sourceId);
      if (!liability) return 0;

      const exactDate = paymentKey.match(/^\d{4}-\d{2}-\d{2}$/) ? paymentKey : null;
      if (exactDate) {
        const exactRow = amortizationSchedules[liability.id]?.timeline?.find(
          (row) => (row.actualDate || '') === exactDate
        );
        if (exactRow && exactRow.payment > 0) {
          return roundToCents(exactRow.payment);
        }
      }

      const effectiveDate = exactDate
        ? parseLocalDate(exactDate)
        : (() => {
            const [year, month] = paymentKey.split('-').map(Number);
            if (!year || !month) return null;
            return new Date(year, month - 1, 1);
          })();
      const monthlyAmount = getPlannedMonthlyPayment(
        liability,
        effectiveDate || new Date()
      );

      if (liability.paymentFrequency === 'BI_WEEKLY') {
        return roundToCents(monthlyAmount * (12 / 26));
      }
      if (liability.paymentFrequency === 'WEEKLY') {
        return roundToCents(monthlyAmount * (12 / 52));
      }
      return roundToCents(monthlyAmount);
    },
    [activeLiabilities, amortizationSchedules, expenses, getPlannedMonthlyPayment]
  );

  const transferLedgerSuggestedPayments = useMemo(() => {
    const buckets = new Map<string, TransferLedgerSuggestedPayment>();
    pastTransferContributions.forEach((entry) => {
      const liability = entry.sourceType === 'Liability'
        ? activeLiabilities.find((item) => item.id === entry.sourceId)
        : null;
      let paymentKey = entry.monthKey;
      if (
        entry.sourceType === 'Liability' &&
        liability &&
        (liability.paymentFrequency === 'BI_WEEKLY' || liability.paymentFrequency === 'WEEKLY')
      ) {
        paymentKey = getLiabilityPaymentOccurrenceKey(liability, entry.date);
      }
      const id = buildTransferLedgerPaymentId(
        entry.transferAccount,
        entry.sourceType,
        entry.sourceId,
        paymentKey
      );
      const existing = buckets.get(id);
      if (existing) {
        return;
      }
      const outgoingAmount = getTransferLedgerOutgoingAmount(
        entry.sourceType,
        entry.sourceId,
        paymentKey
      );
      buckets.set(id, {
        id,
        transferAccount: entry.transferAccount,
        sourceId: entry.sourceId,
        sourceType: entry.sourceType,
        sourceName: entry.sourceName,
        subtitle: entry.subtitle,
        category: entry.category,
        monthKey: paymentKey,
        amount: outgoingAmount || entry.amount,
      });
    });

    return Array.from(buckets.values()).sort((a, b) => {
      if (a.transferAccount !== b.transferAccount) {
        return a.transferAccount.localeCompare(b.transferAccount);
      }
      if (a.monthKey !== b.monthKey) {
        return b.monthKey.localeCompare(a.monthKey);
      }
      return a.sourceName.localeCompare(b.sourceName);
    });
  }, [activeLiabilities, getTransferLedgerOutgoingAmount, pastTransferContributions]);

  const transferLedgerAccounts = useMemo(() => {
    const accounts = new Map<
      string,
      {
        account: string;
        incoming: Array<TransferContributionEntry & { isChecked: boolean }>;
        payments: Array<TransferLedgerSuggestedPayment & { paid?: TransferLedgerPayment | null }>;
        availableBalance: number;
        incomingTotal: number;
        paidTotal: number;
        pendingTotal: number;
      }
    >();

    pastTransferContributions.forEach((entry) => {
      const isChecked = transferLedgerFundingStatusById.get(entry.id) ?? true;
      const existing = accounts.get(entry.transferAccount) || {
        account: entry.transferAccount,
        incoming: [],
        payments: [],
        availableBalance: 0,
        incomingTotal: 0,
        paidTotal: 0,
        pendingTotal: 0,
      };
      existing.incoming.push({ ...entry, isChecked });
      if (isChecked) {
        existing.incomingTotal += entry.amount;
        existing.availableBalance += entry.amount;
      }
      accounts.set(entry.transferAccount, existing);
    });

    transferLedgerSuggestedPayments.forEach((payment) => {
      const existing = accounts.get(payment.transferAccount) || {
        account: payment.transferAccount,
        incoming: [],
        payments: [],
        availableBalance: 0,
        incomingTotal: 0,
        paidTotal: 0,
        pendingTotal: 0,
      };
      const paid = transferLedgerPaymentById.get(payment.id) || null;
      existing.payments.push({ ...payment, paid });
      if (paid) {
        existing.paidTotal += paid.amount;
        existing.availableBalance -= paid.amount;
      } else {
        existing.pendingTotal += payment.amount;
      }
      accounts.set(payment.transferAccount, existing);
    });

    return Array.from(accounts.values())
      .map((account) => ({
        ...account,
        incoming: account.incoming.sort((a, b) => b.date.getTime() - a.date.getTime()),
        payments: account.payments.sort((a, b) => {
          if (a.monthKey !== b.monthKey) return b.monthKey.localeCompare(a.monthKey);
          return a.sourceName.localeCompare(b.sourceName);
        }),
      }))
      .sort((a, b) => a.account.localeCompare(b.account));
  }, [pastTransferContributions, transferLedgerFundingStatusById, transferLedgerPaymentById, transferLedgerSuggestedPayments]);

  const handleToggleTransferLedgerPayment = useCallback(
    async (payment: TransferLedgerSuggestedPayment, checked: boolean) => {
      setSavingTransferLedgerIds((current) => [...current, payment.id]);
      try {
        if (checked) {
          const payload: TransferLedgerPayment = {
            id: payment.id,
            transferAccount: payment.transferAccount,
            sourceId: payment.sourceId,
            sourceType: payment.sourceType,
            sourceName: payment.sourceName,
            monthKey: payment.monthKey,
            amount: payment.amount,
            paidDate: toLocalIsoDate(new Date()),
          };
          await dbAPI.saveTransferLedgerPayment(payload);
          setTransferLedgerPayments((current) => {
            const next = current.filter((entry) => entry.id !== payload.id);
            next.push(payload);
            return next;
          });
        } else {
          await dbAPI.deleteTransferLedgerPayment(payment.id);
          setTransferLedgerPayments((current) => current.filter((entry) => entry.id !== payment.id));
        }
      } catch (err) {
        console.error('Failed to update transfer ledger payment', err);
        alert('Failed to update transfer ledger payment.');
      } finally {
        setSavingTransferLedgerIds((current) => current.filter((id) => id !== payment.id));
      }
    },
    []
  );

  const handleToggleTransferLedgerFunding = useCallback(
    async (entryId: string, checked: boolean) => {
      setSavingTransferLedgerFundingIds((current) => [...current, entryId]);
      try {
        if (checked) {
          await dbAPI.deleteTransferLedgerFundingStatus(entryId);
          setTransferLedgerFundingStatuses((current) => current.filter((entry) => entry.id !== entryId));
        } else {
          const payload: TransferLedgerFundingStatus = {
            id: entryId,
            isChecked: false,
          };
          await dbAPI.saveTransferLedgerFundingStatus(payload);
          setTransferLedgerFundingStatuses((current) => {
            const next = current.filter((entry) => entry.id !== entryId);
            next.push(payload);
            return next;
          });
        }
      } catch (err) {
        console.error('Failed to update transfer ledger funding status', err);
        alert('Failed to update transfer ledger funding status.');
      } finally {
        setSavingTransferLedgerFundingIds((current) => current.filter((id) => id !== entryId));
      }
    },
    []
  );

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
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{hasSavedStrategySchedule ? 'Liability Payments' : 'Liability Minimums'}</p>
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
                value={selectedChequeKey || ''}
                onChange={(e) => setSelectedChequeKey(e.target.value)}
                disabled={transferCheques.length === 0}
              >
                {transferCheques.length === 0 && <option value="">No cheques</option>}
                {transferCheques.map((cheque) => (
                  <option key={cheque.key} value={cheque.key}>
                    {cheque.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {transferGroups.length === 0 ? (
            <p className="text-sm text-slate-400">No transfers configured for this cheque.</p>
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
                          <span>
                            {item.name}
                            {item.subtitle ? ` • ${item.subtitle}` : ''}
                            {' • '}
                            {item.category}
                          </span>
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

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 space-y-1">
              <button
                type="button"
                onClick={() => toggleReport('transferLedger')}
                className="flex items-center justify-between w-full text-left"
                aria-expanded={expandedReport === 'transferLedger'}
              >
                <span className="flex items-center space-x-2">
                  <span className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                    <ArrowRightLeft size={18} />
                  </span>
                  <span className="text-lg font-bold text-slate-900 hover:text-indigo-600 transition-colors">
                    Transfer Account Ledger
                  </span>
                </span>
                <span className="text-slate-500">
                  {expandedReport === 'transferLedger' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </span>
              </button>
            </div>
          </div>
          {transferLedgerAccounts.length === 0 ? (
            <p className="text-sm text-slate-400">No transfer-account activity has posted yet.</p>
          ) : (
            <div className="space-y-6">
              {transferLedgerAccounts.map((account) => (
                <div key={account.account} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-900">{account.account}</h3>
                      <p className="text-xs text-slate-500">
                        Available balance {formatCurrencyPrecise(account.availableBalance)}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
                      <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-slate-600">
                        In {formatCurrencyPrecise(account.incomingTotal)}
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-slate-600">
                        Out {formatCurrencyPrecise(account.paidTotal)}
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-amber-700">
                        Pending {formatCurrencyPrecise(account.pendingTotal)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-0">
                    <div className="p-4 border-b xl:border-b-0 xl:border-r border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-700">Posted Funding</h4>
                        <span className="text-xs text-slate-400">{account.incoming.length} entries</span>
                      </div>
                      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                        {account.incoming.map((entry) => (
                          <label
                            key={entry.id}
                            className={`flex items-start justify-between gap-3 text-sm border rounded-lg px-3 py-2 transition-colors ${
                              entry.isChecked ? 'border-slate-100' : 'border-amber-200 bg-amber-50/40'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                checked={entry.isChecked}
                                disabled={savingTransferLedgerFundingIds.includes(entry.id)}
                                onChange={(e) => handleToggleTransferLedgerFunding(entry.id, e.target.checked)}
                              />
                              <div>
                                <div className="font-medium text-slate-800">
                                  {entry.sourceName}
                                  {entry.subtitle ? ` • ${entry.subtitle}` : ''}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {entry.dateLabel} • {entry.category} • {entry.sourceType}
                                </div>
                              </div>
                            </div>
                            <span className={`font-mono font-semibold ${entry.isChecked ? 'text-emerald-600' : 'text-slate-400'}`}>
                              +{formatCurrencyPrecise(entry.amount)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-700">Payments To Check Off</h4>
                        <span className="text-xs text-slate-400">{account.payments.length} rows</span>
                      </div>
                      {account.payments.length === 0 ? (
                        <p className="text-sm text-slate-400">No grouped payment rows yet for this account.</p>
                      ) : (
                        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                          {account.payments.map((payment) => {
                            const isSaving = savingTransferLedgerIds.includes(payment.id);
                            const isPaid = !!payment.paid;
                            return (
                              <label
                                key={payment.id}
                                className={`flex items-start justify-between gap-3 border rounded-lg px-3 py-2 transition-colors ${
                                  isPaid ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    checked={isPaid}
                                    disabled={isSaving}
                                    onChange={(e) => handleToggleTransferLedgerPayment(payment, e.target.checked)}
                                  />
                                  <div>
                                    <div className="font-medium text-slate-800">
                                      {payment.sourceName}
                                      {payment.subtitle ? ` • ${payment.subtitle}` : ''}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {formatLedgerMonth(payment.monthKey)} • {payment.category} • {payment.sourceType}
                                    </div>
                                    {isPaid && payment.paid?.paidDate && (
                                      <div className="text-xs text-emerald-700">
                                        Paid {new Date(`${payment.paid.paidDate}T12:00:00`).toLocaleDateString()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <span className={`font-mono font-semibold ${isPaid ? 'text-emerald-700' : 'text-slate-700'}`}>
                                  {formatCurrencyPrecise(isPaid ? payment.paid?.amount || payment.amount : payment.amount)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
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
