import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { dbAPI } from '../server/db';
import { Save, User, UserCog, Lock, AlertTriangle, CheckCircle } from 'lucide-react';

const Profile: React.FC = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  
  // Password states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await dbAPI.getProfile();
        setProfile(data);
        setName(data.name || '');
        setEmail(data.email);
      } catch (err) {
        setError('Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    try {
      await dbAPI.updateProfile({ name, email });
      setSuccessMsg('Profile updated successfully');
      setProfile(prev => prev ? { ...prev, name, email } : null);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match");
      return;
    }
    
    if (newPassword.length < 6) {
        setPasswordError("Password must be at least 6 characters");
        return;
    }

    try {
      await dbAPI.updatePassword(currentPassword, newPassword);
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password');
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading profile...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-indigo-500 text-white rounded-lg">
          <UserCog size={20} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Profile</h1>
        </div>
      </div>

      {/* Personal Info */}
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100">
        <div className="flex items-center space-x-2 mb-6 pb-4 border-b border-slate-100">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
            <User size={20} />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Personal Information</h2>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
            <input 
              type="text" 
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="e.g. John Doe"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">This name will be visible to your partner if accounts are linked.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input 
              type="email" 
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm flex items-center">
                <AlertTriangle size={16} className="mr-2" /> {error}
            </div>
          )}
          
          {successMsg && (
            <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm flex items-center">
                <CheckCircle size={16} className="mr-2" /> {successMsg}
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button 
              type="submit" 
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium shadow-sm flex items-center transition-colors"
            >
              <Save size={18} className="mr-2" />
              Save Changes
            </button>
          </div>
        </form>
      </div>

      {/* Password */}
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-100">
        <div className="flex items-center space-x-2 mb-6 pb-4 border-b border-slate-100">
          <div className="p-2 bg-slate-100 text-slate-600 rounded-lg">
            <Lock size={20} />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Security</h2>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
            <input 
              type="password" 
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <input 
                type="password" 
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input 
                type="password" 
                required
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                />
            </div>
          </div>

          {passwordError && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm flex items-center">
                <AlertTriangle size={16} className="mr-2" /> {passwordError}
            </div>
          )}
          
          {passwordSuccess && (
            <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm flex items-center">
                <CheckCircle size={16} className="mr-2" /> {passwordSuccess}
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button 
              type="submit" 
              className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-lg font-medium shadow-sm flex items-center transition-colors"
            >
              <Lock size={18} className="mr-2" />
              Update Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Profile;