
import { ethers } from 'ethers';
import { 
  ScannerConfig, 
  SwapRecord, 
  SwapDirection 
} from '../types';
import { UNISWAP_V2_PAIR_ABI, ERC20_ABI, FALLBACK_RPC_URL } from '../constants';
import { dbService } from './db';

export class SwapScanner {
  private providers: ethers.JsonRpcProvider[];
  private activeProviderIndex: number = 0;
  private consecutiveFailures: number = 0;
  private config: ScannerConfig;
  private pairIface: ethers.Interface;
  private erc20Iface: ethers.Interface;
  private onLog?: (msg: string) => void;

  constructor(config: ScannerConfig, onLog?: (msg: string) => void) {
    this.config = config;
    this.onLog = onLog;
    // Initialize primary and fallback providers
    this.providers = [
      new ethers.JsonRpcProvider(config.rpcUrl),
      new ethers.JsonRpcProvider(FALLBACK_RPC_URL)
    ];
    this.pairIface = new ethers.Interface(UNISWAP_V2_PAIR_ABI);
    this.erc20Iface = new ethers.Interface(ERC20_ABI);
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private switchProvider() {
    this.activeProviderIndex = (this.activeProviderIndex + 1) % this.providers.length;
    const newUrl = this.activeProviderIndex === 0 ? this.config.rpcUrl : FALLBACK_RPC_URL;
    const msg = `🔄 Switched to ${this.activeProviderIndex === 0 ? 'Primary' : 'Fallback'} RPC: ${newUrl.substring(0, 30)}...`;
    console.warn(msg);
    this.onLog?.(msg);
    this.consecutiveFailures = 0; // Reset counter after switching
  }

  /**
   * Helper to fetch logs with retry logic and fallback provider switching
   */
  private async fetchLogsWithRetry(filter: any, maxRetries = 10): Promise<ethers.Log[]> {
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.providers[this.activeProviderIndex];
      
      try {
        const logs = await provider.getLogs(filter);
        this.consecutiveFailures = 0; // Success! Reset consecutive failure counter
        return logs;
      } catch (err: any) {
        lastError = err;
        this.consecutiveFailures++;
        
        const errMsg = err.message?.toLowerCase() || '';
        const isRetryable = 
          errMsg.includes('timeout') || 
          errMsg.includes('valid json') || 
          errMsg.includes('429') ||
          errMsg.includes('too many requests') ||
          err.code === -32002 ||
          err.code === 'UNSUPPORTED_OPERATION' ||
          err.code === 'SERVER_ERROR';

        // Requirement: Switch to backup after 5 consecutive failures
        if (this.consecutiveFailures >= 5) {
          this.switchProvider();
        }

        if (isRetryable && attempt < maxRetries - 1) {
          const delay = Math.pow(2, Math.min(attempt, 4) + 1) * 1000 + (Math.random() * 1000);
          const logMsg = `⚠️ RPC Error (${err.code || 'ERR'}). Failure #${this.consecutiveFailures}. Retrying in ${Math.round(delay)}ms...`;
          console.warn(logMsg);
          this.onLog?.(logMsg);
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async scanRange(
    onProgress: (current: number, found: number, logMsg?: string) => void,
    onComplete: () => void,
    onError: (err: string) => void,
    isCancelled: () => boolean
  ) {
    try {
      const start = this.config.startBlock;
      const end = this.config.endBlock;
      let totalFound = 0;

      for (let i = start; i <= end; i += this.config.chunkSize) {
        if (isCancelled()) break;

        const chunkEnd = Math.min(i + this.config.chunkSize - 1, end);
        let logs: ethers.Log[] = [];
        
        try {
          logs = await this.fetchLogsWithRetry({
            fromBlock: i,
            toBlock: chunkEnd,
            address: [
              this.config.pairAddress,
              this.config.token0.address,
              this.config.token1.address
            ]
          });
        } catch (err: any) {
          if (isCancelled()) break;
          onError(`Fatal RPC error at block ${i}: ${err.message || 'Unknown error'}`);
          return;
        }

        if (logs.length > 0) {
          const txGroups = new Map<string, ethers.Log[]>();
          const txBlocks = new Map<string, number>();

          for (const log of logs) {
            const hash = log.transactionHash;
            if (!txGroups.has(hash)) {
              txGroups.set(hash, []);
              txBlocks.set(hash, log.blockNumber);
            }
            txGroups.get(hash)!.push(log);
          }

          const newRecords: SwapRecord[] = [];

          for (const [txHash, txLogs] of txGroups.entries()) {
            const hasSwap = txLogs.some(l => 
              l.address.toLowerCase() === this.config.pairAddress.toLowerCase() &&
              l.topics[0] === this.pairIface.getEvent('Swap')?.topicHash
            );

            if (!hasSwap) continue;

            const addressStats = new Map<string, { deltaDai: bigint; deltaLgns: bigint }>();
            const getStat = (addr: string) => {
              const lower = addr.toLowerCase();
              if (!addressStats.has(lower)) {
                addressStats.set(lower, { deltaDai: 0n, deltaLgns: 0n });
              }
              return addressStats.get(lower)!;
            };

            for (const log of txLogs) {
              const addr = log.address.toLowerCase();
              if (addr === this.config.token0.address.toLowerCase() || 
                  addr === this.config.token1.address.toLowerCase()) {
                
                if (log.topics[0] === this.erc20Iface.getEvent('Transfer')?.topicHash) {
                  const parsed = this.erc20Iface.parseLog(log);
                  if (parsed) {
                    const [from, to, value] = parsed.args;
                    const val = BigInt(value);
                    const isDai = addr === this.config.token0.address.toLowerCase();

                    if (isDai) {
                      getStat(from).deltaDai -= val;
                      getStat(to).deltaDai += val;
                    } else {
                      getStat(from).deltaLgns -= val;
                      getStat(to).deltaLgns += val;
                    }
                  }
                }
              }
            }

            const threshold = ethers.parseUnits(this.config.threshold, this.config.token1.decimals);
            
            for (const [address, stats] of addressStats.entries()) {
              if (address === ethers.ZeroAddress.toLowerCase()) continue;
              if (address === this.config.pairAddress.toLowerCase()) continue;

              let type: SwapDirection | null = null;
              let lgnsAmt = 0n;
              let daiAmt = 0n;

              if (stats.deltaLgns > 0n && stats.deltaDai < 0n) {
                type = SwapDirection.BUY;
                lgnsAmt = stats.deltaLgns;
                daiAmt = -stats.deltaDai;
              } 
              else if (stats.deltaLgns < 0n && stats.deltaDai > 0n) {
                type = SwapDirection.SELL;
                lgnsAmt = -stats.deltaLgns;
                daiAmt = stats.deltaDai;
              }

              if (type && lgnsAmt >= threshold) {
                newRecords.push({
                  txHash,
                  blockNumber: txBlocks.get(txHash)!,
                  timestamp: Math.floor(Date.now() / 1000),
                  trader: address,
                  direction: type,
                  lgnsAmount: lgnsAmt.toString(),
                  daiAmount: daiAmt.toString()
                });
              }
            }
          }

          if (newRecords.length > 0) {
            await dbService.saveSwaps(newRecords);
            totalFound += newRecords.length;
          }
        }

        onProgress(chunkEnd, totalFound);
      }

      if (!isCancelled()) {
        onComplete();
      }
    } catch (error: any) {
      console.error("Scan error:", error);
      onError(error.message || 'Unknown scanning error');
    }
  }
}
