
export enum SwapDirection {
  BUY = 'buy',
  SELL = 'sell'
}

export interface SwapRecord {
  id?: number;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  trader: string;
  direction: SwapDirection;
  lgnsAmount: string; // Stored as string to handle BigInt
  daiAmount: string;
}

export interface AggregatedStats {
  address: string;
  totalBuyLgns: bigint;
  totalBuyDai: bigint;
  totalSellLgns: bigint;
  totalSellDai: bigint;
  netLgns: bigint;
  netDai: bigint;
  txCount: number;
}

export interface ScannerConfig {
  rpcUrl: string;
  startBlock: number;
  endBlock: number;
  chunkSize: number;
  threshold: string; // LGNS units
  pairAddress: string;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
}

export interface ScanProgress {
  currentBlock: number;
  startBlock: number;
  endBlock: number;
  isScanning: boolean;
  error?: string;
  stats: {
    processedTxs: number;
    foundSwaps: number;
  }
}
