import { useEffect, useRef } from "react";
import type { Candle } from "@/components/charts/TradingChart";

const BINANCE_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
]);

interface Options {
  symbol: string;
  interval: string;
  enabled: boolean;
  onCandle: (c: Candle, isFinal: boolean) => void;
  onTrade?: (price: number, ts: number) => void;
}

/**
 * Subscribes to Binance kline websocket and emits live candle updates.
 * Only enabled for crypto symbols. Auto-reconnects on disconnect.
 */
export function useBinanceKlineStream({ symbol, interval, enabled, onCandle, onTrade }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const tradeRafRef = useRef<number | null>(null);
  const pendingTradeRef = useRef<{ price: number; ts: number } | null>(null);
  const cbRef = useRef(onCandle);
  const tradeCbRef = useRef(onTrade);

  useEffect(() => {
    cbRef.current = onCandle;
  }, [onCandle]);

  useEffect(() => {
    tradeCbRef.current = onTrade;
  }, [onTrade]);

  useEffect(() => {
    if (!enabled || !symbol || !BINANCE_INTERVALS.has(interval)) return;

    let closed = false;
    const pair = `${symbol.toUpperCase()}USDT`.toLowerCase();
    const url = `wss://stream.binance.com:9443/stream?streams=${pair}@kline_${interval}/${pair}@aggTrade`;

    const emitTrade = (price: number, ts: number) => {
      if (!tradeCbRef.current || !Number.isFinite(price) || price <= 0) return;
      pendingTradeRef.current = { price, ts };
      if (tradeRafRef.current != null) return;
      tradeRafRef.current = window.requestAnimationFrame(() => {
        tradeRafRef.current = null;
        const tick = pendingTradeRef.current;
        pendingTradeRef.current = null;
        if (!closed && tick) tradeCbRef.current?.(tick.price, tick.ts);
      });
    };

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const data = msg.data ?? msg;
          if (data.e === "aggTrade" || data.stream?.includes("@aggTrade")) {
            emitTrade(parseFloat(data.p), Number(data.T ?? data.E ?? Date.now()));
            return;
          }
          const k = data.k;
          if (!k) return;
          const candle: Candle = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };
          cbRef.current(candle, !!k.x);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (closed) return;
        reconnectRef.current = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      if (tradeRafRef.current != null) window.cancelAnimationFrame(tradeRafRef.current);
      tradeRafRef.current = null;
      pendingTradeRef.current = null;
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, [symbol, interval, enabled]);
}
