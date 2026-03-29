
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

  /**
   * Helper to fetch logs with retry logic: 5 retries on Primary, then 5 retries on Fallback.
   * Total 12 attempts (1 initial + 5 retries per provider).
   */
  private async fetchLogsWithRetry(filter: any, isCancelled: () => boolean): Promise<ethers.Log[]> {
    let lastError: any;
    const retriesPerProvider = 5;
    const timeoutMs = 30000; // 30 seconds timeout for each request
    
    const swapTopic = this.pairIface.getEvent('Swap')?.topicHash;
    const transferTopic = this.erc20Iface.getEvent('Transfer')?.topicHash;
    
    // Optimize filter with topics if possible
    const optimizedFilter = {
      ...filter,
      topics: [[swapTopic, transferTopic]]
    };

    console.log(`🔍 fetchLogsWithRetry started for range ${filter.fromBlock}-${filter.toBlock}`);
    this.onLog?.(`🔍 Fetching logs for range ${filter.fromBlock}-${filter.toBlock}...`);

    for (let pIdx = 0; pIdx < this.providers.length; pIdx++) {
      const provider = this.providers[pIdx];
      const providerName = pIdx === 0 ? 'Primary' : 'Fallback';

      for (let attempt = 0; attempt <= retriesPerProvider; attempt++) {
        if (isCancelled()) throw new Error('Scan cancelled');

        try {
          const attemptMsg = `📡 [${providerName}] ${attempt === 0 ? 'Initial request' : 'Retry ' + attempt + '/5'} for blocks ${filter.fromBlock}-${filter.toBlock}...`;
          console.log(attemptMsg);
          this.onLog?.(attemptMsg);

          const startTime = Date.now();
          // Timeout wrapper
          const logs = await Promise.race([
            provider.getLogs(optimizedFilter),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Request timeout after 30s')), timeoutMs)
            )
          ]);
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          
          this.onLog?.(`✅ [${providerName}] Received ${logs.length} logs in ${duration}s`);
          this.consecutiveFailures = 0;
          return logs;
        } catch (err: any) {
          if (err.message === 'Scan cancelled') throw err;
          
          lastError = err;
          this.consecutiveFailures++;
          
          const isLastAttemptOverall = (pIdx === this.providers.length - 1) && (attempt === retriesPerProvider);
          
          if (!isLastAttemptOverall) {
            const delay = 20000; // 20 seconds
            const logMsg = `⚠️ [${providerName}] Attempt failed: ${err.message || 'Unknown error'}. Retrying in 20s...`;
            console.warn(logMsg);
            this.onLog?.(logMsg);
            
            // Check cancellation during sleep
            for (let s = 0; s < delay; s += 1000) {
              if (isCancelled()) throw new Error('Scan cancelled');
              await this.sleep(1000);
            }
            continue;
          }
        }
      }
    }
    throw lastError;
  }

  /**
   * Fetches the latest block number and timestamp with retry logic
   */
  async getLatestBlock(): Promise<{ number: number; timestamp: number }> {
    let lastError: any;
    const retriesPerProvider = 5;

    for (let pIdx = 0; pIdx < this.providers.length; pIdx++) {
      const provider = this.providers[pIdx];
      const providerName = pIdx === 0 ? 'Primary' : 'Fallback';

      for (let attempt = 1; attempt <= retriesPerProvider; attempt++) {
        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('RPC request timed out after 30s')), 30000);
          });

          const blockPromise = provider.getBlock('latest');
          const block = await Promise.race([blockPromise, timeoutPromise]) as any;

          if (!block) throw new Error('Failed to fetch latest block');
          return {
            number: block.number,
            timestamp: block.timestamp
          };
        } catch (err: any) {
          lastError = err;
          const logMsg = `⚠️ [${providerName}] getLatestBlock attempt ${attempt} failed: ${err.message || 'Unknown error'}`;
          console.warn(logMsg);
          this.onLog?.(logMsg);

          if (attempt < retriesPerProvider || pIdx < this.providers.length - 1) {
            this.onLog?.(`⏳ Waiting 20s before retry...`);
            await this.sleep(20000);
          }
        }
      }
    }
    throw lastError || new Error('All RPC providers failed to fetch latest block');
  }

  async scanRange(
    onProgress: (current: number, found: number, logMsg?: string) => void,
    onComplete: () => void,
    onError: (err: string) => void,
    isCancelled: () => boolean,
    startOverride?: number,
    initialFound: number = 0
  ) {
    try {
      const start = startOverride ?? this.config.startBlock;
      const end = this.config.endBlock;
      let totalFound = initialFound;
      
      const chunkSize = Math.max(1, this.config.chunkSize);
      
      console.log(`SwapScanner: scanRange starting. start=${start}, end=${end}, chunkSize=${chunkSize}`);
      this.onLog?.(`🔍 Scan loop starting: ${start} to ${end}`);

      for (let i = start; i <= end; i += chunkSize) {
        if (isCancelled()) {
          console.log("Scan cancelled by user");
          break;
        }

        const chunkEnd = Math.min(i + chunkSize - 1, end);
        console.log(`📦 Processing chunk: ${i} to ${chunkEnd}`);
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
          }, isCancelled);
        } catch (err: any) {
          if (isCancelled() || err.message === 'Scan cancelled') break;
          onError(`Fatal RPC error at block ${i}: ${err.message || 'Unknown error'}`);
          return;
        }

        if (logs.length > 0) {
          const startTime = Date.now();
          const swapTopic = this.pairIface.getEvent('Swap')?.topicHash;
          const pairAddr = this.config.pairAddress.toLowerCase();
          
          // 1. Identify transactions that have a Swap on our pair
          const swapTxHashes = new Set<string>();
          for (const log of logs) {
            if (log.address.toLowerCase() === pairAddr && log.topics[0] === swapTopic) {
              swapTxHashes.add(log.transactionHash);
            }
          }

          if (swapTxHashes.size === 0) {
            console.log(`ℹ️ No swaps found in ${logs.length} logs for blocks ${i}-${chunkEnd}`);
            onProgress(chunkEnd, totalFound);
            continue;
          }

          console.log(`🎯 Found ${swapTxHashes.size} swap transactions in ${logs.length} logs`);
          this.onLog?.(`🎯 Found ${swapTxHashes.size} swap transactions in this chunk...`);

          // 2. Group only logs belonging to these transactions
          const txGroups = new Map<string, ethers.Log[]>();
          const txBlocks = new Map<string, number>();

          for (const log of logs) {
            const hash = log.transactionHash;
            if (swapTxHashes.has(hash)) {
              if (!txGroups.has(hash)) {
                txGroups.set(hash, []);
                txBlocks.set(hash, log.blockNumber);
              }
              txGroups.get(hash)!.push(log);
            }
          }

          const newRecords: SwapRecord[] = [];
          let processedCount = 0;

          for (const [txHash, txLogs] of txGroups.entries()) {
            processedCount++;
            
            // Yield every 50 transactions to keep UI responsive
            if (processedCount % 50 === 0) {
              await this.sleep(0);
            }

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

          const processDuration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✨ Processed ${txGroups.size} transactions, found ${newRecords.length} swaps in ${processDuration}s`);

          if (newRecords.length > 0) {
            await dbService.saveSwaps(newRecords);
            totalFound += newRecords.length;
            this.onLog?.(`✨ Found ${newRecords.length} valid swaps in this chunk`);
          }
        }

        console.log(`Scanner: Calling onProgress with current=${chunkEnd}, found=${totalFound}`);
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
