
import React, { useState, useMemo, useEffect } from 'react';
import { AggregatedStats, ScannerConfig } from '../types.ts';
import { formatAddress, formatTokenAmount, generateCSV, downloadFile } from '../utils.ts';

interface Props {
  stats: AggregatedStats[];
  config: ScannerConfig;
}

const PAGE_SIZE = 50;

const StatsTab: React.FC<Props> = ({ stats, config }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortField, setSortField] = useState<keyof AggregatedStats>('netLgns');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  // 1. 搜索防抖逻辑
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1); // 搜索时重置分页
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // 2. 全局统计汇总
  const globalSummary = useMemo(() => {
    const summary = {
      totalAddresses: stats.length,
      buyLgns: 0n, buyDai: 0n,
      sellLgns: 0n, sellDai: 0n,
      netLgns: 0n, netDai: 0n
    };

    for (let i = 0; i < stats.length; i++) {
      const curr = stats[i];
      summary.buyLgns += curr.totalBuyLgns;
      summary.buyDai += curr.totalBuyDai;
      summary.sellLgns += curr.totalSellLgns;
      summary.sellDai += curr.totalSellDai;
      summary.netLgns += curr.netLgns;
      summary.netDai += curr.netDai;
    }
    return summary;
  }, [stats]);

  // 3. 过滤与排序逻辑（核心计算优化）
  const filteredStats = useMemo(() => {
    let result = [...stats];
    
    if (debouncedSearch) {
      const lowerSearch = debouncedSearch.toLowerCase();
      result = result.filter(s => s.address.toLowerCase().includes(lowerSearch));
    }

    result.sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];

      if (typeof valA === 'bigint' && typeof valB === 'bigint') {
        const diff = valA - valB;
        if (diff === 0n) return 0;
        return sortDir === 'asc' ? (diff > 0n ? 1 : -1) : (diff < 0n ? 1 : -1);
      }
      
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDir === 'asc' ? valA - valB : valB - valA;
      }

      return 0;
    });

    return result;
  }, [stats, debouncedSearch, sortField, sortDir]);

  // 4. 分页切片
  const totalPages = Math.max(1, Math.ceil(filteredStats.length / PAGE_SIZE));
  const pagedStats = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredStats.slice(start, start + PAGE_SIZE);
  }, [filteredStats, currentPage]);

  const handleSort = (field: keyof AggregatedStats) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const handleExport = () => {
    setIsExporting(true);
    setTimeout(() => {
      try {
        const csv = generateCSV(filteredStats, config.token1.decimals, config.token0.decimals);
        downloadFile(csv, `lgns_stats_export_${Date.now()}.csv`, 'text/csv');
      } finally {
        setIsExporting(false);
      }
    }, 100);
  };

  return (
    <div className="space-y-8 animate-in">
      {/* 概览统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl shadow-xl hover:border-blue-500/50 transition-all group">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 group-hover:scale-110 transition-transform">
              <i className="fas fa-users"></i>
            </div>
            <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Total Traders</span>
          </div>
          <div className="text-3xl font-bold">{globalSummary.totalAddresses.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-2 font-mono">Unique Wallets Found</div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl shadow-xl hover:border-green-500/50 transition-all group">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-green-400 border border-green-500/20 group-hover:scale-110 transition-transform">
              <i className="fas fa-arrow-trend-up"></i>
            </div>
            <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Total Bought</span>
          </div>
          <div className="text-2xl font-bold text-green-400">
            {formatTokenAmount(globalSummary.buyLgns, config.token1.decimals)} <span className="text-xs opacity-50 font-normal">LGNS</span>
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono">Cost: {formatTokenAmount(globalSummary.buyDai, config.token0.decimals)} DAI</div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl shadow-xl hover:border-red-500/50 transition-all group">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-400 border border-red-500/20 group-hover:scale-110 transition-transform">
              <i className="fas fa-arrow-trend-down"></i>
            </div>
            <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Total Sold</span>
          </div>
          <div className="text-2xl font-bold text-red-400">
            {formatTokenAmount(globalSummary.sellLgns, config.token1.decimals)} <span className="text-xs opacity-50 font-normal">LGNS</span>
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono">Value: {formatTokenAmount(globalSummary.sellDai, config.token0.decimals)} DAI</div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl shadow-xl hover:border-purple-500/50 transition-all group">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/20 group-hover:scale-110 transition-transform">
              <i className="fas fa-balance-scale"></i>
            </div>
            <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">Net Supply Delta</span>
          </div>
          <div className={`text-2xl font-bold ${globalSummary.netLgns >= 0n ? 'text-green-400' : 'text-red-400'}`}>
            {globalSummary.netLgns > 0n ? '+' : ''}{formatTokenAmount(globalSummary.netLgns, config.token1.decimals)} <span className="text-xs opacity-50 font-normal">LGNS</span>
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono">Net DAI: {formatTokenAmount(globalSummary.netDai, config.token0.decimals)}</div>
        </div>
      </div>

      {/* 工具栏：搜索与导出 */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-800/30 p-4 rounded-xl border border-slate-700">
        <div className="relative w-full md:w-96 group">
          <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors"></i>
          <input 
            type="text" 
            placeholder="Search trader address (0x...)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-900/80 border border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600 font-mono text-sm"
          />
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <span className="text-[10px] text-slate-500 hidden sm:inline font-bold tracking-widest uppercase">
            {filteredStats.length.toLocaleString()} Wallets
          </span>
          <button 
            onClick={handleExport}
            disabled={isExporting || filteredStats.length === 0}
            className="w-full md:w-auto px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl font-bold flex items-center justify-center transition-all shadow-lg active:scale-95 text-sm"
          >
            {isExporting ? (
              <><i className="fas fa-circle-notch animate-spin mr-2"></i> Generating CSV...</>
            ) : (
              <><i className="fas fa-download mr-2"></i> Export Stats</>
            )}
          </button>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-900/80 text-slate-500 text-[10px] uppercase font-bold tracking-[0.15em]">
              <tr>
                <th className="px-6 py-5">Trader Address</th>
                <th className="px-6 py-5 cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => handleSort('totalBuyLgns')}>
                  Buy Volume {sortField === 'totalBuyLgns' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-6 py-5 cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => handleSort('totalSellLgns')}>
                  Sell Volume {sortField === 'totalSellLgns' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-6 py-5 cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => handleSort('netLgns')}>
                  Net LGNS {sortField === 'netLgns' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-6 py-5 text-center cursor-pointer hover:bg-slate-700 transition-colors" onClick={() => handleSort('txCount')}>
                  Txs {sortField === 'txCount' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {pagedStats.map((s) => (
                <tr key={s.address} className="hover:bg-slate-700/20 transition-all group">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="mono text-blue-400 font-bold text-sm">
                        {formatAddress(s.address)}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono mt-0.5 group-hover:text-slate-400 transition-colors">
                        {s.address}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-green-400 font-bold text-sm">+{formatTokenAmount(s.totalBuyLgns, config.token1.decimals)}</span>
                      <span className="text-[10px] text-slate-500 font-mono">-{formatTokenAmount(s.totalBuyDai, config.token0.decimals)} DAI</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-red-400 font-bold text-sm">-{formatTokenAmount(s.totalSellLgns, config.token1.decimals)}</span>
                      <span className="text-[10px] text-slate-500 font-mono">+{formatTokenAmount(s.totalSellDai, config.token0.decimals)} DAI</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className={`font-mono font-bold text-sm ${s.netLgns >= 0n ? 'text-green-400' : 'text-red-400'}`}>
                        {s.netLgns > 0n ? '+' : ''}{formatTokenAmount(s.netLgns, config.token1.decimals)}
                      </span>
                      <span className={`text-[10px] font-mono opacity-50 ${s.netDai >= 0n ? 'text-green-400' : 'text-red-400'}`}>
                        {s.netDai > 0n ? '+' : ''}{formatTokenAmount(s.netDai, config.token0.decimals)} DAI
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-block px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-[10px] font-bold text-slate-400 min-w-[30px]">
                      {s.txCount}
                    </span>
                  </td>
                </tr>
              ))}
              {pagedStats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-32 text-center">
                    <div className="flex flex-col items-center gap-4 text-slate-600">
                      <i className="fas fa-inbox text-6xl opacity-20"></i>
                      <p className="text-sm font-bold uppercase tracking-widest">No matching results</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 分页导航 */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-4 border-t border-slate-700/50">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Page <span className="text-blue-400">{currentPage}</span> of {totalPages}
          </div>
          <div className="flex gap-2">
            <button 
              disabled={currentPage === 1}
              onClick={() => { setCurrentPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-700 disabled:opacity-20 transition-all"
            >
              First
            </button>
            <button 
              disabled={currentPage === 1}
              onClick={() => { setCurrentPage(prev => prev - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-700 disabled:opacity-20 transition-all"
            >
              Prev
            </button>
            <button 
              disabled={currentPage === totalPages}
              onClick={() => { setCurrentPage(prev => prev + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-700 disabled:opacity-20 transition-all"
            >
              Next
            </button>
            <button 
              disabled={currentPage === totalPages}
              onClick={() => { setCurrentPage(totalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-700 disabled:opacity-20 transition-all"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatsTab;
