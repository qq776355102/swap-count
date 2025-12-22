
import React, { useState, useRef, useEffect } from 'react';
import { ScannerConfig, ScanProgress } from '../types';
import { SwapScanner } from '../services/scanner';
import { dbService } from '../services/db';

interface Props {
  config: ScannerConfig;
  onRefreshStats: () => void;
}

const ScannerTab: React.FC<Props> = ({ config, onRefreshStats }) => {
  const [progress, setProgress] = useState<ScanProgress>({
    currentBlock: config.startBlock,
    startBlock: config.startBlock,
    endBlock: config.endBlock,
    isScanning: false,
    stats: { processedTxs: 0, foundSwaps: 0 }
  });
  
  const [logs, setLogs] = useState<string[]>([]);
  const isCancelledRef = useRef(false);

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 100)); // Increased log buffer for retry tracking
  };

  const startScan = async () => {
    isCancelledRef.current = false;
    setProgress(p => ({ ...p, isScanning: true, error: undefined }));
    addLog(`🚀 Starting scan from block ${config.startBlock} to ${config.endBlock}`);

    // Pass addLog to scanner to see retry/switch messages in the UI
    const scanner = new SwapScanner(config, addLog);
    await scanner.scanRange(
      (current, found) => {
        setProgress(p => ({
          ...p,
          currentBlock: current,
          stats: { ...p.stats, foundSwaps: found }
        }));
        addLog(`✅ Chunk processed up to ${current}. Found ${found} swaps so far.`);
      },
      () => {
        setProgress(p => ({ ...p, isScanning: false }));
        addLog(`🏁 Scan complete!`);
        onRefreshStats();
      },
      (err) => {
        setProgress(p => ({ ...p, isScanning: false, error: err }));
        addLog(`❌ Error: ${err}`);
      },
      () => isCancelledRef.current
    );
  };

  const stopScan = () => {
    isCancelledRef.current = true;
    addLog(`🛑 Stopping scan...`);
  };

  const clearDb = async () => {
    if (window.confirm('Are you sure you want to clear all stored records?')) {
      await dbService.clearAll();
      onRefreshStats();
      addLog(`🗑️ Database cleared.`);
    }
  };

  const percent = Math.min(
    100,
    Math.max(0, ((progress.currentBlock - progress.startBlock) / (progress.endBlock - progress.startBlock)) * 100)
  );

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
        <h3 className="text-xl font-bold mb-4 flex items-center">
          <i className="fas fa-radar mr-2 text-blue-400"></i> Scanner Status
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-sm">Progress</div>
            <div className="text-2xl font-bold">{percent.toFixed(2)}%</div>
          </div>
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-sm">Blocks</div>
            <div className="text-2xl font-bold">{progress.currentBlock.toLocaleString()} / {progress.endBlock.toLocaleString()}</div>
          </div>
          <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
            <div className="text-slate-400 text-sm">Swaps Identified</div>
            <div className="text-2xl font-bold text-green-400">{progress.stats.foundSwaps}</div>
          </div>
        </div>

        <div className="w-full bg-slate-700 h-4 rounded-full overflow-hidden mb-6">
          <div 
            className="bg-blue-500 h-full transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          ></div>
        </div>

        <div className="flex flex-wrap gap-4">
          {!progress.isScanning ? (
            <button 
              onClick={startScan}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold flex items-center transition-colors"
            >
              <i className="fas fa-play mr-2"></i> Start Scanning
            </button>
          ) : (
            <button 
              onClick={stopScan}
              className="px-6 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold flex items-center transition-colors"
            >
              <i className="fas fa-stop mr-2"></i> Stop Scan
            </button>
          )}
          <button 
            onClick={clearDb}
            disabled={progress.isScanning}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg font-semibold flex items-center transition-colors"
          >
            <i className="fas fa-trash-alt mr-2"></i> Clear History
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Live Logs</h3>
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Auto-switching enabled</span>
        </div>
        <div className="p-4 h-64 overflow-y-auto mono text-xs space-y-1 bg-slate-950">
          {logs.length === 0 && <div className="text-slate-600">Waiting for activity...</div>}
          {logs.map((log, i) => (
            <div key={i} className="text-slate-300">
              <span className="text-slate-500">[{new Date().toLocaleTimeString()}]</span> {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScannerTab;
