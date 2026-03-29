
export const DEFAULT_CONFIG = {
  rpcUrl: 'https://api.zan.top/node/v1/polygon/mainnet/b4252a8bd2114d78982ec813c46a06eb',
  startBlock: 80637400, 
  endBlock: 80644600,
  chunkSize: 50,
  threshold: '1',
  pairAddress: '0x882df4B0fB50a229C3B4124EB18c759911485bFb',
  token0: {
    address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    symbol: 'DAI',
    decimals: 18
  },
  token1: {
    address: '0xeB51D9A39AD5EEF215dC0Bf39a8821ff804A0F01',
    symbol: 'LGNS',
    decimals: 9
  }
};

export const FALLBACK_RPC_URL = 'https://pol79729.allnodes.me:8545/fiBUP22lpmCFIeuv';

export const UNISWAP_V2_PAIR_ABI = [
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
];

export const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];
