import { ethers } from 'ethers';
import { 
  ScannerConfig, 
  SwapRecord, 
  SwapDirection 
} from '../types';
import { UNISWAP_V2_PAIR_ABI, ERC20_ABI, FALLBACK_RPC_URL } from '../constants';
import { dbService } from './db';

export class SwapScanner {
  private providers: ethers.JsonRpcProvider[] = [];
  private providerUrls: string[] = [];
  private consecutiveFailures: number = 0;
  private config: ScannerConfig;
  private pairIface: ethers.Interface;
  private erc20Iface: ethers.Interface;
  private onLog?: (msg: string) => void;

  constructor(config: ScannerConfig, onLog?: (msg: string) => void) {
    this.config = config;
    this.onLog = onLog;

    // Direct, dedicated full/archive nodes provided by the user (no pruning limits)
    const urls = [
      config.rpcUrl,
      FALLBACK_RPC_URL
    ];

    // Filter duplicates and invalid/empty URLs
    const uniqueUrls = Array.from(new Set(urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)));
    this.providerUrls = uniqueUrls;
    this.providers = uniqueUrls.map(url => new ethers.JsonRpcProvider(url));

    this.pairIface = new ethers.Interface(UNISWAP_V2_PAIR_ABI);
    this.erc20Iface = new ethers.Interface(ERC20_ABI);
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Helper to fetch logs with fast automatic failover across a pool of providers.
   * Uses a responsive 12-second timeout and immediately tries another provider if one fails or times out.
   */
  private async fetchLogsWithRetry(filter: any, isCancelled: () => boolean): Promise<ethers.Log[]> {
    const timeoutMs = 12000; // 12 seconds per call
    const swapTopic = this.pairIface.getEvent('Swap')?.topicHash;
    const transferTopic = this.erc20Iface.getEvent('Transfer')?.topicHash;
    
    // Optimize filter with topics if possible
    const optimizedFilter = {
      ...filter,
      topics: [[swapTopic, transferTopic]]
    };

    console.log(`🔍 fetchLogsWithRetry started for range ${filter.fromBlock}-${filter.toBlock}`);

    // Random start index to distribute query load across public RPCs
    const startIdx = Math.floor(Math.random() * this.providers.length);
    let attempts = 0;
    const maxTotalAttempts = this.providers.length * 2; // Each provider can be tried up to twice
    let lastError: any = new Error('No RPC provider succeeded');

    while (attempts < maxTotalAttempts) {
      if (isCancelled()) throw new Error('Scan cancelled');

      const pIdx = (startIdx + attempts) % this.providers.length;
      const provider = this.providers[pIdx];
      const providerUrl = this.providerUrls[pIdx];
      // Display friendly hostname in logs
      const providerName = providerUrl ? providerUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : `Provider-${pIdx + 1}`;

      let timeoutId: any;
      try {
        const attemptMsg = `📡 [${providerName}] Querying blocks ${filter.fromBlock}-${filter.toBlock} (Attempt ${attempts + 1}/${maxTotalAttempts})...`;
        console.log(attemptMsg);
        
        const startTime = Date.now();
        const logs = await Promise.race([
          provider.getLogs(optimizedFilter),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('RPC request timed out after 12s')), timeoutMs);
          })
        ]);
        clearTimeout(timeoutId);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        this.onLog?.(`✅ [${providerName}] Got ${logs.length} logs for blocks ${filter.fromBlock}-${filter.toBlock} in ${duration}s`);
        this.consecutiveFailures = 0;
        return logs;
      } catch (err: any) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err.message === 'Scan cancelled') throw err;

        lastError = err;
        this.consecutiveFailures++;
        attempts++;

        const errMsg = err.message || 'Unknown error';
        console.warn(`⚠️ [${providerName}] Failed for range ${filter.fromBlock}-${filter.toBlock}: ${errMsg}`);
        this.onLog?.(`⚠️ [${providerName}] Failed for ${filter.fromBlock}-${filter.toBlock}: ${errMsg}`);

        if (attempts < maxTotalAttempts) {
          // Responsive gap delay before hitting next provider
          await this.sleep(300);
        }
      }
    }
    throw lastError;
  }

  /**
   * Fetches the latest block number and timestamp with fast provider failover
   */
  async getLatestBlock(): Promise<{ number: number; timestamp: number }> {
    let lastError: any = new Error('All RPC providers failed');
    const timeoutMs = 12000;

    for (let pIdx = 0; pIdx < this.providers.length; pIdx++) {
      const provider = this.providers[pIdx];
      const providerUrl = this.providerUrls[pIdx];
      const providerName = providerUrl ? providerUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : `Provider-${pIdx + 1}`;

      try {
        let timeoutId: any;
        const block = await Promise.race([
          provider.getBlock('latest'),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('RPC request timed out after 12s')), timeoutMs);
          })
        ]) as any;
        clearTimeout(timeoutId);

        if (!block) throw new Error('Failed to fetch latest block');
        return {
          number: block.number,
          timestamp: block.timestamp
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ [${providerName}] getLatestBlock failed: ${err.message || 'Unknown error'}`);
        if (pIdx < this.providers.length - 1) {
          await this.sleep(300);
        }
      }
    }
    throw lastError;
  }

  /**
   * High performance concurrent block range scanner.
   * Processes multiple chunk ranges in parallel and maintains contiguous progress reporting.
   */
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
      this.onLog?.(`🚀 Starting fast parallel scan from block ${start} to ${end}`);

      // 1. Build list of total chunk ranges to process
      const chunks: { fromBlock: number; toBlock: number }[] = [];
      for (let i = start; i <= end; i += chunkSize) {
        chunks.push({
          fromBlock: i,
          toBlock: Math.min(i + chunkSize - 1, end)
        });
      }

      if (chunks.length === 0) {
        onComplete();
        return;
      }

      // Track contiguous completed blocks starting from the root start block
      const completedBlocks = new Set<number>();
      let furthestContiguousBlock = start - 1;

      const updateProgressTrack = (fromBlock: number, toBlock: number) => {
        completedBlocks.add(fromBlock);

        let temp = furthestContiguousBlock + 1;
        while (completedBlocks.has(temp)) {
          const chunk = chunks.find(c => c.fromBlock === temp);
          if (chunk) {
            furthestContiguousBlock = chunk.toBlock;
            temp = furthestContiguousBlock + 1;
          } else {
            break;
          }
        }
        return furthestContiguousBlock;
      };

      // Set parallel requests concurrency (e.g., 4 parallel streams)
      const CONCURRENCY = 4;
      let nextChunkIndex = 0;
      let hasError = false;
      let errorMsg = '';

      const processChunk = async (chunk: { fromBlock: number; toBlock: number }) => {
        let logs: ethers.Log[] = [];
        try {
          logs = await this.fetchLogsWithRetry({
            fromBlock: chunk.fromBlock,
            toBlock: chunk.toBlock,
            address: [
              this.config.pairAddress,
              this.config.token0.address,
              this.config.token1.address
            ]
          }, isCancelled);
        } catch (err: any) {
          if (isCancelled() || err.message === 'Scan cancelled') return;
          hasError = true;
          errorMsg = `Fatal RPC error at blocks ${chunk.fromBlock}-${chunk.toBlock}: ${err.message || 'Unknown error'}`;
          return;
        }

        if (isCancelled() || hasError) return;

        let foundInChunk = 0;
        if (logs.length > 0) {
          const startTime = Date.now();
          const swapTopic = this.pairIface.getEvent('Swap')?.topicHash;
          const pairAddr = this.config.pairAddress.toLowerCase();
          
          // Identify transactions that have a Swap on our pair
          const swapTxHashes = new Set<string>();
          for (const log of logs) {
            if (log.address.toLowerCase() === pairAddr && log.topics[0] === swapTopic) {
              swapTxHashes.add(log.transactionHash);
            }
          }

          if (swapTxHashes.size > 0) {
            // Group only logs belonging to these target transaction hashes
            const txGroups = new Map<string, ethers.Log[]>();
            const txBlocks = new Map<string, number>();

            let logCounter = 0;
            for (const log of logs) {
              logCounter++;
              if (logCounter % 500 === 0) {
                await this.sleep(1);
              }

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
            const addressStats = new Map<string, { deltaDai: bigint; deltaLgns: bigint }>();

            for (const [txHash, txLogs] of txGroups.entries()) {
              processedCount++;
              
              if (processedCount % 20 === 0) {
                await this.sleep(1);
              }
              
              if (isCancelled() || hasError) break;

              try {
                addressStats.clear();
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
              } catch (txErr) {
                console.error(`Error processing transaction ${txHash}:`, txErr);
              }
            }

            const processDuration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✨ Processed ${txGroups.size} transactions, found ${newRecords.length} swaps in ${processDuration}s`);

            if (newRecords.length > 0 && !isCancelled() && !hasError) {
              totalFound += newRecords.length;
              foundInChunk = newRecords.length;
              await dbService.saveSwaps(newRecords);
            }
          }
        }

        // Track and report continuous contiguous progress
        const nextContiguous = updateProgressTrack(chunk.fromBlock, chunk.toBlock);
        
        onProgress(
          Math.max(start, nextContiguous),
          totalFound,
          `✅ [Blocks ${chunk.fromBlock}-${chunk.toBlock}] finished. Found ${foundInChunk} valid swaps.`
        );
      };

      const worker = async () => {
        while (nextChunkIndex < chunks.length && !isCancelled() && !hasError) {
          const chunkIdx = nextChunkIndex++;
          const chunk = chunks[chunkIdx];
          
          try {
            await processChunk(chunk);
          } catch (err) {
            console.error('Parallel scan worker exception:', err);
          }
        }
      };

      // Create and wait for concurrent worker streams
      const numWorkers = Math.min(CONCURRENCY, chunks.length);
      const workerPromises = Array.from({ length: numWorkers }, worker);
      
      await Promise.all(workerPromises);

      if (hasError) {
        onError(errorMsg);
        return;
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
