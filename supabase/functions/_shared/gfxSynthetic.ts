// GrowFX in-house synthetic instruments — not available on TradingView/Binance/Yahoo.
// Three custom symbols: GFX (forex), GFXM (commodity), GFXC (crypto).
// Prices follow a deterministic multi-sine random-walk so all clients agree
// on the value at any given moment but the curve still feels alive.

export type GfxSymbol = "GFX" | "GFXM" | "GFXC";

const BASE: Record<GfxSymbol, number> = {
  GFX: 1.2500,    // 1 GFX ≈ $1.25
  GFXM: 2185.40,  // GFX Metal — gold-class price band
  GFXC: 128.55,   // GFX Coin
};
const VOL: Record<GfxSymbol, number> = {
  GFX: 0.006,
  GFXM: 0.018,
  GFXC: 0.045,
};

export const GFX_SYMBOLS: GfxSymbol[] = ["GFX", "GFXM", "GFXC"];

export function isGfxSymbol(sym: string): sym is GfxSymbol {
  const s = (sym || "").toUpperCase();
  return s === "GFX" || s === "GFXM" || s === "GFXC";
}

export function gfxPriceAt(symbol: GfxSymbol, tSec: number): number {
  const b = BASE[symbol];
  const v = VOL[symbol];
  const w =
    0.50 * Math.sin((tSec / 86400) * 0.7 + 0.31) + // slow daily drift
    0.30 * Math.sin(tSec / 3600 + 1.7) +           // hourly
    0.15 * Math.sin(tSec / 420 + 2.4) +            // ~7-min
    0.05 * Math.sin(tSec / 47 + 1.1);              // ~47s ticks
  return b * (1 + v * w);
}

export function gfxPriceNow(symbol: GfxSymbol): number {
  return gfxPriceAt(symbol, Math.floor(Date.now() / 1000));
}

export function gfxChangePct(symbol: GfxSymbol): number {
  const t = Math.floor(Date.now() / 1000);
  const p = gfxPriceAt(symbol, t);
  const p24 = gfxPriceAt(symbol, t - 86400);
  return ((p - p24) / p24) * 100;
}

export function gfx24hRange(symbol: GfxSymbol): { high: number; low: number } {
  const tNow = Math.floor(Date.now() / 1000);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i <= 96; i++) {
    const p = gfxPriceAt(symbol, tNow - i * 900);
    if (p > hi) hi = p;
    if (p < lo) lo = p;
  }
  return { high: hi, low: lo };
}

const INTERVAL_SEC: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400,
  "1d": 86400, "1w": 604800,
};

export type GfxCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function gfxCandles(symbol: GfxSymbol, interval: string, count = 100): GfxCandle[] {
  const sec = INTERVAL_SEC[interval] ?? 3600;
  const now = Math.floor(Date.now() / 1000);
  const lastBucket = Math.floor(now / sec) * sec;
  const out: GfxCandle[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = lastBucket - i * sec;
    const samples = 8;
    let open = 0;
    let close = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = 0; j < samples; j++) {
      const t = start + Math.floor((j / (samples - 1)) * sec);
      const p = gfxPriceAt(symbol, t);
      if (j === 0) open = p;
      if (j === samples - 1) close = p;
      if (p > hi) hi = p;
      if (p < lo) lo = p;
    }
    out.push({
      timestamp: start * 1000,
      open,
      high: hi,
      low: lo,
      close,
      volume: Math.floor(1000 + 500 * Math.abs(Math.sin(start / 1000))),
    });
  }
  return out;
}

export const GFX_META: Record<GfxSymbol, {
  name: string;
  fullName: string;
  flag: string;
  currencySymbol: string;
  logo: string;
  decimals: number;
}> = {
  GFX:  { name: "GFX/USD", fullName: "GrowFX Dollar", flag: "🏷️", currencySymbol: "$", logo: "", decimals: 4 },
  GFXM: { name: "GFXM",    fullName: "GrowFX Metal",  flag: "🪙", currencySymbol: "$", logo: "", decimals: 2 },
  GFXC: { name: "GFXC",    fullName: "GrowFX Coin",   flag: "💠", currencySymbol: "$", logo: "", decimals: 2 },
};
