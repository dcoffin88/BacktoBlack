import React, { useState } from 'react';
import { IncomeSource, PayFrequency, UserSettings } from '../types';
import { calculateMonthlyIncomeByMode } from '../server/liabilityAlgorithms';
import { Plus, Trash2, Edit2, X, Wallet, DollarSign, Users } from 'lucide-react';

interface IncomeProps {
  incomes: IncomeSource[];
  onSaveIncome: (income: IncomeSource) => Promise<void>;
  onDeleteIncome: (id: string) => Promise<void>;
  settings: UserSettings;
}

const Income: React.FC<IncomeProps> = ({ incomes, onSaveIncome, onDeleteIncome, settings }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Omit<IncomeSource, 'id'>>({
    name: '',
    amount: 0,
    frequency: 'MONTHLY',
    nextPayDate: new Date().toISOString().split('T')[0],
    isPartner: false,
    ownerId: undefined,
    includeInPlanner: true,
    includeFirstTwoChecks: false,
  });

  const isHouseholdMember = Boolean(settings.householdId);
  
  const partnerFirstWord =
    settings.partnerName?.trim()?.split(/\s+/)[0] || 'Partner';
	
  const partnerPossessive = `${partnerFirstWord}'s`;

  const openModal = (income?: IncomeSource, isPartnerAdd: boolean = false) => {
    if (income) {
      setEditingId(income.id);
      setFormData({ includeInPlanner: income.includeInPlanner ?? true, includeFirstTwoChecks: income.includeFirstTwoChecks ?? false, ...income });
    } else {
      setEditingId(null);
      setFormData({
        name: '',
        amount: 0,
        frequency: 'BI_WEEKLY',
        nextPayDate: new Date().toISOString().split('T')[0],
        isPartner: isPartnerAdd,
        ownerId: undefined,
        includeInPlanner: true,
        includeFirstTwoChecks: false,
      });
    }
    setIsModalOpen(true);
  };

  const saveIncome = async () => {
    const payload: IncomeSource = {
      ...formData,
      id: editingId || Math.random().toString(36).substr(2, 9),
    };
    await onSaveIncome(payload);
    setIsModalOpen(false);
  };

  const deleteIncome = async (id: string) => {
    if (!confirm('Delete this income source?')) return;
    await onDeleteIncome(id);
  };

  const renderList = (isPartner: boolean) => {
    const sources = incomes.filter(s => s.isPartner === isPartner);
	
	const label_possessive = isPartner ? `${partnerFirstWord}'s` : 'My';

    return (
      <div className="mt-3 space-y-3">
        {sources.length === 0 && (
          <div className="p-4 border border-dashed border-slate-200 rounded-lg text-center text-sm text-slate-400 bg-slate-50/50">
            No income sources added yet.
          </div>
        )}
        {sources.map(source => (
          <div key={source.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm hover:border-indigo-300 transition-colors">
            <div>
              <div className="flex items-center space-x-2">
                <p className="font-medium text-slate-800">{source.name}</p>
              </div>
              <div className="flex items-center space-x-2 text-xs text-slate-500 mt-0.5">
                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-medium">
                  {source.frequency.replace('_', ' ')}
                </span>
                {source.includeInPlanner === false && (
                  <span className="text-[10px] font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full uppercase">
                    Excluded from budget
                  </span>
                )}
                {/* <span>•</span> */}
                {/* <span>Next: {new Date(source.nextPayDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span> */}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="font-bold text-emerald-600">
                ${source.amount.toLocaleString()}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => openModal(source)}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50 transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => deleteIncome(source.id)}
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
          onClick={() => openModal(undefined, isPartner)}
          className={`w-full py-2 flex items-center justify-center text-sm font-medium rounded-lg border border-dashed transition-colors ${isPartner ? 'text-pink-600 border-pink-200 hover:bg-pink-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'}`}
        >
          <Plus size={16} className="mr-2" /> Add {label_possessive} Income
        </button>
      </div>
    );
  };

  const monthlyIncomeMode = settings.monthlyIncomeMode || 'ANNUALIZED';
  const totalMy = calculateMonthlyIncomeByMode(
    incomes.filter(i => !i.isPartner),
    monthlyIncomeMode,
    true
  );
  const totalPartner = calculateMonthlyIncomeByMode(
    incomes.filter(i => i.isPartner),
    monthlyIncomeMode,
    true
  );
  const total = totalMy + totalPartner;
  const plannerTotalMy = calculateMonthlyIncomeByMode(
    incomes.filter(i => !i.isPartner && i.includeInPlanner !== false),
    monthlyIncomeMode,
    false
  );
  const plannerTotalPartner = calculateMonthlyIncomeByMode(
    incomes.filter(i => i.isPartner && i.includeInPlanner !== false),
    monthlyIncomeMode,
    false
  );
  const plannerTotal = plannerTotalMy + plannerTotalPartner;

  return (
    <div className="space-y-8">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-indigo-500 text-white rounded-lg">
          <Wallet size={20} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Income
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-bold text-slate-700 mb-2">My Income</h3>
          {renderList(false)}
        </div>

        {(settings.enablePartner || isHouseholdMember) && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <div className="flex items-center space-x-2 mb-2">
              <Users size={16} className="text-pink-600" />
              <h3 className="text-sm font-bold text-slate-700">{partnerPossessive} Income</h3>
            </div>
            {renderList(true)}
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Monthly Rollup</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-slate-500">You</p>
            <p className="text-xl font-bold text-slate-900">${totalMy.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-[10px] text-slate-400">Budget: ${plannerTotalMy.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{settings.partnerName || 'Partner'}</p>
            <p className="text-xl font-bold text-slate-900">${totalPartner.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-[10px] text-slate-400">Budget: ${plannerTotalPartner.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total</p>
            <p className="text-xl font-bold text-emerald-600">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-[10px] text-slate-400">Budget: ${plannerTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">
                {editingId ? 'Edit Income' : 'Add Income'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Source Name</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. Pay Period 1"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
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
                    value={formData.amount || ''}
                    onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Frequency</label>
                  <select
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
                    value={formData.frequency}
                    onChange={e => setFormData({ ...formData, frequency: e.target.value as PayFrequency })}
                  >
                    <option value="WEEKLY">Weekly (52/yr)</option>
                    <option value="BI_WEEKLY">Bi-Weekly (26/yr)</option>
                    <option value="SEMI_MONTHLY">Semi-Monthly (24/yr)</option>
                    <option value="MONTHLY">Monthly (12/yr)</option>
                    <option value="ANNUAL">Annual (1/yr)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Starting Pay Date</label>
                  <div className="relative">
                    <input
                      type="date"
                      className="w-full px-4 py-2 pl-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={formData.nextPayDate}
                      onChange={e => setFormData({ ...formData, nextPayDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {(settings.enablePartner || isHouseholdMember) && (
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isPartner"
                    checked={formData.isPartner}
                    onChange={e => setFormData({ ...formData, isPartner: e.target.checked })}
                    className="w-4 h-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500"
                  />
                  <label htmlFor="isPartner" className="text-sm text-slate-700">This is {partnerPossessive} income</label>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="includeInPlanner"
                  checked={formData.includeInPlanner !== false}
                  onChange={e => setFormData({ ...formData, includeInPlanner: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                />
                <label htmlFor="includeInPlanner" className="text-sm text-slate-700">Include in Budget Planner</label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="includeFirstTwoChecks"
                  checked={!!formData.includeFirstTwoChecks}
                  onChange={e => setFormData({ ...formData, includeFirstTwoChecks: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                />
                <label htmlFor="includeFirstTwoChecks" className="text-sm text-slate-700">
                  Only include first two paychecks each month in budget
                </label>
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveIncome}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Income;
