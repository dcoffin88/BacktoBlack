import React, { useState, useEffect } from 'react';
import { UserSettings, ExpenseSplitMethod, Liability, Expense, Asset, IncomeSource, PayFrequency, MonthlyIncomeMode } from '../types';
import { getAnnualizedIncomeAmount, getMinPayment, calculateMonthlyIncome } from '../server/liabilityAlgorithms';
import { Save, Mail, DollarSign, Send, Users, PieChart, Settings, AlertTriangle, ArrowRight, CheckCircle, Plus, Trash2, Edit2, X, Calendar, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dbAPI } from '../server/db';

interface SettingsProps {
  settings: UserSettings;
  onSave: (newSettings: UserSettings) => Promise<void>;
  liabilities: Liability[];
  expenses: Expense[];
  assets: Asset[];
  incomes: IncomeSource[];
  onHouseholdLinked?: () => Promise<void>;
}

const AppSettings: React.FC<SettingsProps> = ({ settings, onSave, liabilities, expenses, assets, incomes, onHouseholdLinked }) => {
  const todayIso = new Date().toISOString().split('T')[0];
  const [tempSettings, setTempSettings] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [linkingHousehold, setLinkingHousehold] = useState(false);
  const [leavingHousehold, setLeavingHousehold] = useState(false);
  const [invites, setInvites] = useState<Array<{ token: string; status: string; inviterEmail: string; inviteeEmail: string; householdId: string; isIncoming: boolean }>>([]);
  const [sendingMonthly, setSendingMonthly] = useState(false);
  const [sendingTransfer, setSendingTransfer] = useState(false);
  const [availableChecks, setAvailableChecks] = useState<string[]>([]);
  const [showCheckSelection, setShowCheckSelection] = useState(false);

  const triggerMonthlyReport = async () => {
    setSendingMonthly(true);
    try {
      const res = await dbAPI.triggerMonthlyReport();
      if (res.success) {
        alert(res.message);
      }
    } catch (e: any) {
      alert(`Failed to trigger report: ${e.message}`);
    } finally {
      setSendingMonthly(false);
    }
  };

  const handleTriggerTransfer = async (date?: string) => {
    setSendingTransfer(true);
    setShowCheckSelection(false);
    try {
      const res = await dbAPI.triggerTransferReport(date);
      if (res.success) {
        alert(res.message);
      }
    } catch (e: any) {
      alert(`Failed to trigger report: ${e.message}`);
    } finally {
      setSendingTransfer(false);
    }
  };

  const triggerTransferReport = async () => {
    setSendingTransfer(true);
    try {
      const checks = await dbAPI.getAvailableChecks();
      if (checks.length === 0) {
        alert('No upcoming paychecks found to send alerts for.');
        setSendingTransfer(false);
        return;
      }
      setAvailableChecks(checks);
      setShowCheckSelection(true);
    } catch (e: any) {
      alert(`Failed to fetch available checks: ${e.message}`);
      setSendingTransfer(false);
    }
  };

  const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false);
  const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null);
  const [incomeFormData, setIncomeFormData] = useState<Omit<IncomeSource, 'id'>>({
    name: '',
    amount: 0,
    frequency: 'MONTHLY',
    nextPayDate: new Date().toISOString().split('T')[0],
    isPartner: false,
    ownerId: undefined
  });

  useEffect(() => {
    const nextSettings = { ...settings };
    if (!nextSettings.startDate) {
      nextSettings.startDate = todayIso;
    }
    setTempSettings(nextSettings);
  }, [settings, todayIso]);

  useEffect(() => {
    const loadInvites = async () => {
      try {
        const data = await dbAPI.getHouseholdInvites();
        setInvites(data);
      } catch (e) {
        console.error('Failed to load invites', e);
      }
    };
    loadInvites();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(tempSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const testEmailSettings = async () => {
    if (!tempSettings.email || !tempSettings.smtpHost) {
      alert("Please configure SMTP settings and enter an email address.");
      return;
    }

    setEmailSent(true);
    try {
      await dbAPI.testEmailSettings(tempSettings, tempSettings.email);
      alert("Test email sent successfullly! Check your inbox.");
    } catch (e: any) {
      console.error(e);
      alert(`Failed to send test email: ${e.message}`);
    } finally {
      setEmailSent(false);
    }
  };

  const getIncomeRatio = () => {
    const eligibleIncomes = incomes.filter((s) => s.includeInPlanner !== false);
    const userSources = eligibleIncomes.filter(s => !s.isPartner);
    const partnerSources = eligibleIncomes.filter(s => s.isPartner);

    const u = userSources.reduce((sum, source) => sum + getAnnualizedIncomeAmount(source), 0);
    const p = partnerSources.reduce((sum, source) => sum + getAnnualizedIncomeAmount(source), 0);

    const total = u + p;
    if (total === 0) return { u: 50, p: 50 };
    return { u: (u / total) * 100, p: (p / total) * 100 };
  };

  const totalExpenses = expenses.reduce((sum, b) => {
    return sum + (b.frequency === 'BI_WEEKLY' ? b.amount * 2 : b.amount);
  }, 0);

  const totalLiabilityMinimums = liabilities.reduce((sum, d) => {
    const monthlyInt = d.balance * (d.interestRate / 100 / 12);
    const estFee = d.isFeeMonthly ? (d.annualFee / 12) : 0;
    return sum + getMinPayment(d, d.balance, monthlyInt, estFee);
  }, 0);

  const totalIncome = calculateMonthlyIncome(incomes);
  const freeCashFlow = totalIncome - totalExpenses - totalLiabilityMinimums;
  const isDeficit = freeCashFlow < 0;
  const isHouseholdMember = Boolean(tempSettings.householdId);
  const pendingOutboundInvite = invites.find(i => !i.isIncoming);
  const simpleTerms = tempSettings.useSimpleTerms;
  const expenseLabel = simpleTerms ? 'Bills' : 'Expenses';
  const expensePlural = expenseLabel;
  const liabilityLabel = simpleTerms ? 'Loans' : 'Liabilities';
  const currencySymbol = tempSettings.currencySymbol || '$';
  const currencyOptions = ['$', '£', '€', '₹', '¥', '₱', '₩'];

  const openIncomeModal = (source?: IncomeSource, isPartnerAdd: boolean = false) => {
    if (source) {
      setEditingIncomeId(source.id);
      setIncomeFormData({
        name: source.name,
        amount: source.amount,
        frequency: source.frequency,
        nextPayDate: source.nextPayDate,
        isPartner: source.isPartner,
        ownerId: source.ownerId
      });
    } else {
      setEditingIncomeId(null);
      setIncomeFormData({
        name: '',
        amount: 0,
        frequency: 'BI_WEEKLY',
        nextPayDate: new Date().toISOString().split('T')[0],
        isPartner: isPartnerAdd,
        ownerId: undefined
      });
    }
    setIsIncomeModalOpen(true);
  };

  const saveIncomeSource = () => {
    let newSources = [...tempSettings.incomeSources];
    if (editingIncomeId) {
      newSources = newSources.map(s => s.id === editingIncomeId ? { ...incomeFormData, id: editingIncomeId } : s);
    } else {
      newSources.push({
        ...incomeFormData,
        id: Math.random().toString(36).substr(2, 9)
      });
    }
    setTempSettings({ ...tempSettings, incomeSources: newSources });
    setIsIncomeModalOpen(false);
  };

  const deleteIncomeSource = (id: string) => {
    if (confirm("Delete this income source?")) {
      setTempSettings({
        ...tempSettings,
        incomeSources: tempSettings.incomeSources.filter(s => s.id !== id)
      });
    }
  };

  const linkHousehold = async () => {
    if (!tempSettings.partnerEmail) {
      alert('Please enter a partner email to invite.');
      return;
    }
    try {
      setLinkingHousehold(true);
      await dbAPI.sendHouseholdInvite(tempSettings.partnerEmail);
      const updated = {
        ...tempSettings,
        enablePartner: true,
        partnerLinked: false,
        partnerName: tempSettings.partnerName || 'Partner'
      };
      setTempSettings(updated);
      alert(`Invite sent to ${tempSettings.partnerEmail}. They must accept to link accounts.`);
      const pending = await dbAPI.getHouseholdInvites();
      setInvites(pending);
    } catch (err) {
      console.error(err);
      alert('Failed to send invite. Please verify the email exists and try again.');
    } finally {
      setLinkingHousehold(false);
    }
  };

  const acceptInvite = async (token: string) => {
    try {
      setLinkingHousehold(true);
      const { householdId } = await dbAPI.acceptHouseholdInvite(token);
      const updated = {
        ...tempSettings,
        enablePartner: true,
        partnerLinked: true,
        householdId,
        partnerName: tempSettings.partnerName || 'Partner'
      };
      setTempSettings(updated);
      if (onHouseholdLinked) {
        await onHouseholdLinked();
      }
      const remaining = await dbAPI.getHouseholdInvites();
      setInvites(remaining);
      alert('Invite accepted. Household data is now shared.');
    } catch (err) {
      console.error(err);
      alert('Failed to accept invite. Please refresh and try again.');
    } finally {
      setLinkingHousehold(false);
    }
  };

  const declineInvite = async (token: string) => {
    try {
      setLinkingHousehold(true);
      await dbAPI.declineHouseholdInvite(token);
      const pending = await dbAPI.getHouseholdInvites();
      setInvites(pending);
      if (!isHouseholdMember) {
        setTempSettings({ ...tempSettings, enablePartner: false, householdId: undefined });
      }
    } catch (err) {
      console.error(err);
      alert('Failed to decline invite. Please try again.');
    } finally {
      setLinkingHousehold(false);
    }
  };

  const cancelInvite = async (token: string) => {
    try {
      setLinkingHousehold(true);
      await dbAPI.cancelHouseholdInvite(token);
      const pending = await dbAPI.getHouseholdInvites();
      setInvites(pending);
      alert('Invite cancelled.');
      if (!isHouseholdMember) {
        setTempSettings({ ...tempSettings, enablePartner: false });
      }
    } catch (err) {
      console.error(err);
      alert('Failed to cancel invite. Please try again.');
    } finally {
      setLinkingHousehold(false);
    }
  };

  const leaveHousehold = async () => {
    if (!confirm('Leave household and make this a standalone account?')) return;
    try {
      setLeavingHousehold(true);
      await dbAPI.leaveHousehold();
      const updated = {
        ...tempSettings,
        householdId: undefined,
        enablePartner: false,
        partnerLinked: false,
        partnerEmail: '',
        partnerName: '',
      };
      setTempSettings(updated);
      if (onHouseholdLinked) {
        await onHouseholdLinked();
      }
      const pending = await dbAPI.getHouseholdInvites();
      setInvites(pending);
      alert('You have left the household. This account is now standalone.');
    } catch (err) {
      console.error(err);
      alert('Failed to leave household. Please try again.');
    } finally {
      setLeavingHousehold(false);
    }
  };

  const renderIncomeList = (isPartner: boolean) => {
    const sources = tempSettings.incomeSources.filter(s => s.isPartner === isPartner);

    return (
      <div className="space-y-3 mt-3">
        {sources.length === 0 && (
          <div className="p-4 border border-dashed border-slate-200 rounded-lg text-center text-sm text-slate-400 bg-slate-50/50">
            No income sources added yet.
          </div>
        )}
        {sources.map(source => (
          <div key={source.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-indigo-300 transition-colors">
            <div>
              <p className="font-medium text-slate-800">{source.name}</p>
              <div className="flex items-center space-x-2 text-xs text-slate-500 mt-0.5">
                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-medium">
                  {source.frequency.replace('_', ' ')}
                </span>
                <span>•</span>
                <span>Next: {new Date(source.nextPayDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="font-bold text-emerald-600">
                ${source.amount.toLocaleString()}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => openIncomeModal(source)}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50 transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => deleteIncomeSource(source.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => openIncomeModal(undefined, isPartner)}
          className={`w-full py-2 flex items-center justify-center text-sm font-medium rounded-lg border border-dashed transition-colors ${isPartner ? 'text-pink-600 border-pink-200 hover:bg-pink-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'}`}
        >
          <Plus size={16} className="mr-2" /> Add {isPartner ? 'Partner ' : ''}Income
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-indigo-500 text-white rounded-lg">
          <Settings size={20} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Settings
          </h1>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Col: Inputs */}
          <div className="lg:col-span-2 bg-white p-8 rounded-xl shadow-sm border border-slate-100 space-y-8">
            {/* Display & Terminology */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                  <PieChart size={20} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Display & Terminology</h2>
              </div>
              <div className="space-y-3">
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={!!tempSettings.useSimpleTerms}
                    onChange={e => setTempSettings({ ...tempSettings, useSimpleTerms: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm text-slate-700">Use simplified terms (Loans/Bills instead of Liabilities/Expenses)</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Currency Symbol</label>
                    <select
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                      value={tempSettings.currencySymbol || '$'}
                      onChange={e => setTempSettings({ ...tempSettings, currencySymbol: e.target.value })}
                    >
                      {currencyOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Preview</label>
                    <div className="px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-sm text-slate-600">
                      {tempSettings.currencySymbol || '$'} 12,345.67
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Income Display</label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                    value={tempSettings.monthlyIncomeMode || 'ANNUALIZED'}
                    onChange={e => setTempSettings({ ...tempSettings, monthlyIncomeMode: e.target.value as MonthlyIncomeMode })}
                  >
                    <option value="ANNUALIZED">Annualized (Annual / 12)</option>
                    <option value="MODE">Mode (most common month)</option>
                    <option value="MEDIAN">Median (middle month)</option>
                    <option value="MEAN">Mean (average of 12 months)</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">Controls how monthly income is calculated across the app (Dashboard, Reports, and Income summaries).</p>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center space-x-2 mb-2">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                      <Calendar size={18} />
                    </div>
                    <h3 className="text-md font-bold text-slate-900">Budget Timeline</h3>
                  </div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                    value={tempSettings.startDate || todayIso}
                    onChange={e => setTempSettings({ ...tempSettings, startDate: e.target.value })}
                  />
                  <p className="text-xs text-slate-500 mt-1">Budget navigation cannot move to paycheques before this date.</p>
                </div>
              </div>
            </div>

            {/* Couple / Joint Mode */}
            <div className="pt-6 border-t border-slate-100 animate-fade-in">
              <div className="flex items-center space-x-2 mb-4">
                <div className="p-2 bg-pink-100 text-pink-600 rounded-lg">
                  <Users size={20} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Couple / Joint Mode</h2>
              </div>

              {/* Incoming Invites */}
              {invites.filter(i => i.isIncoming).length > 0 && (
                <div className="bg-white p-4 rounded-lg border border-pink-200 shadow-sm space-y-3 mb-4">
                  <p className="text-sm font-bold text-slate-800">Incoming Partner Invites</p>
                  {invites.filter(i => i.isIncoming).map(invite => (
                    <div key={invite.token} className="flex items-center justify-between text-sm border border-pink-100 rounded-lg px-3 py-2">
                      <div className="text-left">
                        <p className="font-medium text-slate-800">From {invite.inviterEmail}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => acceptInvite(invite.token)}
                          disabled={linkingHousehold}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${linkingHousehold ? 'bg-pink-300' : 'bg-pink-600 hover:bg-pink-700'}`}
                        >
                          {linkingHousehold ? 'Linking...' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          onClick={() => declineInvite(invite.token)}
                          disabled={linkingHousehold}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pendingOutboundInvite && (
                <div className="mb-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between">
                  <span>Waiting for partner ({pendingOutboundInvite.inviteeEmail}) to accept...</span>
                  <button
                    type="button"
                    onClick={() => cancelInvite(pendingOutboundInvite.token)}
                    disabled={linkingHousehold}
                    className="ml-3 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <div className="flex items-center space-x-3 mb-4">
                <input
                  type="checkbox"
                  id="enablePartner"
                  checked={isHouseholdMember || !!pendingOutboundInvite || tempSettings.enablePartner}
                  onChange={e => {
                    if (isHouseholdMember || pendingOutboundInvite) return;
                    setTempSettings({ ...tempSettings, enablePartner: e.target.checked });
                  }}
                  disabled={isHouseholdMember || !!pendingOutboundInvite}
                  className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                />
                <label htmlFor="enablePartner" className={`text-slate-700 font-medium select-none cursor-pointer ${(isHouseholdMember || !!pendingOutboundInvite) ? 'cursor-not-allowed text-slate-500' : ''}`}>
                  Link Partner Income & Expenses
                </label>
              </div>

              {(tempSettings.enablePartner || pendingOutboundInvite || isHouseholdMember) && (
                <div className="bg-pink-50/50 p-5 rounded-xl border border-pink-100 animate-fade-in space-y-6">

                  {!isHouseholdMember && !pendingOutboundInvite && !invites.filter(i => i.isIncoming).length ? (
                    <div className="bg-white p-6 rounded-xl border border-pink-100 text-center space-y-4 shadow-sm">
                      <div className="bg-pink-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto">
                        <Users className="text-pink-600" size={24} />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800">Link Partner Account</h3>
                        <p className="text-sm text-slate-500 mt-1">Invite your partner to automatically sync income and expenses.</p>
                      </div>
                      <div className="flex flex-col sm:flex-row max-w-md mx-auto gap-2">
                        <input
                          type="email"
                          placeholder="partner@email.com"
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-pink-500 outline-none"
                          value={tempSettings.partnerEmail || ''}
                          onChange={e => setTempSettings({ ...tempSettings, partnerEmail: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={linkHousehold}
                          disabled={linkingHousehold || !!pendingOutboundInvite || isHouseholdMember}
                          className={`bg-pink-600 text-white px-6 py-2 rounded-lg font-medium transition-colors ${(linkingHousehold || !!pendingOutboundInvite || isHouseholdMember) ? 'opacity-60 cursor-not-allowed' : 'hover:bg-pink-700'}`}
                        >
                          {linkingHousehold ? 'Linking...' : 'Link'}
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">Or manually enter details below.</p>
                    </div>
                  ) : isHouseholdMember ? (
                    <div className="flex justify-between items-center p-4 bg-white rounded-lg border border-pink-200 shadow-sm">
                      <div className="flex items-center space-x-3">
                        <div className="bg-green-100 p-2 rounded-full">
                          <CheckCircle size={16} className="text-green-600" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800">Household Active</p>
                          <p className="text-xs text-slate-500">Sharing data with partner</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={leaveHousehold}
                        disabled={leavingHousehold}
                        className="text-xs text-red-500 hover:text-red-700 font-medium px-3 py-1 bg-red-50 rounded-full hover:bg-red-100 transition-colors"
                      >
                        {leavingHousehold ? 'Leaving...' : 'Leave Household'}
                      </button>
                    </div>
                  ) : null}

                  {/* Expense Splitting Settings */}
                  <div className="border-t border-pink-200 pt-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <PieChart size={16} className="text-pink-600" />
                      <h3 className="text-sm font-bold text-slate-800">Expense Splitting Strategy</h3>
                    </div>

                    <div className="flex flex-col space-y-3 mb-4">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name="splitMethod"
                          value={ExpenseSplitMethod.EQUAL}
                          checked={tempSettings.expenseSplitMethod === ExpenseSplitMethod.EQUAL || !tempSettings.expenseSplitMethod}
                          onChange={() => setTempSettings({ ...tempSettings, expenseSplitMethod: ExpenseSplitMethod.EQUAL })}
                          className="w-4 h-4 text-pink-600 focus:ring-pink-500 border-gray-300"
                        />
                        <span className="text-sm text-slate-700">50/50 Split</span>
                      </label>
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name="splitMethod"
                          value={ExpenseSplitMethod.PERCENTAGE}
                          checked={tempSettings.expenseSplitMethod === ExpenseSplitMethod.PERCENTAGE}
                          onChange={() => setTempSettings({ ...tempSettings, expenseSplitMethod: ExpenseSplitMethod.PERCENTAGE })}
                          className="w-4 h-4 text-pink-600 focus:ring-pink-500 border-gray-300"
                        />
                        <span className="text-sm text-slate-700">Fixed Percentage</span>
                      </label>
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name="splitMethod"
                          value={ExpenseSplitMethod.INCOME}
                          checked={tempSettings.expenseSplitMethod === ExpenseSplitMethod.INCOME}
                          onChange={() => setTempSettings({ ...tempSettings, expenseSplitMethod: ExpenseSplitMethod.INCOME })}
                          className="w-4 h-4 text-pink-600 focus:ring-pink-500 border-gray-300"
                        />
                        <span className="text-sm text-slate-700">Income Weighted</span>
                      </label>
                    </div>

                    {/* Controls for Specific Methods */}
                    {tempSettings.expenseSplitMethod === ExpenseSplitMethod.PERCENTAGE && (
                      <div className="bg-white p-3 rounded-lg border border-pink-100">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Your Share</label>
                        <div className="flex items-center space-x-3">
                          <input
                            type="range"
                            min="0" max="100" step="1"
                            value={tempSettings.userSplitPercentage || 50}
                            onChange={e => setTempSettings({ ...tempSettings, userSplitPercentage: parseInt(e.target.value) })}
                            className="w-full h-2 bg-pink-100 rounded-lg appearance-none cursor-pointer accent-pink-600"
                          />
                          <span className="text-sm font-bold text-slate-900 w-12 text-right">{tempSettings.userSplitPercentage || 50}%</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 text-right">Partner pays {100 - (tempSettings.userSplitPercentage || 50)}%</p>
                      </div>
                    )}

                    {tempSettings.expenseSplitMethod === ExpenseSplitMethod.INCOME && (
                      <div className="bg-white p-3 rounded-lg border border-pink-100">
                        <div className="text-center text-xs text-slate-500 mt-1">
                          Based on income sources entered above: <br />
                          <strong className="text-slate-900">{getIncomeRatio().u.toFixed(1)}%</strong> You / <strong className="text-slate-900">{getIncomeRatio().p.toFixed(1)}%</strong> Partner
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Col: Calculations & Notifications */}
          <div className="space-y-6">

            {/* Calculation Summary Card moved to Dashboard */}

            {/* Notifications */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
              <div className="flex items-center space-x-2 mb-4">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                  <Mail size={18} />
                </div>
                <h2 className="text-md font-bold text-slate-900">Email Reports</h2>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="emailReports"
                    checked={tempSettings.emailReports}
                    onChange={e => setTempSettings({ ...tempSettings, emailReports: e.target.checked })}
                    className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="emailReports" className="text-sm text-slate-700 font-medium select-none">Enable Monthly Summary (includes Net Worth)</label>
                </div>

                {tempSettings.emailReports && (
                  <div className="animate-fade-in space-y-6 pt-2">
                    {/* Monthly Budget Settings */}
                    <div className="pl-6 border-l-2 border-indigo-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={tempSettings.enableMonthlyReport !== false}
                            onChange={e => setTempSettings({ ...tempSettings, enableMonthlyReport: e.target.checked })}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <span className="text-sm font-medium text-slate-700">Monthly Budget & Net Worth Summary</span>
                        </div>
                        {(tempSettings.enableMonthlyReport !== false) && (
                          <button
                            type="button"
                            onClick={triggerMonthlyReport}
                            disabled={sendingMonthly}
                            className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 flex items-center bg-indigo-50 px-2 py-1 rounded disabled:opacity-50"
                          >
                            <Send size={10} className="mr-1" />
                            {sendingMonthly ? 'Sending...' : 'Send Now'}
                          </button>
                        )}
                      </div>

                      {(tempSettings.enableMonthlyReport !== false) && (
                        <div className="pl-7 space-y-1">
                          <label className="block text-xs font-medium text-slate-500">Recipients (Optional override)</label>
                          <input
                            type="text"
                            value={tempSettings.monthlyReportRecipients || ''}
                            onChange={e => setTempSettings({ ...tempSettings, monthlyReportRecipients: e.target.value })}
                            placeholder={tempSettings.email}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                          <p className="text-xs text-slate-400">Values: {tempSettings.email} (default)</p>
                        </div>
                      )}
                    </div>

                    {/* Transfer Report Settings */}
                    <div className="pl-6 border-l-2 border-indigo-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={tempSettings.enableTransferReport !== false}
                            onChange={e => setTempSettings({ ...tempSettings, enableTransferReport: e.target.checked })}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <span className="text-sm font-medium text-slate-700">Daily "Money on the Move" Alerts</span>
                        </div>
                        {(tempSettings.enableTransferReport !== false) && (
                          <button
                            type="button"
                            onClick={triggerTransferReport}
                            disabled={sendingTransfer}
                            className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 hover:text-indigo-800 flex items-center bg-indigo-50 px-2 py-1 rounded disabled:opacity-50"
                          >
                            <Send size={10} className="mr-1" />
                            {sendingTransfer ? 'Sending...' : 'Send Now'}
                          </button>
                        )}
                      </div>
                      {(tempSettings.enableTransferReport !== false) && (
                        <div className="pl-7 space-y-1">
                          <label className="block text-xs font-medium text-slate-500">Recipients (Optional override)</label>
                          <input
                            type="text"
                            value={tempSettings.transferReportRecipients || ''}
                            onChange={e => setTempSettings({ ...tempSettings, transferReportRecipients: e.target.value })}
                            placeholder={tempSettings.email}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                          <p className="text-xs text-slate-400">Values: {tempSettings.email} (default)</p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1 pt-2 border-t border-slate-100">
                      <label className="block text-xs font-medium text-slate-500">Account Email (Used for login & defaults)</label>
                      <input
                        required
                        type="email"
                        value={tempSettings.email}
                        onChange={e => setTempSettings({ ...tempSettings, email: e.target.value })}
                        placeholder="you@example.com"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>

                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">SMTP Configuration</h3>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-1">
                          <label className="block text-xs font-medium text-slate-500">Host</label>
                          <input
                            type="text"
                            value={tempSettings.smtpHost || ''}
                            onChange={e => setTempSettings({ ...tempSettings, smtpHost: e.target.value })}
                            placeholder="smtp.gmail.com"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-500">Port</label>
                          <input
                            type="number"
                            value={tempSettings.smtpPort || ''}
                            onChange={e => setTempSettings({ ...tempSettings, smtpPort: parseInt(e.target.value) })}
                            placeholder="587"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-500">Username</label>
                          <input
                            type="text"
                            value={tempSettings.smtpUser || ''}
                            onChange={e => setTempSettings({ ...tempSettings, smtpUser: e.target.value })}
                            placeholder="user@email.com"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-xs font-medium text-slate-500">Password</label>
                          <div className="relative">
                            <input
                              type="password"
                              value={tempSettings.smtpPass || ''}
                              onChange={e => setTempSettings({ ...tempSettings, smtpPass: e.target.value })}
                              placeholder="App Password"
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                            <div className="absolute right-2 top-2 text-slate-400">
                              <Lock size={14} />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={tempSettings.smtpSecure || false}
                            onChange={e => setTempSettings({ ...tempSettings, smtpSecure: e.target.checked })}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <span className="text-xs text-slate-600">Use Secure Connection (TLS)</span>
                        </label>

                        <button
                          type="button"
                          onClick={testEmailSettings}
                          disabled={!tempSettings.smtpHost || !tempSettings.email || emailSent}
                          className="px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-md text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                          {emailSent ? 'Sending...' : 'Test Connection'}
                          {!emailSent && <Send size={12} className="ml-1.5" />}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 italic">
                      Note: For Gmail, you likely need to create an "App Password" if 2FA is enabled.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Save Button (Sticky on mobile, static on desktop) */}
            <button
              type="submit"
              className={`w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all flex justify-center items-center ${saved ? 'bg-green-600 hover:bg-green-700' : ''}`}
            >
              {saved ? 'Changes Saved' : 'Save Settings'}
            </button>
          </div>
        </div>
      </form>

      {/* Add/Edit Income Modal */}
      {isIncomeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">
                {editingIncomeId ? 'Edit Income' : 'Add Income'}
              </h3>
              <button onClick={() => setIsIncomeModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Source Name</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. Paycheque 1"
                  value={incomeFormData.name}
                  onChange={e => setIncomeFormData({ ...incomeFormData, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Net Amount (Take-Home)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-400">$</span>
                  <input
                    type="number"
                    className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="2000.00"
                    value={incomeFormData.amount || ''}
                    onChange={e => setIncomeFormData({ ...incomeFormData, amount: parseFloat(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Frequency</label>
                  <select
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                    value={incomeFormData.frequency}
                    onChange={e => setIncomeFormData({ ...incomeFormData, frequency: e.target.value as PayFrequency })}
                  >
                    <option value="WEEKLY">Weekly (52/yr)</option>
                    <option value="BI_WEEKLY">Bi-Weekly (26/yr)</option>
                    <option value="SEMI_MONTHLY">Semi-Monthly (24/yr)</option>
                    <option value="MONTHLY">Monthly (12/yr)</option>
                    <option value="ANNUAL">Annual (1/yr)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Next Pay Date</label>
                  <div className="relative">
                    <input
                      type="date"
                      className="w-full px-4 py-2 pl-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={incomeFormData.nextPayDate}
                      onChange={e => setIncomeFormData({ ...incomeFormData, nextPayDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs text-slate-500">
                <p>
                  <strong>Note:</strong> "Semi-Monthly" usually means 15th & 30th. "Bi-Weekly" means every other Friday (for example).
                </p>
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsIncomeModalOpen(false)}
                  className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveIncomeSource}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Check Selection Modal */}
      {showCheckSelection && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
              <h3 className="text-white font-bold text-lg">Select Check Date</h3>
              <button
                onClick={() => setShowCheckSelection(false)}
                className="text-white/80 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-slate-500 text-sm mb-4">
                Choose which paycheck's "Money on the Move" report you'd like to send.
              </p>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                {availableChecks.map(date => (
                  <button
                    key={date}
                    onClick={() => handleTriggerTransfer(date)}
                    className="w-full text-left px-4 py-3 rounded-xl border border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 transition-all flex items-center justify-between group"
                  >
                    <span className="font-medium text-slate-700">
                      {new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                    <ArrowRight size={16} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowCheckSelection(false)}
                className="w-full mt-6 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppSettings;
