import { Liability, Expense, Asset, UserSettings, IncomeSource, UserProfile, BudgetSchedule } from '../types';

const API_BASE_URL = '/api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
};

const fetchJson = async <T = any>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const message = text || response.statusText || 'Request failed';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return (await response.json()) as T;
};

export const dbAPI = {
  // AUTH
  login: async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Login failed');
    }
    return payload;
  },

  register: async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Registration failed');
    }
    return payload;
  },

  // PROFILE
  getProfile: async (): Promise<UserProfile> => {
    return await fetchJson<UserProfile>(`${API_BASE_URL}/profile`, { headers: getAuthHeaders() });
  },

  updateProfile: async (profile: Partial<UserProfile>) => {
    await fetchJson(`${API_BASE_URL}/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(profile),
    });
  },

  updatePassword: async (currentPassword: string, newPassword: string) => {
    await fetchJson(`${API_BASE_URL}/profile/password`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  // INCOMES
  getIncomes: async () => {
    return await fetchJson<IncomeSource[]>(`${API_BASE_URL}/incomes`, { headers: getAuthHeaders() });
  },
  saveIncome: async (income: IncomeSource) => {
    await fetchJson(`${API_BASE_URL}/incomes`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(income),
    });
  },
  deleteIncome: async (id: string) => {
    await fetchJson(`${API_BASE_URL}/incomes/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
  },

  // ACCOUNTS / TRANSACTIONS

  // DEBTS
  getLiabilities: async (): Promise<Liability[]> => {
    return await fetchJson<Liability[]>(`${API_BASE_URL}/liabilities`, { headers: getAuthHeaders() });
  },
  saveLiability: async (liability: Liability) => {
    await fetchJson(`${API_BASE_URL}/liabilities`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(liability),
    });
  },
  deleteLiability: async (id: string) => {
    await fetchJson(`${API_BASE_URL}/liabilities/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
  },

  // BILLS
  getExpenses: async (): Promise<Expense[]> => {
    return await fetchJson<Expense[]>(`${API_BASE_URL}/expenses`, { headers: getAuthHeaders() });
  },
  saveExpense: async (expense: Expense) => {
    await fetchJson(`${API_BASE_URL}/expenses`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(expense),
    });
  },
  deleteExpense: async (id: string) => {
    await fetchJson(`${API_BASE_URL}/expenses/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
  },

  // ASSETS
  getAssets: async (): Promise<Asset[]> => {
    return await fetchJson<Asset[]>(`${API_BASE_URL}/assets`, { headers: getAuthHeaders() });
  },
  saveAsset: async (asset: Asset) => {
    await fetchJson(`${API_BASE_URL}/assets`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(asset),
    });
  },
  deleteAsset: async (id: string) => {
    await fetchJson(`${API_BASE_URL}/assets/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
  },

  // Budget Checks
  getBudgetChecks: async (): Promise<{
    expenseChecksByCheck: Record<string, Record<string, boolean>>;
    liabilityChecksByCheck: Record<string, Record<string, boolean>>;
  }> => {
    return await fetchJson(`${API_BASE_URL}/budget/checks`, { headers: getAuthHeaders() });
  },
  saveBudgetChecks: async (payload: {
    checkDate: string;
    expenseChecks?: Record<string, boolean>;
    liabilityChecks?: Record<string, boolean>;
  }) => {
    await fetchJson(`${API_BASE_URL}/budget/checks`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getExtraPayments: async (): Promise<{
    extras: Array<{ id: string; liabilityId: string; amount: number; checkDate?: string | null }>;
  }> => {
    return await fetchJson(`${API_BASE_URL}/budget/extra-payments`, { headers: getAuthHeaders() });
  },
  saveExtraPayment: async (payload: {
    id: string;
    liabilityId: string;
    amount: number;
    checkDate?: string | null;
  }) => {
    await fetchJson(`${API_BASE_URL}/budget/extra-payments`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },
  deleteExtraPayment: async (id: string) => {
    await fetchJson(`${API_BASE_URL}/budget/extra-payments/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // Budget Schedule
  getBudgetSchedule: async (): Promise<{ schedule: BudgetSchedule | null }> => {
    return await fetchJson(`${API_BASE_URL}/budget/schedule`, { headers: getAuthHeaders() });
  },
  saveBudgetSchedule: async (schedule: BudgetSchedule) => {
    return await fetchJson(`${API_BASE_URL}/budget/schedule`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(schedule),
    });
  },
  deleteBudgetSchedule: async () => {
    await fetchJson(`${API_BASE_URL}/budget/schedule`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
  },

  // SETTINGS
  getSettings: async (): Promise<UserSettings | null> => {
    return await fetchJson<UserSettings | null>(`${API_BASE_URL}/settings`, { headers: getAuthHeaders() });
  },
  saveSettings: async (settings: UserSettings) => {
    await fetchJson(`${API_BASE_URL}/settings`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings),
    });
  },

  // HOUSEHOLD
  joinHousehold: async (partnerEmail: string) => {
    const response = await fetch(`${API_BASE_URL}/household/join`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ partnerEmail }),
    });
    if (!response.ok) {
      throw new Error(`Failed to join household (${response.status})`);
    }
    return (await response.json()) as { householdId: string };
  },

  sendHouseholdInvite: async (partnerEmail: string) => {
    const response = await fetch(`${API_BASE_URL}/household/invite`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ partnerEmail }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to send invite');
    }
    return payload as { token: string; householdId: string };
  },

  getHouseholdInvites: async () => {
    const response = await fetch(`${API_BASE_URL}/household/invites`, {
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to fetch invites');
    }
    return payload as Array<{ token: string; status: string; inviterEmail: string; inviteeEmail: string; householdId: string; isIncoming: boolean }>;
  },

  acceptHouseholdInvite: async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/household/accept`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to accept invite');
    }
    return payload as { householdId: string };
  },

  leaveHousehold: async () => {
    const response = await fetch(`${API_BASE_URL}/household/leave`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to leave household');
    }
    return payload as { householdId: string | null };
  },

  cancelHouseholdInvite: async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/household/invite/cancel`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to cancel invite');
    }
    return payload as { token: string; status: string };
  },

  declineHouseholdInvite: async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/household/decline`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to decline invite');
    }
    return payload as { token: string; status: string };
  },
};
