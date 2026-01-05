import React, { useState } from 'react';
import { Asset, Ownership } from '../types';
import { Plus, Trash2, Edit2, X, Save, TrendingUp, Landmark, Car, Home, Briefcase, Users, User } from 'lucide-react';

interface AssetListProps {
  assets: Asset[];
  onSave: (asset: Asset) => void;
  onDelete: (id: string) => void;
  settings: UserSettings;
}

const AssetList: React.FC<AssetListProps> = ({ assets, onSave, onDelete, settings }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "value" | "category">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [formData, setFormData] = useState<Omit<Asset, 'id'>>({
    name: '',
    value: 0,
    category: 'Cash',
    owner: 'JOINT' as Ownership
  });

  const partnerFirstWord =
    settings.partnerName?.trim()?.split(/\s+/)[0] || 'Partner';
	
  const partnerPossessive = `${partnerFirstWord}'s`;

  const handleOpenModal = (asset?: Asset) => {
    if (asset) {
      setEditingId(asset.id);
      setFormData({
        name: asset.name,
        value: asset.value,
        category: asset.category,
        notes: asset.notes,
        owner: asset.owner || 'JOINT'
      });
    } else {
      setEditingId(null);
      setFormData({ name: '', value: 0, category: 'Cash', notes: '', owner: 'JOINT' });
    }
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      onSave({ ...formData, owner: formData.owner || 'JOINT', id: editingId });
    } else {
      const newAsset: Asset = {
        ...formData,
        owner: formData.owner || 'JOINT',
        id: Math.random().toString(36).substr(2, 9),
      };
      onSave(newAsset);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this asset?')) {
      onDelete(id);
    }
  };

  const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);

  const getOwnerIcon = (owner: Ownership | undefined) => {
    if (owner === 'USER') return <User size={14} className="text-indigo-500" />;
    if (owner === 'PARTNER') return <User size={14} className="text-pink-500" />;
    return <Users size={14} className="text-purple-500" />;
  };

  const getOwnerLabel = (owner: Ownership | undefined) => {
    if (owner === 'USER') return 'Me';
    if (owner === 'PARTNER') return partnerFirstWord;
    return 'Joint';
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Cash': return <TrendingUp size={16} className="text-green-500" />;
      case 'Real Estate': return <Home size={16} className="text-blue-500" />;
      case 'Vehicle': return <Car size={16} className="text-orange-500" />;
      case 'Investment': return <Briefcase size={16} className="text-purple-500" />;
      default: return <Landmark size={16} className="text-slate-500" />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-indigo-500 text-white rounded-lg">
          <Landmark size={20} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Assets</h1>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => handleOpenModal()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-medium shadow-sm flex items-center transition-colors"
          >
            <Plus size={18} className="mr-2" />
            Add
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Total Assets</h3>
          <p className="text-3xl font-extrabold text-slate-900 mt-1">${totalAssets.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th
                  className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => {
                    setSortBy("name");
                    setSortDir((d) =>
                      sortBy === "name" && d === "asc" ? "desc" : "asc"
                    );
                  }}
                >
                  <div className="flex items-center space-x-1">
                    <span>Asset Name</span>
                    {sortBy === "name" && (
                      <span className="text-[10px] text-slate-400">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none"
                  onClick={() => {
                    setSortBy("category");
                    setSortDir((d) =>
                      sortBy === "category" && d === "asc" ? "desc" : "asc"
                    );
                  }}
                >
                  <div className="flex items-center space-x-1">
                    <span>Category</span>
                    {sortBy === "category" && (
                      <span className="text-[10px] text-slate-400">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </th>
                <th
                  className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right cursor-pointer select-none"
                  onClick={() => {
                    setSortBy("value");
                    setSortDir((d) =>
                      sortBy === "value" && d === "asc" ? "desc" : "asc"
                    );
                  }}
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>Value</span>
                    {sortBy === "value" && (
                      <span className="text-[10px] text-slate-400">
                        {sortDir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                    No assets added yet.
                  </td>
                </tr>
              ) : (
                assets
                  .slice()
                  .sort((a, b) => {
                    const dir = sortDir === "asc" ? 1 : -1;
                    if (sortBy === "name") {
                      return a.name.localeCompare(b.name) * dir;
                    }
                    if (sortBy === "value") {
                      return (a.value - b.value) * dir;
                    }
                    if (sortBy === "category") {
                      return (a.category || "").localeCompare(b.category || "") * dir;
                    }
                    return 0;
                  })
                  .map(asset => (
                  <tr key={asset.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {asset.name}
                      <div className="flex items-center space-x-1 mt-1">
                        {getOwnerIcon(asset.owner)}
                        <span className="text-xs text-slate-500">{getOwnerLabel(asset.owner)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        {getCategoryIcon(asset.category)}
                        <span className="text-slate-700 text-sm">{asset.category}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-slate-900">
                      ${asset.value.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <button onClick={() => handleOpenModal(asset)} className="p-1.5 text-slate-400 hover:text-indigo-600 rounded hover:bg-indigo-50">
                          <Edit2 size={16} />
                        </button>
                        <button onClick={() => handleDelete(asset.id)} className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-900">{editingId ? 'Edit Asset' : 'Add New Asset'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Asset Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="e.g. Emergency Fund, Honda Civic"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Estimated Value ($)</label>
                <input 
                  required
                  type="number" 
                  min="0"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.value}
                  onChange={e => setFormData({...formData, value: parseFloat(e.target.value)})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <select 
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  value={formData.category}
                  onChange={e => setFormData({...formData, category: e.target.value as any})}
                >
                  <option value="Cash">Cash / Savings</option>
                  <option value="Investment">Investment</option>
                  <option value="Real Estate">Real Estate</option>
                  <option value="Vehicle">Vehicle</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Ownership Selector to mirror expenses/liabilities */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Asset Ownership</label>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, owner: 'USER' })}
                    className={`flex-1 py-2 text-xs font-medium rounded-md flex items-center justify-center space-x-1 transition-all ${formData.owner === 'USER' ? 'bg-white shadow text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <User size={14}/> <span>Me</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, owner: 'JOINT' })}
                    className={`flex-1 py-2 text-xs font-medium rounded-md flex items-center justify-center space-x-1 transition-all ${formData.owner === 'JOINT' || !formData.owner ? 'bg-white shadow text-purple-700' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <Users size={14}/> <span>Joint</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, owner: 'PARTNER' })}
                    className={`flex-1 py-2 text-xs font-medium rounded-md flex items-center justify-center space-x-1 transition-all ${formData.owner === 'PARTNER' ? 'bg-white shadow text-pink-700' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <User size={14}/> <span>{partnerFirstWord}</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 ml-1">
                  {formData.owner === 'USER' && "You own 100% of this asset."}
                  {formData.owner === 'PARTNER' && `${partnerFirstWord} owns 100% of this asset.`}
                  {(formData.owner === 'JOINT' || !formData.owner) && "Treat as shared between both of you."}
                </p>
              </div>

              <div className="pt-4 flex justify-end space-x-3">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md transition-colors flex items-center"
                >
                  <Save size={18} className="mr-2" />
                  Save Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetList;
