
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { ScannerConfig } from '../types';
import { estimateBlockByTime } from '../utils';

interface Props {
  config: ScannerConfig;
  onUpdate: (newConfig: ScannerConfig) => void;
}

interface ReferencePoint {
  block: number;
  timestamp: number;
}

// Helper to get local ISO string for datetime-local input
const toLocalISO = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const SettingsTab: React.FC<Props> = ({ config, onUpdate }) => {
  const [formData, setFormData] = useState<ScannerConfig>(config);
  const [refPoint, setRefPoint] = useState<ReferencePoint | null>(null);
  const [loadingRef, setLoadingRef] = useState(false);
  const autoSyncInterval = useRef<number | null>(null);

  // Time states initialized to local time
  const [startTime, setStartTime] = useState<string>(() => {
    const d = new Date('2026-03-28T14:00:00Z'); // 22:00 Beijing
    return toLocalISO(d);
  });
  const [endTime, setEndTime] = useState<string>(() => {
    const d = new Date('2026-03-28T18:00:00Z'); // 02:00 Beijing (next day)
    return toLocalISO(d);
  });

  const setBeijingPreset = () => {
    const start = new Date('2026-03-28T14:00:00Z');
    const end = new Date('2026-03-28T18:00:00Z');
    setStartTime(toLocalISO(start));
    setEndTime(toLocalISO(end));
  };

  const fetchReference = useCallback(async () => {
    setLoadingRef(true);
    try {
      const provider = new ethers.JsonRpcProvider(formData.rpcUrl);
      const latestBlock = await provider.getBlock('latest');
      if (latestBlock) {
        setRefPoint({
          block: latestBlock.number,
          timestamp: Number(latestBlock.timestamp)
        });
      }
    } catch (e) {
      console.error("Failed to fetch reference block:", e);
    } finally {
      setLoadingRef(false);
    }
  }, [formData.rpcUrl]);

  // Periodic Auto-Sync (Every 15s)
  useEffect(() => {
    fetchReference();
    autoSyncInterval.current = window.setInterval(fetchReference, 15000);
    return () => {
      if (autoSyncInterval.current) clearInterval(autoSyncInterval.current);
    };
  }, [fetchReference]);

  // Sync blocks whenever time or reference point changes
  useEffect(() => {
    if (refPoint) {
      const startMs = new Date(startTime).getTime();
      const endMs = new Date(endTime).getTime();
      
      const newStartBlock = estimateBlockByTime(startMs, refPoint.block, refPoint.timestamp);
      const newEndBlock = estimateBlockByTime(endMs, refPoint.block, refPoint.timestamp);

      setFormData(prev => ({
        ...prev,
        startBlock: newStartBlock,
        endBlock: newEndBlock
      }));
    }
  }, [startTime, endTime, refPoint]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(formData);
    alert('Settings updated! The scanner will now use the calculated block range.');
  };

  const handleRpcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, rpcUrl: e.target.value }));
  };

  const handleChunkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, chunkSize: parseInt(e.target.value) || 1000 }));
  };

  const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, threshold: e.target.value }));
  };

  return (
    <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 shadow-xl max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8 border-b border-slate-700 pb-4">
        <div>
          <h3 className="text-xl font-bold flex items-center">
            <i className="fas fa-clock mr-2 text-blue-400"></i> Time-Based Range Config
          </h3>
          <div className="flex items-center gap-3 mt-1">
             <span className="flex items-center text-[10px] uppercase font-bold text-slate-500 tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mr-1.5"></span>
                Live Sync Active
             </span>
             {refPoint && (
               <span className="text-[10px] text-blue-400 font-mono">
                 Latest: #{refPoint.block.toLocaleString()}
               </span>
             )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={setBeijingPreset}
            className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-4 py-2 rounded-lg border border-blue-500/30 flex items-center transition-all active:scale-95"
          >
            <i className="fas fa-magic mr-2"></i>
            Beijing Target Preset
          </button>
          <button 
            onClick={fetchReference}
            disabled={loadingRef}
            className="text-xs bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg border border-slate-600 flex items-center transition-all active:scale-95 shadow-lg"
          >
            <i className={`fas fa-sync-alt mr-2 ${loadingRef ? 'animate-spin' : ''}`}></i>
            {loadingRef ? 'Syncing...' : 'Sync Reference'}
          </button>
        </div>
      </div>
      
      <div className="mb-6 flex items-center gap-4 text-xs font-mono text-slate-500 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          <span>Current Beijing Time: <span className="text-slate-300">{new Date(new Date().getTime() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19)}</span></span>
        </div>
        <div className="w-px h-4 bg-slate-700"></div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
          <span>Target Range: <span className="text-slate-300">03-28 22:00 to 03-29 02:00</span></span>
        </div>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
          {/* Start Time */}
          <div className="space-y-2">
            <div className="flex justify-between items-end px-1">
              <label className="text-sm font-semibold text-slate-300">Start Time</label>
              <span className="text-[11px] font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded border border-blue-400/20">
                Est. Block: <span className="font-bold">{formData.startBlock.toLocaleString()}</span>
              </span>
            </div>
            <div className="relative group">
               <input 
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full pl-4 pr-10 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-white appearance-none transition-all group-hover:border-slate-600"
              />
              <i className="fas fa-calendar absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none group-hover:text-slate-400 transition-colors"></i>
            </div>
          </div>

          {/* End Time */}
          <div className="space-y-2">
            <div className="flex justify-between items-end px-1">
              <label className="text-sm font-semibold text-slate-300">End Time</label>
              <span className="text-[11px] font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded border border-blue-400/20">
                Est. Block: <span className="font-bold">{formData.endBlock.toLocaleString()}</span>
              </span>
            </div>
            <div className="relative group">
              <input 
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full pl-4 pr-10 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-white appearance-none transition-all group-hover:border-slate-600"
              />
              <i className="fas fa-calendar absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none group-hover:text-slate-400 transition-colors"></i>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-300 px-1">RPC Endpoint</label>
            <input 
              name="rpcUrl"
              value={formData.rpcUrl}
              onChange={handleRpcChange}
              placeholder="https://polygon-rpc.com"
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-300 px-1">Min Swap Threshold (LGNS)</label>
            <input 
              name="threshold"
              value={formData.threshold}
              onChange={handleThresholdChange}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-300 px-1">Batch Chunk Size (Blocks)</label>
            <input 
              type="number"
              name="chunkSize"
              value={formData.chunkSize}
              onChange={handleChunkChange}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="p-5 bg-blue-900/20 border border-blue-800/50 rounded-xl text-sm text-blue-200">
          <div className="flex gap-4">
            <div className="bg-blue-600/20 w-10 h-10 rounded-full flex items-center justify-center shrink-0 border border-blue-500/30">
              <i className="fas fa-info-circle text-blue-400"></i>
            </div>
            <div>
              <p className="font-bold text-blue-300 mb-1">Blockchain Estimation Note</p>
              <p className="leading-relaxed opacity-90">
                Polygon block heights are estimated using a standard <strong className="text-white">2.0s interval</strong> relative to current network time. 
                Scanning duration: <strong className="text-white underline decoration-blue-500/50 underline-offset-4">
                  {formData.endBlock - formData.startBlock > 0 
                    ? `${(formData.endBlock - formData.startBlock).toLocaleString()} blocks` 
                    : 'Invalid Range'}
                </strong>.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <button 
            type="submit"
            className="w-full md:w-auto px-10 py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95 flex items-center justify-center gap-2"
          >
            <i className="fas fa-save"></i> Apply Config & Refresh Estimations
          </button>
        </div>
      </form>
    </div>
  );
};

export default SettingsTab;
