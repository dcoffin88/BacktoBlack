import React, { useEffect, useMemo, useState } from 'react';
import { Asset, Expense, IncomeSource, Liability, UserSettings } from '../types';
import { calculateMonthlyIncome, calculateMonthlyIncomeByMode, getMinPayment } from '../server/liabilityAlgorithms';
import { CalendarRange, ChevronDown, ChevronUp, Calculator, ArrowRightLeft, Receipt, FileText, Wallet } from 'lucide-react';

interface ReportsProps {
  liabilities: Liability[];
  expenses: Expense[];
  assets: Asset[];
  incomes: IncomeSource[];
  settings: UserSettings;
}

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

  const monthlyIncome = useMemo(
    () => calculateMonthlyIncomeByMode(budgetedIncomes, monthlyIncomeMode, false),
    [budgetedIncomes, monthlyIncomeMode]
  );

  const monthlyExpenses = useMemo(() => {
    return expenses.reduce((sum, e) => {
      const multiplier =
        e.frequency === 'BI_WEEKLY'
          ? 2
          : e.frequency === 'WEEKLY'
          ? 52 / 12
          : e.frequency === 'QUARTERLY'
          ? 1 / 3
          : e.frequency === 'ANNUAL'
          ? 1 / 12
          : 1;
      return sum + e.amount * multiplier;
    }, 0);
  }, [expenses]);

  const monthlyLiabilityMins = useMemo(() => {
    return activeLiabilities.reduce((sum, l) => {
      const monthlyInterest = l.balance * (l.interestRate / 100 / 12);
      const estFee = l.isFeeMonthly ? l.annualFee / 12 : 0;
      return sum + getMinPayment(l, l.balance, monthlyInterest, estFee);
    }, 0);
  }, [activeLiabilities]);

  const monthlyBudget = settings.monthlyBudget || 0;
  const monthlyCashOut = monthlyExpenses + monthlyLiabilityMins + monthlyBudget;
  const monthlyNet = monthlyIncome - monthlyCashOut;

  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.balance, 0);
  const netWorth = totalAssets - totalLiabilities;

  const expenseCategoryRows = useMemo(() => {
    const buckets = new Map<string, { items: Expense[]; total: number }>();
    expenses.forEach((expense) => {
      const key = expense.category?.trim() || 'Uncategorized';
      const existing = buckets.get(key) || { items: [], total: 0 };
      const multiplier =
        expense.frequency === 'BI_WEEKLY'
          ? 2
          : expense.frequency === 'WEEKLY'
          ? 52 / 12
          : expense.frequency === 'QUARTERLY'
          ? 1 / 3
          : expense.frequency === 'ANNUAL'
          ? 1 / 12
          : 1;
      existing.items.push(expense);
      existing.total += expense.amount * multiplier;
      buckets.set(key, existing);
    });
    return Array.from(buckets.entries())
      .map(([category, data]) => ({
        category,
        items: data.items.slice().sort((a, b) => a.name.localeCompare(b.name)),
        total: data.total,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [expenses]);

  const liabilityCategoryRows = useMemo(() => {
    const buckets = new Map<string, { items: Liability[]; total: number }>();
    activeLiabilities.forEach((liability) => {
      const key = liability.category?.trim() || 'Uncategorized';
      const existing = buckets.get(key) || { items: [], total: 0 };
      const monthlyInterest = liability.balance * (liability.interestRate / 100 / 12);
      const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
      const minPayment = getMinPayment(liability, liability.balance, monthlyInterest, estFee);
      existing.items.push(liability);
      existing.total += minPayment;
      buckets.set(key, existing);
    });
    return Array.from(buckets.entries())
      .map(([category, data]) => ({
        category,
        items: data.items.slice().sort((a, b) => a.name.localeCompare(b.name)),
        total: data.total,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [activeLiabilities]);

  const toggleReport = (key: string) => {
    setExpandedReport((current) => (current === key ? null : key));
  };

  const toMonthIndex = (value: string) => {
    const month = Number(value) || 1;
    return month - 1;
  };

  const monthCount = (() => {
    const startIdx = toMonthIndex(startMonth);
    const endIdx = toMonthIndex(endMonth);
    return Math.max(1, endIdx - startIdx + 1);
  })();

  const formatMonthLabel = (value: string) => {
    const month = Number(value) || now.getMonth() + 1;
    return new Date(now.getFullYear(), month - 1, 1).toLocaleDateString(undefined, {
      month: 'short',
    });
  };

  const periodLabel = startMonth === endMonth
    ? formatMonthLabel(startMonth)
    : `${formatMonthLabel(startMonth)} - ${formatMonthLabel(endMonth)}`;

  const scale = (value: number) => value * monthCount;
  const formatCurrency = (value: number) =>
    `${currencySymbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatCurrencyPrecise = formatCurrency;

  const periodRange = useMemo(() => {
    const startValue = Number(startMonth) || currentMonthIndex;
    const endValue = Number(endMonth) || startValue;
    const normalizedEnd = endValue < startValue ? startValue : endValue;
    return {
      start: new Date(currentYear, startValue - 1, 1),
      end: new Date(currentYear, normalizedEnd, 0),
    };
  }, [currentYear, currentMonthIndex, endMonth, startMonth]);

  const paychecks = useMemo(() => {
    const today = new Date();
    const windowYears = 20;
    const start = new Date(today.getFullYear() - windowYears, 0, 1);
    const end = new Date(today.getFullYear() + windowYears, 11, 31);
    const startBoundary =
      budgetStartDate && budgetStartDate.getTime() > start.getTime()
        ? budgetStartDate
        : start;

    const getPayDates = (
      source: IncomeSource,
      startDate: Date,
      endDate: Date
    ): Date[] => {
      const dates: Date[] = [];
      const [y, m, d] = source.nextPayDate.split('-').map(Number);
      let current = new Date(y, m - 1, d);

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

    const monthCountsBySource: Record<string, Record<string, number>> = {};
    const occurrences: {
      date: Date;
      source: IncomeSource;
      eligibleMonthly: boolean;
      eligibleBiWeekly: boolean;
    }[] = [];
    budgetedIncomes.forEach((src) => {
      const dates = getPayDates(src, startBoundary, end).sort(
        (a, b) => a.getTime() - b.getTime()
      );
      monthCountsBySource[src.id] = monthCountsBySource[src.id] || {};
      dates.forEach((date) => {
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        const currentCount = monthCountsBySource[src.id][monthKey] || 0;
        monthCountsBySource[src.id][monthKey] = currentCount + 1;

        const eligibleMonthly =
          src.includeFirstTwoChecks === true ? currentCount < 2 : true;

        occurrences.push({
          date,
          source: src,
          eligibleMonthly,
          eligibleBiWeekly: true,
        });
      });
    });

    return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [budgetStartDate, budgetedIncomes]);

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

  const periodCashOut = useMemo(() => monthlyCashOut * monthCount, [monthlyCashOut, monthCount]);
  const periodNet = useMemo(() => periodIncomeTotal - periodCashOut, [periodCashOut, periodIncomeTotal]);

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

  const userSplitRatio = useMemo(() => {
    if (!settings.enablePartner) return 1;
    if (settings.expenseSplitMethod === 'PERCENTAGE') {
      return (settings.userSplitPercentage || 50) / 100;
    }
    if (settings.expenseSplitMethod === 'INCOME') {
      const mine = calculateMonthlyIncome(
        budgetedIncomes.filter((i) => !i.isPartner)
      );
      const partner = calculateMonthlyIncome(
        budgetedIncomes.filter((i) => i.isPartner)
      );
      const total = mine + partner;
      if (total <= 0) return 0.5;
      return mine / total;
    }
    return 0.5;
  }, [budgetedIncomes, monthlyIncomeMode, settings]);

  const getExpenseShare = (expense: Expense) => {
    if (!settings.enablePartner) return 1;
    const owner = expense.owner || 'JOINT';
    if (owner === 'USER') return 1;
    if (owner === 'PARTNER') return 0;
    return userSplitRatio;
  };

  const liabilityWithMins = useMemo(() => {
    return activeLiabilities.map((liability) => {
      const monthlyInterest = liability.balance * (liability.interestRate / 100 / 12);
      const estFee = liability.isFeeMonthly ? liability.annualFee / 12 : 0;
      return {
        ...liability,
        plannedPayment: getMinPayment(liability, liability.balance, monthlyInterest, estFee),
        scheduledFrequency: liability.paymentFrequency || 'MONTHLY',
      };
    });
  }, [activeLiabilities]);

  const monthPaychecks = useMemo(() => {
    if (!selectedTransfer) return paychecks;
    const y = selectedTransfer.date.getFullYear();
    const m = selectedTransfer.date.getMonth();
    const filtered = paychecks.filter(
      (paycheck) => paycheck.date.getFullYear() === y && paycheck.date.getMonth() === m
    );
    return filtered.length > 0 ? filtered : paychecks;
  }, [paychecks, selectedTransfer]);

  const totalMonthlyIncomeIncluded = monthPaychecks
    .filter((paycheck) => paycheck.eligibleMonthly !== false)
    .reduce((sum, paycheck) => sum + paycheck.source.amount, 0);
  const totalBiWeeklyIncomeIncluded = monthPaychecks
    .filter((paycheck) => paycheck.eligibleBiWeekly !== false)
    .reduce((sum, paycheck) => sum + paycheck.source.amount, 0);
  const totalAnyIncomeIncluded = monthPaychecks.reduce(
    (sum, paycheck) => sum + paycheck.source.amount,
    0
  );
  const monthlyPool =
    totalMonthlyIncomeIncluded > 0 ? totalMonthlyIncomeIncluded : totalAnyIncomeIncluded;
  const biWeeklyPool =
    totalBiWeeklyIncomeIncluded > 0 ? totalBiWeeklyIncomeIncluded : totalAnyIncomeIncluded;

  const monthlyPoolUser = monthPaychecks
    .filter((paycheck) => paycheck.eligibleMonthly !== false && !paycheck.source.isPartner)
    .reduce((sum, paycheck) => sum + paycheck.source.amount, 0);
  const monthlyPoolPartner = monthPaychecks
    .filter((paycheck) => paycheck.eligibleMonthly !== false && paycheck.source.isPartner)
    .reduce((sum, paycheck) => sum + paycheck.source.amount, 0);
  const biWeeklyPoolUser = monthPaychecks
    .filter((paycheck) => paycheck.eligibleBiWeekly !== false && !paycheck.source.isPartner)
    .reduce((sum, paycheck) => sum + paycheck.source.amount, 0);
  const biWeeklyPoolPartner = monthPaychecks
    .filter((paycheck) => paycheck.eligibleBiWeekly !== false && paycheck.source.isPartner)
    .reduce((sum, paycheck) => sum + paycheck.source.amount, 0);

  const monthlyRatio =
    selectedTransfer?.paycheck.eligibleMonthly !== false && monthlyPool > 0
      ? (selectedTransfer?.paycheck.source.amount || 0) / monthlyPool
      : 0;
  const biWeeklyRatio =
    selectedTransfer?.paycheck.eligibleBiWeekly !== false && biWeeklyPool > 0
      ? (selectedTransfer?.paycheck.source.amount || 0) / biWeeklyPool
      : 0;

  const monthlyRatioOwner =
    selectedTransfer?.paycheck.eligibleMonthly === false
      ? 0
      : selectedTransfer?.paycheck.source.isPartner
      ? monthlyPoolPartner > 0
        ? (selectedTransfer?.paycheck.source.amount || 0) / monthlyPoolPartner
        : monthlyRatio
      : monthlyPoolUser > 0
      ? (selectedTransfer?.paycheck.source.amount || 0) / monthlyPoolUser
      : monthlyRatio;

  const biWeeklyRatioOwner =
    selectedTransfer?.paycheck.eligibleBiWeekly === false
      ? 0
      : selectedTransfer?.paycheck.source.isPartner
      ? biWeeklyPoolPartner > 0
        ? (selectedTransfer?.paycheck.source.amount || 0) / biWeeklyPoolPartner
        : biWeeklyRatio
      : biWeeklyPoolUser > 0
      ? (selectedTransfer?.paycheck.source.amount || 0) / biWeeklyPoolUser
      : biWeeklyRatio;

  const getPerCheckExpense = (expense: Expense) => {
    const excluded = new Set(expense.excludedIncomeSourceIds || []);
    const currentPaycheck = selectedTransfer?.paycheck;
    if (currentPaycheck && excluded.has(currentPaycheck.source.id)) {
      return 0;
    }

    const useBiWeekly =
      expense.frequency === 'BI_WEEKLY' || expense.frequency === 'WEEKLY';
    const monthlyEquivalent =
      expense.frequency === 'BI_WEEKLY'
        ? expense.amount * 2
        : expense.frequency === 'WEEKLY'
        ? expense.amount * (52 / 12)
        : expense.frequency === 'QUARTERLY'
        ? expense.amount / 3
        : expense.frequency === 'ANNUAL'
        ? expense.amount / 12
        : expense.amount;

    if (expense.excludeFromSplitting) {
      const owner = expense.owner || 'JOINT';
      const eligiblePool = monthPaychecks.filter((paycheck) => {
        const passesFrequency = useBiWeekly
          ? paycheck.eligibleBiWeekly !== false
          : paycheck.eligibleMonthly !== false;
        if (!passesFrequency) return false;
        if (excluded.has(paycheck.source.id)) return false;
        if (owner === 'PARTNER') return paycheck.source.isPartner;
        if (owner === 'USER') return !paycheck.source.isPartner;
        return true;
      });

      const isEligibleCurrent =
        currentPaycheck &&
        eligiblePool.some((paycheck) => paycheck === currentPaycheck) &&
        !excluded.has(currentPaycheck.source.id);

      if (!isEligibleCurrent) return 0;
      if (useBiWeekly) {
        return expense.amount;
      }
      const count = eligiblePool.length || 1;
      return monthlyEquivalent / count;
    }

    const eligibleMonthlyUser = monthPaychecks.filter(
      (paycheck) =>
        paycheck.eligibleMonthly !== false &&
        !paycheck.source.isPartner &&
        !excluded.has(paycheck.source.id)
    );
    const eligibleMonthlyPartner = monthPaychecks.filter(
      (paycheck) =>
        paycheck.eligibleMonthly !== false &&
        paycheck.source.isPartner &&
        !excluded.has(paycheck.source.id)
    );
    const eligibleBiWeeklyUser = monthPaychecks.filter(
      (paycheck) =>
        paycheck.eligibleBiWeekly !== false &&
        !paycheck.source.isPartner &&
        !excluded.has(paycheck.source.id)
    );
    const eligibleBiWeeklyPartner = monthPaychecks.filter(
      (paycheck) =>
        paycheck.eligibleBiWeekly !== false &&
        paycheck.source.isPartner &&
        !excluded.has(paycheck.source.id)
    );

    const monthlyPoolUserEff = eligibleMonthlyUser.reduce(
      (sum, paycheck) => sum + paycheck.source.amount,
      0
    );
    const monthlyPoolPartnerEff = eligibleMonthlyPartner.reduce(
      (sum, paycheck) => sum + paycheck.source.amount,
      0
    );
    const monthlyPoolEff = monthlyPoolUserEff + monthlyPoolPartnerEff;

    const biWeeklyPoolUserEff = eligibleBiWeeklyUser.reduce(
      (sum, paycheck) => sum + paycheck.source.amount,
      0
    );
    const biWeeklyPoolPartnerEff = eligibleBiWeeklyPartner.reduce(
      (sum, paycheck) => sum + paycheck.source.amount,
      0
    );
    const biWeeklyPoolEff = biWeeklyPoolUserEff + biWeeklyPoolPartnerEff;

    const monthlyRatioEff =
      currentPaycheck &&
      currentPaycheck.eligibleMonthly !== false &&
      !excluded.has(currentPaycheck.source.id) &&
      monthlyPoolEff > 0
        ? (currentPaycheck.source.amount || 0) / monthlyPoolEff
        : 0;
    const biWeeklyRatioEff =
      currentPaycheck &&
      currentPaycheck.eligibleBiWeekly !== false &&
      !excluded.has(currentPaycheck.source.id) &&
      biWeeklyPoolEff > 0
        ? (currentPaycheck.source.amount || 0) / biWeeklyPoolEff
        : 0;

    const monthlyRatioOwnerEff =
      currentPaycheck?.eligibleMonthly === false ||
      !currentPaycheck ||
      excluded.has(currentPaycheck.source.id)
        ? 0
        : currentPaycheck.source.isPartner
        ? monthlyPoolPartnerEff > 0
          ? (currentPaycheck.source.amount || 0) / monthlyPoolPartnerEff
          : monthlyRatioEff
        : monthlyPoolUserEff > 0
        ? (currentPaycheck.source.amount || 0) / monthlyPoolUserEff
        : monthlyRatioEff;

    const biWeeklyRatioOwnerEff =
      currentPaycheck?.eligibleBiWeekly === false ||
      !currentPaycheck ||
      excluded.has(currentPaycheck.source.id)
        ? 0
        : currentPaycheck.source.isPartner
        ? biWeeklyPoolPartnerEff > 0
          ? (currentPaycheck.source.amount || 0) / biWeeklyPoolPartnerEff
          : biWeeklyRatioEff
        : biWeeklyPoolUserEff > 0
        ? (currentPaycheck.source.amount || 0) / biWeeklyPoolUserEff
        : biWeeklyRatioEff;

    const owner = expense.owner || 'JOINT';
    if (owner === 'PARTNER') {
      if (!currentPaycheck?.source.isPartner) return 0;
      return useBiWeekly
        ? monthlyEquivalent * biWeeklyRatioOwnerEff
        : monthlyEquivalent * monthlyRatioOwnerEff;
    }
    if (owner === 'USER') {
      if (currentPaycheck?.source.isPartner) return 0;
      return useBiWeekly
        ? monthlyEquivalent * biWeeklyRatioOwnerEff
        : monthlyEquivalent * monthlyRatioOwnerEff;
    }

    const userPortion = monthlyEquivalent * userSplitRatio;
    const partnerPortion = monthlyEquivalent - userPortion;
    if (currentPaycheck?.source.isPartner) {
      return useBiWeekly
        ? partnerPortion * biWeeklyRatioOwnerEff
        : partnerPortion * monthlyRatioOwnerEff;
    }
    return useBiWeekly
      ? userPortion * biWeeklyRatioOwnerEff
      : userPortion * monthlyRatioOwnerEff;
  };

  const getPerCheckLiability = (liability: typeof liabilityWithMins[number]) => {
    const currentPaycheck = selectedTransfer?.paycheck;
    const excluded = new Set(liability.excludedIncomeSourceIds || []);
    if (currentPaycheck && excluded.has(currentPaycheck.source.id)) return 0;
    const useBiWeekly =
      liability.scheduledFrequency === 'BI_WEEKLY' ||
      liability.scheduledFrequency === 'WEEKLY';
    const hasAdvanced =
      liability.excludeFromSplitting ||
      (liability.excludedIncomeSourceIds || []).length > 0;
    const owner = liability.owner || 'JOINT';

    if (useBiWeekly) {
      if (currentPaycheck?.eligibleBiWeekly === false) return 0;
      if (owner === 'PARTNER' && !currentPaycheck?.source.isPartner) return 0;
      if (owner === 'USER' && currentPaycheck?.source.isPartner) return 0;

      const perPeriod =
        liability.scheduledFrequency === 'WEEKLY'
          ? (liability.plannedPayment || 0) * (12 / 52)
          : (liability.plannedPayment || 0) * (12 / 26);

      if (owner === 'JOINT') {
        if (liability.excludeFromSplitting) {
          return perPeriod;
        }
        const splitRatio = currentPaycheck?.source.isPartner
          ? 1 - userSplitRatio
          : userSplitRatio;
        return perPeriod * splitRatio;
      }
      return perPeriod;
    }

    if (!hasAdvanced) {
      if (currentPaycheck?.eligibleMonthly === false) return 0;
      return (liability.plannedPayment || 0) * monthlyRatio;
    }

    const eligibleMonthlyUser = monthPaychecks.filter(
      (p) =>
        p.eligibleMonthly !== false &&
        !p.source.isPartner &&
        !excluded.has(p.source.id)
    );
    const eligibleMonthlyPartner = monthPaychecks.filter(
      (p) =>
        p.eligibleMonthly !== false &&
        p.source.isPartner &&
        !excluded.has(p.source.id)
    );
    const eligibleBiWeeklyUser = monthPaychecks.filter(
      (p) =>
        p.eligibleBiWeekly !== false &&
        !p.source.isPartner &&
        !excluded.has(p.source.id)
    );
    const eligibleBiWeeklyPartner = monthPaychecks.filter(
      (p) =>
        p.eligibleBiWeekly !== false &&
        p.source.isPartner &&
        !excluded.has(p.source.id)
    );

    const monthlyPoolUserEff = eligibleMonthlyUser.reduce(
      (sum, p) => sum + p.source.amount,
      0
    );
    const monthlyPoolPartnerEff = eligibleMonthlyPartner.reduce(
      (sum, p) => sum + p.source.amount,
      0
    );
    const monthlyPoolEff = monthlyPoolUserEff + monthlyPoolPartnerEff;

    const biWeeklyPoolUserEff = eligibleBiWeeklyUser.reduce(
      (sum, p) => sum + p.source.amount,
      0
    );
    const biWeeklyPoolPartnerEff = eligibleBiWeeklyPartner.reduce(
      (sum, p) => sum + p.source.amount,
      0
    );
    const biWeeklyPoolEff = biWeeklyPoolUserEff + biWeeklyPoolPartnerEff;

    const monthlyRatioEff =
      currentPaycheck &&
      currentPaycheck.eligibleMonthly !== false &&
      !excluded.has(currentPaycheck.source.id) &&
      monthlyPoolEff > 0
        ? (currentPaycheck.source.amount || 0) / monthlyPoolEff
        : 0;
    const biWeeklyRatioEff =
      currentPaycheck &&
      currentPaycheck.eligibleBiWeekly !== false &&
      !excluded.has(currentPaycheck.source.id) &&
      biWeeklyPoolEff > 0
        ? (currentPaycheck.source.amount || 0) / biWeeklyPoolEff
        : 0;

    const monthlyRatioOwnerEff =
      currentPaycheck?.eligibleMonthly === false ||
      !currentPaycheck ||
      excluded.has(currentPaycheck.source.id)
        ? 0
        : currentPaycheck.source.isPartner
        ? monthlyPoolPartnerEff > 0
          ? (currentPaycheck.source.amount || 0) / monthlyPoolPartnerEff
          : monthlyRatioEff
        : monthlyPoolUserEff > 0
        ? (currentPaycheck.source.amount || 0) / monthlyPoolUserEff
        : monthlyRatioEff;

    const biWeeklyRatioOwnerEff =
      currentPaycheck?.eligibleBiWeekly === false ||
      !currentPaycheck ||
      excluded.has(currentPaycheck.source.id)
        ? 0
        : currentPaycheck.source.isPartner
        ? biWeeklyPoolPartnerEff > 0
          ? (currentPaycheck.source.amount || 0) / biWeeklyPoolPartnerEff
          : biWeeklyRatioEff
        : biWeeklyPoolUserEff > 0
        ? (currentPaycheck.source.amount || 0) / biWeeklyPoolUserEff
        : biWeeklyRatioEff;

    if (owner === 'PARTNER' && !currentPaycheck?.source.isPartner) return 0;
    if (owner === 'USER' && currentPaycheck?.source.isPartner) return 0;

    const ratioBase = useBiWeekly ? biWeeklyRatioEff : monthlyRatioEff;
    const ratioOwner = useBiWeekly ? biWeeklyRatioOwnerEff : monthlyRatioOwnerEff;
    const ratio = owner === 'JOINT' ? ratioBase : ratioOwner;
    if (!useBiWeekly && currentPaycheck?.eligibleMonthly === false) return 0;
    return (liability.plannedPayment || 0) * ratio;
  };

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
                          .map((income) => (
                            <div key={income.id} className="flex items-center justify-between text-slate-600 pl-3 pr-24">
                              <span className="font-medium">{income.name}</span>
                              <span className="font-semibold">
                                {formatCurrency(incomeTotalsById.get(income.id) || 0)}
                              </span>
                            </div>
                          ))}
                        <div className="flex items-center justify-end pt-2 text-slate-600 border-t border-slate-100">
                          <span className="font-semibold">+{formatCurrency(periodIncomeTotal)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 pl-3 text-xs text-slate-400">
                        {budgetedIncomes
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((income) => (
                            <div key={income.id} className="flex items-center justify-between pr-24">
                              <span>{income.name}</span>
                              <span>{formatCurrency(incomeTotalsById.get(income.id) || 0)}</span>
                            </div>
                          ))}
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
                          <span className="font-semibold">-{formatCurrency(scale(row.total))}</span>
                        )}
                      </div>
                      {expandedReport === 'budget' && (
                        <div className="space-y-1 pl-6 text-xs text-slate-400">
                          {row.items.map((expense) => (
                            <div key={expense.id} className="flex items-center justify-between pr-24">
                              <span>{expense.name}</span>
                              <span>{formatCurrency(scale(expense.amount))}</span>
                            </div>
                          ))}
                          <div className="flex items-center justify-end pt-2 text-slate-600 border-t border-slate-100">
                            <span className="font-semibold">-{formatCurrency(scale(row.total))}</span>
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
                  <span className="font-semibold text-slate-700">-{formatCurrency(scale(monthlyExpenses))}</span>
                </div>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Liability Minimums</p>
              {liabilities.length === 0 ? (
                <p className="text-xs text-slate-400">No liabilities recorded.</p>
              ) : (
                <div className="space-y-2">
                  {liabilityCategoryRows.map((row) => (
                    <div key={`budget-liability-${row.category}`} className="space-y-1">
                      <div className="flex items-center justify-between text-slate-600 pl-3 pr-24">
                        <span className="font-medium">{row.category}</span>
                        {expandedReport !== 'budget' && (
                          <span className="font-semibold">-{formatCurrency(scale(row.total))}</span>
                        )}
                      </div>
                    {expandedReport === 'budget' && (
                        <div className="space-y-1 pl-6 text-xs text-slate-400">
                          {row.items.map((liability) => (
                            <div key={liability.id} className="flex items-center justify-between pr-24">
                              <span>{liability.name}</span>
                              <span>{formatCurrency(scale(getMinPayment(liability, liability.balance, liability.balance * (liability.interestRate / 100 / 12), liability.isFeeMonthly ? liability.annualFee / 12 : 0)))}</span>
                            </div>
                          ))}
                          <div className="flex items-center justify-end pt-2 text-slate-600 border-t border-slate-100">
                            <span className="font-semibold">-{formatCurrency(scale(row.total))}</span>
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
                  <span className="font-semibold">-{formatCurrency(scale(monthlyLiabilityMins))}</span>
                </div>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="font-semibold text-slate-700">Remaining</span>
              <span className={`font-semibold ${periodNet >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                {formatCurrency(periodNet)}
              </span>
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
      </div>
    </div>
  );
};

export default Reports;
