
export const DEFAULT_CONFIG = {
  rpcUrl: 'https://pol79729.allnodes.me:8545/fiBUP22lpmCFIeuv',
  startBlock: 80648000, 
  endBlock: 80650000,
  chunkSize: 500,
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

export const FALLBACK_RPC_URL = 'https://dimensional-warmhearted-borough.matic.quiknode.pro/8d6b4c4e9e51944c650c74a447f3ae960c9f8cfe';

export const UNISWAP_V2_PAIR_ABI = [
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
];

export const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];
