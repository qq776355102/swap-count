
import { ethers } from 'ethers';
import { SwapRecord, AggregatedStats, SwapDirection } from './types';

export function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

/**
 * Formats a token amount to a fixed number of decimals
 * Uses toLocaleString for UI display (slightly slower but pretty)
 */
export function formatTokenAmount(amount: string | bigint, decimals: number, precision: number = 2): string {
  try {
    const formatted = ethers.formatUnits(amount, decimals);
    const num = parseFloat(formatted);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString(undefined, { 
      minimumFractionDigits: precision, 
      maximumFractionDigits: precision 
    });
  } catch (e) {
    return '0.00';
  }
}

/**
 * Fast formatting for CSV/Exports - avoids expensive toLocaleString
 */
export function formatTokenAmountSimple(amount: string | bigint, decimals: number): string {
  return ethers.formatUnits(amount, decimals);
}

/**
 * Estimates a block number based on a target timestamp, reference block, and block time.
 * Polygon average block time is approx 2.1s.
 */
export function estimateBlockByTime(
  targetTimestampMs: number,
  refBlock: number,
  refTimestampS: number,
  blockTimeS: number = 2.1
): number {
  const targetS = Math.floor(targetTimestampMs / 1000);
  const deltaS = targetS - refTimestampS;
  const deltaBlocks = Math.round(deltaS / blockTimeS);
  return refBlock + deltaBlocks;
}

/**
 * Specifically calculates the target range blocks based on current network state
 */
export function calculateTargetBlocks(
  currentBlock: number,
  currentTimestampS: number,
  blockTimeS: number = 2.1
) {
  // Target: 2026-03-28 22:00 Beijing (14:00 UTC) to 2026-03-29 02:00 Beijing (18:00 UTC)
  const targetStartS = Math.floor(new Date('2026-03-28T14:00:00Z').getTime() / 1000);
  const targetEndS = Math.floor(new Date('2026-03-28T18:00:00Z').getTime() / 1000);

  const startBlock = currentBlock - Math.round((currentTimestampS - targetStartS) / blockTimeS);
  const endBlock = currentBlock - Math.round((currentTimestampS - targetEndS) / blockTimeS);

  return { startBlock, endBlock };
}

export function aggregateSwaps(records: SwapRecord[]): AggregatedStats[] {
  const map = new Map<string, AggregatedStats>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const trader = r.trader.toLowerCase();
    
    let stat = map.get(trader);
    if (!stat) {
      stat = {
        address: trader,
        totalBuyLgns: 0n,
        totalBuyDai: 0n,
        totalSellLgns: 0n,
        totalSellDai: 0n,
        netLgns: 0n,
        netDai: 0n,
        txCount: 0
      };
      map.set(trader, stat);
    }

    const lgns = BigInt(r.lgnsAmount);
    const dai = BigInt(r.daiAmount);

    stat.txCount += 1;
    if (r.direction === SwapDirection.BUY) {
      stat.totalBuyLgns += lgns;
      stat.totalBuyDai += dai;
      stat.netLgns += lgns;
      stat.netDai -= dai;
    } else {
      stat.totalSellLgns += lgns;
      stat.totalSellDai += dai;
      stat.netLgns -= lgns;
      stat.netDai += dai;
    }
  }

  return Array.from(map.values());
}

/**
 * Optimized CSV Generation for large datasets
 */
export function generateCSV(stats: AggregatedStats[], lgnsDec: number, daiDec: number): string {
  const header = 'Address,Buy_LGNS,Buy_DAI,Sell_LGNS,Sell_DAI,Net_LGNS,Net_DAI,Tx_Count';
  const rows = new Array(stats.length);
  
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    rows[i] = [
      s.address,
      formatTokenAmountSimple(s.totalBuyLgns, lgnsDec),
      formatTokenAmountSimple(s.totalBuyDai, daiDec),
      formatTokenAmountSimple(s.totalSellLgns, lgnsDec),
      formatTokenAmountSimple(s.totalSellDai, daiDec),
      formatTokenAmountSimple(s.netLgns, lgnsDec),
      formatTokenAmountSimple(s.netDai, daiDec),
      s.txCount
    ].join(',');
  }
  
  return header + '\n' + rows.join('\n');
}

export function downloadFile(content: string, fileName: string, contentType: string) {
  const a = document.createElement('a');
  const file = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(file);
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
