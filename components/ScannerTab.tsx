
import React, { useState, useRef, useEffect } from 'react';
import { ScannerConfig, ScanProgress } from '../types';
import { SwapScanner } from '../services/scanner';
import { dbService } from '../services/db';
import { calculateTargetBlocks } from '../utils';
import ConfirmModal from './ConfirmModal';

interface Props {
  config: ScannerConfig;
  onRefreshStats: () => void;
  onUpdateConfig: (newConfig: ScannerConfig) => void;
}

const ScannerTab: React.FC<Props> = ({ config, onRefreshStats, onUpdateConfig }) => {
  const [progress, setProgress] = useState<ScanProgress>({
    currentBlock: config.startBlock,
    startBlock: config.startBlock,
    endBlock: config.endBlock,
    isScanning: false,
    stats: { processedTxs: 0, foundSwaps: 0 }
  });
  
  const [logs, setLogs] = useState<string[]>([]);
  const logsRef = useRef<string[]>([]);
  const logUpdateTimerRef = useRef<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const isCancelledRef = useRef(false);

  // Buffer logs to prevent re-render storms
  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLog = `[${timestamp}] ${msg}`;
    logsRef.current = [newLog, ...logsRef.current].slice(0, 200);
    
    if (!logUpdateTimerRef.current) {
      logUpdateTimerRef.current = setTimeout(() => {
        setLogs([...logsRef.current]);
        logUpdateTimerRef.current = null;
      }, 500);
    }
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (logUpdateTimerRef.current) clearTimeout(logUpdateTimerRef.current);
    };
  }, []);

  // Sync progress state when config changes
  useEffect(() => {
    setProgress(p => ({
      ...p,
      currentBlock: config.startBlock,
      startBlock: config.startBlock,
      endBlock: config.endBlock
    }));
  }, [config.startBlock, config.endBlock]);

  const syncBlocks = async () => {
    setIsSyncing(true);
    addLog(`🔄 Syncing current block height for target range...`);
    try {
      const scanner = new SwapScanner(config);
      const latest = await scanner.getLatestBlock();
      const { startBlock, endBlock } = calculateTargetBlocks(latest.number, latest.timestamp);
      
      onUpdateConfig({
        ...config,
        startBlock,
        endBlock
      });
      
      addLog(`✅ Range synced: ${startBlock.toLocaleString()} to ${endBlock.toLocaleString()}`);
      addLog(`ℹ️ Based on latest block #${latest.number.toLocaleString()} at ${new Date(latest.timestamp * 1000).toLocaleTimeString()}`);
    } catch (e: any) {
      addLog(`❌ Sync failed: ${e.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const startScan = async (resumeFrom?: number) => {
    isCancelledRef.current = false;
    const isResume = typeof resumeFrom === 'number';

    if (!isResume) {
      await dbService.clearAll();
      onRefreshStats();
      addLog(`🗑️ Previous data cleared for new scan.`);
    }

    setProgress(p => ({ 
      ...p, 
      isScanning: true, 
      error: undefined,
      stats: isResume ? p.stats : { processedTxs: 0, foundSwaps: 0 }
    }));
    
    const actualStart = isResume ? resumeFrom : config.startBlock;
    const initialFound = isResume ? progress.stats.foundSwaps : 0;
    
    console.log(`ScannerTab: startScan called. isResume=${isResume}, resumeFrom=${resumeFrom}, actualStart=${actualStart}, initialFound=${initialFound}, chunkSize=${config.chunkSize}`);
    addLog(`🚀 ${isResume ? 'Resuming' : 'Starting'} scan from block ${actualStart} to ${config.endBlock} (Chunk Size: ${config.chunkSize})`);
    console.log(`ScannerTab: Calling scanRange with start=${actualStart}, end=${config.endBlock}`);

    const scanner = new SwapScanner(config, addLog);
    try {
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
      () => isCancelledRef.current,
      actualStart,
      initialFound
    );
    } catch (error: any) {
      console.error("Scan error caught in ScannerTab:", error);
      setProgress(p => ({ ...p, isScanning: false, error: error.message || 'Unknown scanning error' }));
      addLog(`❌ Error: ${error.message || 'Unknown error'}`);
    }
  };

  const stopScan = () => {
    isCancelledRef.current = true;
    addLog(`🛑 Stopping scan...`);
  };

  const clearDb = async () => {
    await dbService.clearAll();
    onRefreshStats();
    addLog(`🗑️ Database cleared.`);
  };

  const percent = Math.min(
    100,
    Math.max(0, ((progress.currentBlock - progress.startBlock) / (progress.endBlock - progress.startBlock)) * 100)
  );

  return (
    <div className="space-y-6">
      {progress.error && (
        <div className="bg-red-900/20 border border-red-800/50 p-4 rounded-xl flex items-center justify-between animate-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-600/20 rounded-full flex items-center justify-center text-red-400">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <div>
              <p className="text-sm font-bold text-red-300">Scanning Error</p>
              <p className="text-xs text-red-400/80">{progress.error}</p>
            </div>
          </div>
          <button 
            onClick={() => startScan(progress.currentBlock)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-bold transition-all shadow-lg shadow-red-600/20"
          >
            <i className="fas fa-redo mr-2"></i> Resume from Block {progress.currentBlock}
          </button>
        </div>
      )}

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
            <div className="text-slate-400 text-sm">Scan Range (Blocks)</div>
            <div className="text-xl font-bold font-mono">
              {progress.startBlock.toLocaleString()} <span className="text-slate-600 mx-1">→</span> {progress.endBlock.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500 mt-1 uppercase font-bold">
              Current: {progress.currentBlock.toLocaleString()}
            </div>
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
            <>
              <button 
                onClick={() => startScan()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold flex items-center transition-colors shadow-lg shadow-blue-500/20"
              >
                <i className="fas fa-play mr-2"></i> Start Scanning
              </button>
              <button 
                onClick={syncBlocks}
                disabled={isSyncing}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg font-semibold flex items-center transition-colors shadow-lg shadow-purple-500/20"
              >
                <i className={`fas fa-sync-alt mr-2 ${isSyncing ? 'animate-spin' : ''}`}></i>
                {isSyncing ? 'Syncing...' : 'Sync Target Range'}
              </button>
            </>
          ) : (
            <button 
              onClick={stopScan}
              className="px-6 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold flex items-center transition-colors shadow-lg shadow-red-500/20"
            >
              <i className="fas fa-stop mr-2"></i> Stop Scan
            </button>
          )}
          <button 
            onClick={() => setIsConfirmOpen(true)}
            disabled={progress.isScanning}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg font-semibold flex items-center transition-colors"
          >
            <i className="fas fa-trash-alt mr-2"></i> Clear History
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={isConfirmOpen}
        title="Clear Database"
        message="Are you sure you want to clear all stored records? This action cannot be undone."
        confirmText="Clear All"
        isDestructive={true}
        onConfirm={clearDb}
        onCancel={() => setIsConfirmOpen(false)}
      />

      <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Live Logs</h3>
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Auto-switching enabled</span>
        </div>
        <div className="p-4 h-64 overflow-y-auto mono text-xs space-y-1 bg-slate-950">
          {logs.length === 0 && <div className="text-slate-600">Waiting for activity...</div>}
          {logs.map((log, i) => (
            <div key={i} className="text-slate-300">
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScannerTab;
