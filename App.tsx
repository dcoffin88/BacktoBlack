import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import LiabilityList from './pages/LiabilityList';
import ExpenseList from './pages/ExpenseList';
import AssetList from './pages/AssetList';
import StrategyLab from './pages/StrategyLab';
import AppSettings from './pages/Settings';
import Income from './pages/Income';
import Profile from './pages/Profile';
import Budget from './pages/Budget';
import { dbAPI } from './server/db';
import { Liability, Expense, Asset, UserSettings, IncomeSource, UserProfile } from './types';
import { calculateMonthlyIncome, getMinPayment } from './server/liabilityAlgorithms';

const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [userEmail, setUserEmail] = useState<string>('');
  
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [incomes, setIncomes] = useState<IncomeSource[]>([]);
  const [settings, setSettings] = useState<UserSettings>({
    monthlyBudget: 0,
    emailReports: false,
    email: '',
    incomeSources: [],
    useSimpleTerms: false,
    currencySymbol: '$'
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [requireName, setRequireName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) {
      loadData();
      // Extract email from token roughly for display
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserEmail(payload.email);
      } catch (e) { console.error(e) }
    }
  }, [token]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [d, b, a, s, i, p] = await Promise.all([
        dbAPI.getLiabilities(),
        dbAPI.getExpenses(),
        dbAPI.getAssets(),
        dbAPI.getSettings(),
        dbAPI.getIncomes(),
        dbAPI.getProfile()
      ]);
      setLiabilities(d);
      setExpenses(b);
      setAssets(a);
      if (s) setSettings(s);
      setIncomes(i);
      setProfile(p);
      setNameInput(p?.name || '');
      setRequireName(!p?.name);
    } catch (err) {
      console.error("Failed to load data", err);
      if ((err as any).message === 'Unauthorized' || (err as any).status === 401) {
          handleLogout();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (newToken: string) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setLiabilities([]);
    setExpenses([]);
    setAssets([]);
    setProfile(null);
    setRequireName(false);
    setNameInput('');
    setNameError(null);
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError(null);
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError('Please enter your name to continue.');
      return;
    }
    try {
      const currentEmail = profile?.email || '';
      await dbAPI.updateProfile({ name: trimmed, email: currentEmail });
      setProfile(prev => prev ? { ...prev, name: trimmed } : { id: 0, email: currentEmail, name: trimmed });
      setRequireName(false);
    } catch (err: any) {
      setNameError(err.message || 'Failed to save name. Please try again.');
    }
  };

  // Data Handlers
  const saveLiability = async (liability: Liability) => {
    await dbAPI.saveLiability(liability);
    loadData();
  };
  const deleteLiability = async (id: string) => {
    await dbAPI.deleteLiability(id);
    loadData();
  };

  const saveExpense = async (expense: Expense) => {
    await dbAPI.saveExpense(expense);
    loadData();
  };
  const deleteExpense = async (id: string) => {
    await dbAPI.deleteExpense(id);
    loadData();
  };

  const saveAsset = async (asset: Asset) => {
    await dbAPI.saveAsset(asset);
    loadData();
  };
  const deleteAsset = async (id: string) => {
    await dbAPI.deleteAsset(id);
    loadData();
  };

  const saveSettings = async (newSettings: UserSettings) => {
    await dbAPI.saveSettings(newSettings);
    loadData();
  };

  const saveIncome = async (income: IncomeSource) => {
    await dbAPI.saveIncome(income);
    loadData();
  };
  const deleteIncome = async (id: string) => {
    await dbAPI.deleteIncome(id);
    loadData();
  };

  // Calculated Budget for Dashboard (Total Income - Expenses - Liability Mins = Snowball)
  const totalMonthlyIncome = calculateMonthlyIncome(incomes);
  const totalMonthlyExpenses = expenses.reduce((sum, b) => {
    const multiplier =
      b.frequency === 'BI_WEEKLY'
        ? 2
        : b.frequency === 'WEEKLY'
        ? 52 / 12
        : b.frequency === 'QUARTERLY'
        ? 1 / 3
        : 1;
    return sum + b.amount * multiplier;
  }, 0);
  const totalLiabilityMins = liabilities.reduce((sum, d) => {
      const int = d.balance * (d.interestRate / 100 / 12);
      const fee = d.isFeeMonthly ? (d.annualFee / 12) : 0;
      return sum + getMinPayment(d, d.balance, int, fee);
  }, 0);
  
  const calculatedSurplus = settings.monthlyBudget ?? 0;

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  if (loading && liabilities.length === 0) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          </div>
      );
  }

  return (
    <BrowserRouter>
      <Layout userEmail={userEmail} userName={profile?.name} onLogout={handleLogout} settings={settings}>
        {requireName && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Add your name</h3>
                <p className="text-sm text-slate-500 mt-1">We need a display name for your account (and to show to your partner if linked).</p>
              </div>
              <form onSubmit={handleSaveName} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="e.g. Alex Johnson"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                  />
                </div>
                {nameError && (
                  <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
                    {nameError}
                  </div>
                )}
                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg shadow-md transition-colors"
                >
                  Save and continue
                </button>
              </form>
            </div>
          </div>
        )}
        <Routes>
          <Route path="/" element={
            <Dashboard 
              liabilities={liabilities} 
              expenses={expenses} 
              assets={assets} 
              incomes={incomes}
              monthlyBudget={calculatedSurplus} 
              userSettings={settings}
            />
          } />
          <Route path="/liabilities" element={<LiabilityList liabilities={liabilities} onSave={saveLiability} onDelete={deleteLiability} settings={settings} />} />
          <Route path="/expenses" element={<ExpenseList expenses={expenses} onSave={saveExpense} onDelete={deleteExpense} userSettings={settings} incomes={incomes} />} />
          <Route path="/income" element={<Income incomes={incomes} onSaveIncome={saveIncome} onDeleteIncome={deleteIncome} settings={settings} />} />
          <Route path="/assets" element={<AssetList assets={assets} onSave={saveAsset} onDelete={deleteAsset} settings={settings} />} />
          <Route path="/strategy" element={<StrategyLab liabilities={liabilities} monthlyBudget={calculatedSurplus} />} />
          <Route path="/budget" element={<Budget expenses={expenses} liabilities={liabilities} incomes={incomes} userSettings={settings} onUpdateLiability={saveLiability} />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={
            <AppSettings 
              settings={settings} 
              onSave={saveSettings} 
              liabilities={liabilities}
              expenses={expenses}
              assets={assets}
              incomes={incomes}
              onHouseholdLinked={loadData}
            />
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
