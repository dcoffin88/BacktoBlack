import React, { ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { PieChart, TrendingUp, LayoutDashboard, Settings, LogOut, DollarSign, Receipt, Landmark, Wallet, User, PanelLeftClose, PanelLeftOpen, Calculator } from 'lucide-react';
import { UserSettings } from '../types';

interface LayoutProps {
  children: ReactNode;
  userEmail: string;
  userName?: string;
  onLogout: () => void;
  settings?: UserSettings | null;
}

const Layout: React.FC<LayoutProps> = ({ children, userEmail, userName, onLogout, settings }) => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center ${collapsed ? 'justify-center space-x-0 px-2' : 'space-x-3 px-4'} py-3 rounded-lg transition-colors duration-200 ${
      isActive ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`;
  const displayName = userName || userEmail;
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const simple = settings?.useSimpleTerms;
  const expenseLabel = simple ? 'Bills' : 'Expenses';
  const liabilityLabel = simple ? 'Loans' : 'Liabilities';

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/budget', icon: Calculator, label: 'Budget' },
    { to: '/income', icon: Wallet, label: 'Income' },
    { to: '/liabilities', icon: DollarSign, label: liabilityLabel },
    { to: '/expenses', icon: Receipt, label: expenseLabel },
    { to: '/assets', icon: Landmark, label: 'Assets' },
    { to: '/strategy', icon: PieChart, label: 'Strategy Lab' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className={`bg-slate-900 text-white flex-shrink-0 flex flex-col transition-all duration-200 ${collapsed ? 'w-16' : 'w-full md:w-64'}`}>
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center space-x-2 overflow-hidden">
            <div className="p-2 bg-indigo-500 rounded-lg shrink-0">
              <TrendingUp size={24} className="text-white" />
            </div>
            {!collapsed && <span className="text-xl font-bold tracking-tight truncate">BacktoBlack</span>}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-slate-300 hover:text-white hover:bg-slate-800 rounded-full p-2 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className={`flex-1 px-4 space-y-2 mt-2 ${collapsed ? 'items-center' : ''}`}>
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={linkClass}
              title={collapsed ? label : undefined}
              aria-label={label}
            >
              <Icon size={20} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className={`flex items-center ${collapsed ? 'justify-center' : 'space-x-3'} mb-4 px-2 w-full text-left cursor-pointer hover:opacity-90`}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-xs font-bold">
              {avatarLetter}
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <p className="text-sm font-medium truncate">{displayName}</p>
                <p className="text-xs text-slate-400 truncate">{userEmail}</p>
              </div>
            )}
          </button>
          <button 
            onClick={onLogout}
            className={`w-full flex items-center justify-center space-x-2 bg-slate-800 cursor-pointer hover:bg-slate-700 py-2 rounded-md text-sm transition-colors text-slate-300 ${collapsed ? 'text-xs px-1' : ''}`}
          >
            <LogOut size={16} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto h-screen">
        <div className="p-6 md:p-10 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
