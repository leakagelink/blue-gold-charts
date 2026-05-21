import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CryptoItem = {
  name: string;
  symbol: string;
  price: string;
  change: string;
  isPositive: boolean;
  logo: string;
  currencySymbol: string;
  high24h: string;
  low24h: string;
  id: string | number;
};

const LISTINGS_CACHE_DURATION_MS = 60000;
const QUOTES_CACHE_DURATION_MS = 3000;
const cacheStore = new Map<string, { data: { cryptoData: CryptoItem[] }; timestamp: number }>();

// Symbol -> {name, cmcId for logo}
const SYMBOL_META: Record<string, { name: string; id: number }> = {
  BTC: { name: 'Bitcoin', id: 1 },
  ETH: { name: 'Ethereum', id: 1027 },
  USDT: { name: 'Tether USDt', id: 825 },
  XRP: { name: 'XRP', id: 52 },
  BNB: { name: 'BNB', id: 1839 },
  SOL: { name: 'Solana', id: 5426 },
  USDC: { name: 'USDC', id: 3408 },
  DOGE: { name: 'Dogecoin', id: 74 },
  ADA: { name: 'Cardano', id: 2010 },
  TRX: { name: 'TRON', id: 1958 },
  LINK: { name: 'Chainlink', id: 1975 },
  AVAX: { name: 'Avalanche', id: 5805 },
  MATIC: { name: 'Polygon', id: 3890 },
  DOT: { name: 'Polkadot', id: 6636 },
  LTC: { name: 'Litecoin', id: 2 },
  BCH: { name: 'Bitcoin Cash', id: 1831 },
  SHIB: { name: 'Shiba Inu', id: 5994 },
  NEAR: { name: 'NEAR Protocol', id: 6535 },
  UNI: { name: 'Uniswap', id: 7083 },
  ATOM: { name: 'Cosmos', id: 3794 },
  XLM: { name: 'Stellar', id: 512 },
  ETC: { name: 'Ethereum Classic', id: 1321 },
  FIL: { name: 'Filecoin', id: 2280 },
  APT: { name: 'Aptos', id: 21794 },
  ARB: { name: 'Arbitrum', id: 11841 },
  OP: { name: 'Optimism', id: 11840 },
  PEPE: { name: 'Pepe', id: 24478 },
  SUI: { name: 'Sui', id: 20947 },
  TON: { name: 'Toncoin', id: 11419 },
  ICP: { name: 'Internet Computer', id: 8916 },
};

const TOP_SYMBOLS = ['BTC','ETH','USDT','XRP','BNB','SOL','USDC','DOGE','ADA','TRX','LINK','AVAX','DOT','LTC','BCH','SHIB','NEAR','UNI','ATOM','XLM'];

function fmt(n: number): string {
  if (!isFinite(n)) return '0';
  return n.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function normalizeRequestedSymbols(symbols: unknown): string[] {
  if (!Array.isArray(symbols)) return [];
  return Array.from(new Set(symbols.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean)));
}

function getCacheKey(symbols: string[]) {
  return symbols.length > 0 ? `quotes:${symbols.slice().sort().join(',')}` : 'listings:top20';
}

function getCachedPayload(cacheKey: string, ttl: number) {
  const cached = cacheStore.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > ttl) return null;
  return cached.data;
}

function setCachedPayload(cacheKey: string, data: { cryptoData: CryptoItem[] }) {
  cacheStore.set(cacheKey, { data, timestamp: Date.now() });
}

function transformBinanceTicker(ticker: any): CryptoItem | null {
  const rawSymbol = String(ticker?.symbol || '');
  if (!rawSymbol.endsWith('USDT')) return null;
  const symbol = rawSymbol.slice(0, -4);
  const meta = SYMBOL_META[symbol] || { name: symbol, id: 0 };
  const price = Number(ticker?.lastPrice || 0);
  const change = Number(ticker?.priceChangePercent || 0);
  const high = Number(ticker?.highPrice || 0);
  const low = Number(ticker?.lowPrice || 0);

  return {
    name: meta.name,
    symbol,
    price: fmt(price),
    change: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
    isPositive: change >= 0,
    logo: meta.id ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${meta.id}.png` : '',
    currencySymbol: '$',
    high24h: fmt(high || price),
    low24h: fmt(low || price),
    id: meta.id || symbol,
  };
}

async function fetchBinance(symbols: string[]): Promise<CryptoItem[]> {
  const apiKey = Deno.env.get('BINANCE_API_KEY');
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (apiKey) headers['X-MBX-APIKEY'] = apiKey;

  let url = 'https://api.binance.com/api/v3/ticker/24hr';
  if (symbols.length > 0) {
    const pairs = symbols.map((s) => `"${s}USDT"`).join(',');
    url += `?symbols=[${encodeURIComponent(pairs).replace(/%2C/g, ',')}]`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const list = Array.isArray(data) ? data : [data];

  if (symbols.length === 0) {
    // Filter to top symbols
    const wanted = new Set(TOP_SYMBOLS.map((s) => `${s}USDT`));
    return list
      .filter((t: any) => wanted.has(String(t?.symbol)))
      .map(transformBinanceTicker)
      .filter((x): x is CryptoItem => x !== null)
      .sort((a, b) => TOP_SYMBOLS.indexOf(a.symbol) - TOP_SYMBOLS.indexOf(b.symbol));
  }

  return list.map(transformBinanceTicker).filter((x): x is CryptoItem => x !== null);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let requestBody: any = {};
    if (req.method !== 'GET') {
      try { requestBody = await req.json(); } catch { requestBody = {}; }
    }

    const requestedSymbols = normalizeRequestedSymbols(requestBody?.symbols);
    const cacheKey = getCacheKey(requestedSymbols);
    const cacheTtl = requestedSymbols.length > 0 ? QUOTES_CACHE_DURATION_MS : LISTINGS_CACHE_DURATION_MS;

    const cached = getCachedPayload(cacheKey, cacheTtl);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    try {
      const cryptoData = await fetchBinance(requestedSymbols);
      const payload = { cryptoData };
      setCachedPayload(cacheKey, payload);
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (err) {
      console.error('Binance fetch failed:', err);
    }

    const stale = cacheStore.get(cacheKey)?.data;
    if (stale) {
      return new Response(JSON.stringify(stale), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    return new Response(JSON.stringify({ cryptoData: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in fetch-crypto-data function:', error);
    return new Response(JSON.stringify({ cryptoData: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});
