
import React, { useState, useEffect } from 'react';
import { ScannerConfig, AggregatedStats } from './types.ts';
import { DEFAULT_CONFIG } from './constants.ts';
import { dbService } from './services/db.ts';
import { aggregateSwaps } from './utils.ts';

import ScannerTab from './components/ScannerTab.tsx';
import StatsTab from './components/StatsTab.tsx';
import SettingsTab from './components/SettingsTab.tsx';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'scan' | 'stats' | 'settings'>('scan');
  const [config, setConfig] = useState<ScannerConfig>(() => {
    const saved = localStorage.getItem('lgns_scanner_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });
  const [stats, setStats] = useState<AggregatedStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    localStorage.setItem('lgns_scanner_config', JSON.stringify(config));
  }, [config]);

  const refreshStats = async () => {
    setLoading(true);
    try {
      const allSwaps = await dbService.getAllSwaps();
      const aggregated = aggregateSwaps(allSwaps);
      setStats(aggregated);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshStats();
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
            <i className="fas fa-search-dollar text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">LGNS <span className="text-blue-500">Scanner</span></h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-tighter">Polygon Swap Analytics</p>
          </div>
        </div>

        <nav className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button 
            onClick={() => setActiveTab('scan')}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${activeTab === 'scan' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
          >
            Scanner
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${activeTab === 'stats' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
          >
            Statistics
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all ${activeTab === 'settings' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
          >
            Settings
          </button>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6">
        {activeTab === 'scan' && (
          <ScannerTab config={config} onRefreshStats={refreshStats} />
        )}
        
        {activeTab === 'stats' && (
          loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
              <p className="text-slate-500 text-sm font-medium">Aggregating trade data...</p>
            </div>
          ) : (
            <StatsTab stats={stats} config={config} />
          )
        )}

        {activeTab === 'settings' && (
          <SettingsTab config={config} onUpdate={setConfig} />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 px-6 py-8 text-center text-slate-500 text-sm">
        <p className="mb-4">&copy; 2024 LGNS Swap Analytics Tool. Fast & Secure Blockchain Scanning.</p>
        <div className="flex justify-center flex-wrap gap-4 text-[10px] font-bold uppercase tracking-widest">
          <span className="flex items-center px-3 py-1 bg-slate-800 rounded-full"><i className="fas fa-circle text-purple-500 text-[6px] mr-2"></i> Polygon Network</span>
          <span className="flex items-center px-3 py-1 bg-slate-800 rounded-full"><i className="fas fa-circle text-green-500 text-[6px] mr-2"></i> LGNS (9 Decimals)</span>
          <span className="flex items-center px-3 py-1 bg-slate-800 rounded-full"><i className="fas fa-circle text-yellow-500 text-[6px] mr-2"></i> DAI (18 Decimals)</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
