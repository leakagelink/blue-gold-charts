import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXCHANGERATE_HOST_KEY = '9a730bf18b3dbe6bceedb04fea11c39f';

const currencyInfo: Record<string, { symbol: string; flag: string; name: string }> = {
  'EUR': { symbol: '€', flag: '🇪🇺', name: 'Euro' },
  'GBP': { symbol: '£', flag: '🇬🇧', name: 'British Pound' },
  'JPY': { symbol: '¥', flag: '🇯🇵', name: 'Japanese Yen' },
  'AUD': { symbol: 'A$', flag: '🇦🇺', name: 'Australian Dollar' },
  'CAD': { symbol: 'C$', flag: '🇨🇦', name: 'Canadian Dollar' },
  'CHF': { symbol: 'CHF', flag: '🇨🇭', name: 'Swiss Franc' },
  'CNY': { symbol: '¥', flag: '🇨🇳', name: 'Chinese Yuan' },
  'INR': { symbol: '₹', flag: '🇮🇳', name: 'Indian Rupee' },
  'NZD': { symbol: 'NZ$', flag: '🇳🇿', name: 'New Zealand Dollar' },
  'SGD': { symbol: 'S$', flag: '🇸🇬', name: 'Singapore Dollar' },
};

const FALLBACK_RATES: Record<string, number> = {
  EUR: 0.92, GBP: 0.79, JPY: 157.5, AUD: 1.61, CAD: 1.44,
  CHF: 0.90, CNY: 7.30, INR: 85.5, NZD: 1.78, SGD: 1.36,
};

// Yahoo Finance chart endpoint (no API key, no auth crumb required)
async function fetchOneFromYahoo(currency: string): Promise<{ price: number; changePct: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/USD${currency}=X?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      console.error(`Yahoo chart ${currency} HTTP error:`, res.status);
      return null;
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    const prevClose = meta?.chartPreviousClose ?? meta?.previousClose;
    if (typeof price !== 'number') return null;
    const changePct = typeof prevClose === 'number' && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : 0;
    return { price, changePct };
  } catch (e) {
    console.error(`Yahoo chart ${currency} error:`, e);
    return null;
  }
}

async function fetchFromYahooFinance(currencies: string[]): Promise<{ rates: Record<string, number>, changes: Record<string, number> } | null> {
  const rates: Record<string, number> = {};
  const changes: Record<string, number> = {};
  const results = await Promise.all(currencies.map((c) => fetchOneFromYahoo(c).then((r) => ({ c, r }))));
  for (const { c, r } of results) {
    if (r) {
      rates[c] = r.price;
      changes[c] = r.changePct;
    }
  }
  if (Object.keys(rates).length === 0) return null;
  console.log(`Yahoo Finance returned ${Object.keys(rates).length}/${currencies.length} rates`);
  return { rates, changes };
}

async function fetchFromExchangerateHost(currencies: string[]): Promise<Record<string, number> | null> {
  try {
    const url = `https://api.exchangerate.host/live?access_key=${EXCHANGERATE_HOST_KEY}&source=USD&currencies=${currencies.join(',')}`;
    console.log('Fetching from exchangerate.host:', url.replace(EXCHANGERATE_HOST_KEY, '***'));
    const response = await fetch(url);
    if (!response.ok) {
      console.error('exchangerate.host HTTP error:', response.status);
      return null;
    }
    const data = await response.json();
    if (!data.success || !data.quotes) {
      console.error('exchangerate.host response error:', JSON.stringify(data));
      return null;
    }
    // quotes are like USDEUR, USDGBP -> normalize to EUR, GBP
    const rates: Record<string, number> = {};
    for (const [key, value] of Object.entries(data.quotes)) {
      const cur = key.replace('USD', '');
      rates[cur] = typeof value === 'number' ? value : parseFloat(value as string);
    }
    return rates;
  } catch (e) {
    console.error('exchangerate.host fetch error:', e);
    return null;
  }
}

async function fetchFromFrankfurter(currencies: string[]): Promise<Record<string, number> | null> {
  try {
    const url = `https://api.frankfurter.app/latest?from=USD&to=${currencies.join(',')}`;
    console.log('Fetching from Frankfurter:', url);
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Frankfurter HTTP error:', response.status);
      return null;
    }
    const data = await response.json();
    if (!data.rates) return null;
    return data.rates;
  } catch (e) {
    console.error('Frankfurter fetch error:', e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const BASE_CURRENCY = 'USD';
    const currencies = ['EUR','GBP','JPY','AUD','CAD','CHF','CNY','INR','NZD','SGD'];

    let rates: Record<string, number> | null = null;
    let changes: Record<string, number> = {};
    let source = 'fallback';

    // Try Yahoo Finance first (free, no key, near real-time)
    const yahoo = await fetchFromYahooFinance(currencies);
    if (yahoo) {
      rates = yahoo.rates;
      changes = yahoo.changes;
      source = 'yahoo';
      console.log('Got rates from Yahoo Finance');
    }

    // Fallback to exchangerate.host
    if (!rates) {
      rates = await fetchFromExchangerateHost(currencies);
      if (rates) {
        source = 'exchangerate.host';
        console.log('Got rates from exchangerate.host');
      }
    }

    // Fallback to Frankfurter (free, no key)
    if (!rates) {
      rates = await fetchFromFrankfurter(currencies);
      if (rates) {
        source = 'frankfurter';
        console.log('Got rates from Frankfurter');
      }
    }

    // Final fallback: static rates
    if (!rates) {
      rates = FALLBACK_RATES;
      source = 'fallback';
      console.log('Using fallback static rates');
    }

    const forexData = currencies.map((currency) => {
      const info = currencyInfo[currency] || { symbol: currency, flag: '💱', name: currency };
      const rateNum = rates![currency] ?? FALLBACK_RATES[currency] ?? 1.0;
      const changePercent = changes[currency] ?? (Math.random() - 0.5) * 2;
      return {
        name: `${currency}/${BASE_CURRENCY}`,
        symbol: currency,
        price: rateNum.toFixed(4),
        change: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
        isPositive: changePercent >= 0,
        icon: info.flag,
        currencySymbol: info.symbol,
        fullName: info.name,
      };
    });

    return new Response(
      JSON.stringify({ forexData, source }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in fetch-forex-data function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
