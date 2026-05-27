import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { invokeForexData } from "@/lib/forexCache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, X, RefreshCcw, ArrowUp, ArrowDown, CheckCircle2, Loader2, History, Search, Filter } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import BottomNav from "@/components/BottomNav";
import { isCommoditySymbol, isForexSymbol } from "@/lib/marketSymbols";
import { modeLogger } from "@/lib/modeEventLogger";

interface Position {
  id: string;
  symbol: string;
  position_type: 'long' | 'short';
  amount: number;
  entry_price: number;
  current_price: number;
  leverage: number;
  margin: number;
  pnl: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at?: string;
  close_price?: number;
  price_mode?: string;
  stop_loss?: number | null;
  take_profit?: number | null;
}

const PRICE_POLL_INTERVAL_MS = 20;
const PRICE_FLASH_DURATION_MS = 1200;
const MARKET_SETTINGS_CACHE_MS = 30000;

const getEffectivePositionAmount = (position: Pick<Position, 'amount' | 'margin' | 'leverage' | 'entry_price'>) => {
  const rawAmount = Number(position.amount) || 0;
  const margin = Number(position.margin) || 0;
  const leverage = Number(position.leverage) || 0;
  const entryPrice = Number(position.entry_price) || 0;

  if (rawAmount <= 0) return 0;

  const inferredQuantity = margin > 0 && leverage > 0 && entryPrice > 0
    ? (margin * leverage) / entryPrice
    : 0;

  if (inferredQuantity > 0 && rawAmount > inferredQuantity * 20) {
    return inferredQuantity;
  }

  return rawAmount;
};

const formatMarketPrice = (value: number) => {
  const safeValue = Number(value) || 0;

  if (safeValue >= 1000) return safeValue.toFixed(2);
  if (safeValue >= 1) return safeValue.toFixed(4);
  if (safeValue >= 0.01) return safeValue.toFixed(6);
  return safeValue.toFixed(8);
};

const formatLivePnl = (value: number) => {
  const safeValue = Number(value) || 0;
  const absoluteValue = Math.abs(safeValue);

  if (absoluteValue >= 1) return safeValue.toFixed(2);
  if (absoluteValue >= 0.01) return safeValue.toFixed(4);
  return safeValue.toFixed(6);
};

const Positions = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"open" | "pending" | "closed">("open");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [closePositionId, setClosePositionId] = useState<string | null>(null);
  const [bulkClosing, setBulkClosing] = useState(false);
  const [closingPositionId, setClosingPositionId] = useState<string | null>(null);
  const [closedSuccessId, setClosedSuccessId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState<"all" | "long" | "short">("all");
  const [historyOutcome, setHistoryOutcome] = useState<"all" | "profit" | "loss">("all");
  const [historyRange, setHistoryRange] = useState<"all" | "today" | "7d" | "30d" | "90d">("all");
  const [historySortField, setHistorySortField] = useState<"date" | "symbol" | "pnl">("date");
  const [historySortDir, setHistorySortDir] = useState<"asc" | "desc">("desc");
  const [priceChanges, setPriceChanges] = useState<Record<string, { direction: 'up' | 'down' | 'none'; flash: boolean }>>({});
  const previousPricesRef = useRef<Record<string, number>>({});
  const positionsRef = useRef<Position[]>([]);
  // Store base PnL for edited trades (admin-set values that don't change)
  const basePnlRef = useRef<Record<string, number>>({});
  const isPriceUpdateInFlightRef = useRef(false);
  const marketMomentumSettingsRef = useRef({
    forexMomentumEnabled: true,
    commoditiesMomentumEnabled: true,
    fetchedAt: 0,
  });
  // Refs to track closing state without causing useEffect rerenders
  const closingIdRef = useRef<string | null>(null);
  const closedSuccessIdRef = useRef<string | null>(null);
  // Track permanently closed positions to prevent re-adding during price updates
  const permanentlyClosedIdsRef = useRef<Set<string>>(new Set());
  
  // Keep refs in sync with state
  useEffect(() => {
    positionsRef.current = openPositions;
    // Initialize basePnlRef for edited trades from database values
    openPositions.forEach(pos => {
      if (pos.price_mode === 'edited' && basePnlRef.current[pos.id] === undefined) {
        basePnlRef.current[pos.id] = pos.pnl || 0;
      }
    });
  }, [openPositions]);

  // Sync closing state refs
  useEffect(() => {
    closingIdRef.current = closingPositionId;
  }, [closingPositionId]);

  useEffect(() => {
    closedSuccessIdRef.current = closedSuccessId;
  }, [closedSuccessId]);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    fetchPositions();
  }, [user, navigate]);

  // Real-time price updates for open positions
  const hasOpenPositions = openPositions.length > 0;

  useEffect(() => {
    if (!user || !hasOpenPositions) return;

    const getMarketMomentumSettings = async () => {
      const now = Date.now();
      if (now - marketMomentumSettingsRef.current.fetchedAt < MARKET_SETTINGS_CACHE_MS) {
        return marketMomentumSettingsRef.current;
      }

      try {
        const { data: settingsData } = await supabase
          .from("payment_settings")
          .select("setting_key, setting_value")
          .in("setting_key", ["forex_momentum_enabled", "commodities_momentum_enabled"]);

        const nextSettings = {
          forexMomentumEnabled: true,
          commoditiesMomentumEnabled: true,
          fetchedAt: now,
        };

        if (settingsData) {
          settingsData.forEach((s) => {
            if (s.setting_key === "forex_momentum_enabled") nextSettings.forexMomentumEnabled = s.setting_value !== "false";
            if (s.setting_key === "commodities_momentum_enabled") nextSettings.commoditiesMomentumEnabled = s.setting_value !== "false";
          });
        }

        marketMomentumSettingsRef.current = nextSettings;
      } catch (err) {
        console.error("Error fetching momentum settings:", err);
      }

      return marketMomentumSettingsRef.current;
    };

    const updatePrices = async () => {
      if (isPriceUpdateInFlightRef.current) return;
      isPriceUpdateInFlightRef.current = true;

      try {
        const currentPositions = positionsRef.current.filter(
          (p) => p.status === "open" && !permanentlyClosedIdsRef.current.has(p.id)
        );

        if (currentPositions.length === 0) return;

        // Check if it's weekend (Saturday=6, Sunday=0)
        const today = new Date().getDay();
        const isWeekend = today === 0 || today === 6;

        const { forexMomentumEnabled, commoditiesMomentumEnabled } = await getMarketMomentumSettings();

        const livePositions = currentPositions.filter(
          (p) => p.price_mode !== "manual" && p.price_mode !== "edited"
        );

        const cryptoSymbols = Array.from(
          new Set(
            livePositions
              .filter((p) => !isForexSymbol(p.symbol) && !isCommoditySymbol(p.symbol))
              .map((p) => p.symbol.toUpperCase())
          )
        );

        const [cryptoResponse, forexResponse, commoditiesResponse] = await Promise.all([
          cryptoSymbols.length > 0
            ? supabase.functions.invoke("fetch-crypto-data", { body: { symbols: cryptoSymbols } })
            : Promise.resolve({ data: null, error: null }),
          livePositions.some((p) => isForexSymbol(p.symbol))
            ? invokeForexData()
            : Promise.resolve({ data: null, error: null }),
          livePositions.some((p) => isCommoditySymbol(p.symbol))
            ? supabase.functions.invoke("fetch-commodities-data")
            : Promise.resolve({ data: null, error: null }),
        ]);

        const cryptoPrices: Record<string, number> = {};
        if (!cryptoResponse.error && cryptoResponse.data?.cryptoData) {
          cryptoResponse.data.cryptoData.forEach((coin: any) => {
            if (coin.symbol && coin.price) {
              cryptoPrices[coin.symbol.toUpperCase()] = parseFloat(coin.price);
            }
          });
        }

        const forexPrices: Record<string, number> = {};
        if (!forexResponse.error && forexResponse.data?.forexData) {
          forexResponse.data.forexData.forEach((fx: any) => {
            const price = parseFloat(fx.price);
            if (Number.isNaN(price) || price <= 0) return;

            const symbolKey = (fx.symbol || "").toUpperCase();
            const nameKey = (fx.name || "").toUpperCase();
            if (symbolKey) forexPrices[symbolKey] = price;
            if (nameKey) forexPrices[nameKey] = price;
          });
        }

        const commodityPrices: Record<string, number> = {};
        if (!commoditiesResponse.error && commoditiesResponse.data?.commoditiesData) {
          commoditiesResponse.data.commoditiesData.forEach((commodity: any) => {
            const key = (commodity.symbol || "").toUpperCase();
            const price = parseFloat(commodity.price);
            if (key && !Number.isNaN(price) && price > 0) {
              commodityPrices[key] = price;
            }
          });
        }

        const autoCloseQueue: Array<{ position: Position; reason: "stop_loss" | "take_profit" | "liquidation" }> = [];

        const updatedPositions = currentPositions.map((position) => {
          let currentPrice = position.current_price;
          let pnl = position.pnl || 0;
          const quantity = getEffectivePositionAmount(position);
          const symbol = position.symbol.toUpperCase();
          const isForex = isForexSymbol(symbol);
          const isCommodity = isCommoditySymbol(symbol);

          const isMarketFrozen =
            (isForex && (isWeekend || !forexMomentumEnabled)) ||
            (isCommodity && (isWeekend || !commoditiesMomentumEnabled));

          if (position.price_mode === "edited") {
            // Edited trades are fully driven by server-side cron (drift_edited_positions)
            // and delivered via realtime. Skip live feed, skip client drift, skip DB write.
            // Track price-flash from DB-delivered current_price only.
            const prev = previousPricesRef.current[position.id];
            if (prev !== undefined && prev !== position.current_price) {
              const direction = position.current_price > prev ? "up" : "down";
              setPriceChanges((p) => ({ ...p, [position.id]: { direction, flash: true } }));
              setTimeout(() => {
                setPriceChanges((p) => ({ ...p, [position.id]: { ...p[position.id], flash: false } }));
              }, PRICE_FLASH_DURATION_MS);
            }
            previousPricesRef.current[position.id] = position.current_price;
            return { ...position };
          } else if (position.price_mode === "manual") {
            if (isMarketFrozen) {
              return { ...position };
            }

            const randomPercent = (Math.random() * 4 + 1) * (Math.random() > 0.5 ? 1 : -1);
            currentPrice = position.entry_price * (1 + randomPercent / 100);
          } else {
            if (isMarketFrozen) {
              return { ...position };
            }

            if (isForex) {
              currentPrice = forexPrices[symbol] || currentPrice;
            } else if (isCommodity) {
              currentPrice = commodityPrices[symbol] || currentPrice;
            } else {
              currentPrice = cryptoPrices[symbol] || currentPrice;
            }

            if (currentPrice <= 0) {
              return { ...position };
            }
          }

          const previousPrice = previousPricesRef.current[position.id];
          if (previousPrice !== undefined && previousPrice !== currentPrice) {
            const direction = currentPrice > previousPrice ? "up" : "down";
            setPriceChanges((prev) => ({ ...prev, [position.id]: { direction, flash: true } }));
            setTimeout(() => {
              setPriceChanges((prev) => ({ ...prev, [position.id]: { ...prev[position.id], flash: false } }));
            }, PRICE_FLASH_DURATION_MS);
          }
          previousPricesRef.current[position.id] = currentPrice;

          pnl =
            position.position_type === "long"
              ? (currentPrice - position.entry_price) * quantity
              : (position.entry_price - currentPrice) * quantity;

          if (position.stop_loss && !permanentlyClosedIdsRef.current.has(position.id)) {
            const hitStopLoss =
              (position.position_type === "long" && currentPrice <= position.stop_loss) ||
              (position.position_type === "short" && currentPrice >= position.stop_loss);
            if (hitStopLoss) {
              autoCloseQueue.push({ position: { ...position, current_price: currentPrice, pnl }, reason: "stop_loss" });
            }
          }

          if (position.take_profit && !permanentlyClosedIdsRef.current.has(position.id)) {
            const hitTakeProfit =
              (position.position_type === "long" && currentPrice >= position.take_profit) ||
              (position.position_type === "short" && currentPrice <= position.take_profit);
            if (hitTakeProfit) {
              autoCloseQueue.push({ position: { ...position, current_price: currentPrice, pnl }, reason: "take_profit" });
            }
          }

          // Auto-liquidation when loss reaches 100% of margin (PnL <= -margin)
          if (
            !permanentlyClosedIdsRef.current.has(position.id) &&
            position.margin > 0 &&
            pnl <= -Number(position.margin)
          ) {
            autoCloseQueue.push({ position: { ...position, current_price: currentPrice, pnl }, reason: "liquidation" });
          }

          if (position.price_mode !== "edited") {
            supabase
              .from("positions")
              .update({
                current_price: currentPrice,
                pnl,
                updated_at: new Date().toISOString(),
              }, { count: "exact" } as any)
              .eq("id", position.id)
              .eq("status", "open")
              .neq("price_mode", "edited")
              .then(({ error, count }) => {
                if (error) {
                  modeLogger.error("Positions.tsx/livefeed", "db_update",
                    `Live price write failed: ${error.message}`,
                    { position_id: position.id, symbol: position.symbol, price_mode: position.price_mode });
                  console.error("Error updating position:", error);
                } else if (count === 0) {
                  modeLogger.warn("Positions.tsx/livefeed", "db_guard_block",
                    `Live write blocked by guard (row likely flipped to edited)`,
                    { position_id: position.id, symbol: position.symbol, price_mode: position.price_mode });
                } else {
                  modeLogger.debug("Positions.tsx/livefeed", "db_update",
                    `Live price tick written`,
                    { position_id: position.id, symbol: position.symbol, price_mode: "live",
                      data: { current_price: currentPrice, pnl } });
                }
              });
          } else {
            modeLogger.debug("Positions.tsx/livefeed", "db_skip",
              `Skipped live write — row is in edited mode`,
              { position_id: position.id, symbol: position.symbol, price_mode: "edited" });
          }

          return {
            ...position,
            current_price: currentPrice,
            pnl,
          };
        });

        setOpenPositions(updatedPositions);

        autoCloseQueue.forEach(({ position, reason }) => {
          handleAutoClose(position, reason);
        });

        // Check and execute pending limit orders
        try {
          const { data: limitOrders } = await supabase
            .from('limit_orders')
            .select('*')
            .eq('user_id', user?.id)
            .eq('status', 'pending' as any);

          if (limitOrders && limitOrders.length > 0) {
            for (const order of limitOrders) {
              const sym = order.symbol.toUpperCase();
              const isForex = isForexSymbol(sym);
              const isCommodity = isCommoditySymbol(sym);
              
              let marketPrice = 0;
              if (isForex) {
                marketPrice = forexPrices[sym] || 0;
              } else if (isCommodity) {
                marketPrice = commodityPrices[sym] || 0;
              } else {
                marketPrice = cryptoPrices[sym] || 0;
              }

              if (marketPrice <= 0) continue;

              // Check if limit price is reached
              const shouldExecute = 
                (order.position_type === 'long' && marketPrice <= order.limit_price) ||
                (order.position_type === 'short' && marketPrice >= order.limit_price);

              if (shouldExecute) {
                await executeLimitOrder(order, marketPrice);
              }
            }
          }
        } catch (limitErr) {
          console.error('Error checking limit orders:', limitErr);
        }
      } catch (error) {
        console.error("Error updating position prices:", error);
      } finally {
        isPriceUpdateInFlightRef.current = false;
      }
    };

    updatePrices();
    const intervalId = setInterval(updatePrices, PRICE_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [user, hasOpenPositions]);

  // Fast MT5-style tick momentum for LIVE trades (visual only, no DB write)
  // Applies small random jitter (~1 point) every 350ms so prices visibly tick.
  useEffect(() => {
    if (!user || !hasOpenPositions) return;

    const tick = () => {
      const today = new Date().getDay();
      const isWeekend = today === 0 || today === 6;
      const { forexMomentumEnabled, commoditiesMomentumEnabled } = marketMomentumSettingsRef.current;

      setOpenPositions((prev) => {
        let mutated = false;
        const next = prev.map((position) => {
          if (position.status !== "open") return position;
          if (position.price_mode === "manual") return position;
          const symbol = position.symbol.toUpperCase();
          const isForex = isForexSymbol(symbol);
          const isCommodity = isCommoditySymbol(symbol);
          if ((isForex && (isWeekend || !forexMomentumEnabled)) ||
              (isCommodity && (isWeekend || !commoditiesMomentumEnabled))) {
            return position;
          }
          const base = Number(position.current_price) || 0;
          if (base <= 0) return position;

          // Jitter: ±0.015% around the API-anchored current price
          const jitterPct = (Math.random() * 2 - 1) * 0.00015;
          const newPrice = Math.max(0.0001, base * (1 + jitterPct));
          const quantity = getEffectivePositionAmount(position);
          const newPnl = position.position_type === "long"
            ? (newPrice - position.entry_price) * quantity
            : (position.entry_price - newPrice) * quantity;

          const prevPrice = previousPricesRef.current[position.id];
          if (prevPrice !== undefined && prevPrice !== newPrice) {
            const direction = newPrice > prevPrice ? "up" : "down";
            setPriceChanges((p) => ({ ...p, [position.id]: { direction, flash: true } }));
            setTimeout(() => {
              setPriceChanges((p) => ({ ...p, [position.id]: { ...p[position.id], flash: false } }));
            }, PRICE_FLASH_DURATION_MS);
          }
          previousPricesRef.current[position.id] = newPrice;
          mutated = true;
          return { ...position, current_price: newPrice, pnl: newPnl };
        });
        return mutated ? next : prev;
      });
    };

    const id = setInterval(tick, 350);
    return () => clearInterval(id);
  }, [user, hasOpenPositions]);

  // Subscribe to real-time updates for position changes (when admin edits a trade)
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('positions-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'positions',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const updatedPosition = payload.new as Position;
          const oldPosition = payload.old as Partial<Position> | undefined;
          modeLogger.info("Positions.tsx/realtime", "realtime_in",
            `Realtime UPDATE for ${updatedPosition.symbol} (status=${updatedPosition.status}, mode=${updatedPosition.price_mode})`,
            { position_id: updatedPosition.id, symbol: updatedPosition.symbol, price_mode: updatedPosition.price_mode,
              data: { status: updatedPosition.status, current_price: updatedPosition.current_price, pnl: updatedPosition.pnl } });

          if (oldPosition?.price_mode && oldPosition.price_mode !== updatedPosition.price_mode) {
            modeLogger.warn("Positions.tsx/realtime", "mode_transition",
              `${updatedPosition.symbol} ${oldPosition.price_mode} → ${updatedPosition.price_mode}`,
              { position_id: updatedPosition.id, symbol: updatedPosition.symbol, price_mode: updatedPosition.price_mode,
                data: { from: oldPosition.price_mode, to: updatedPosition.price_mode } });
          }

          console.log('Position updated via realtime:', updatedPosition.id, 'status:', updatedPosition.status, 'price_mode:', updatedPosition.price_mode);
          
          // If position was closed, move it from open to closed
          if (updatedPosition.status === 'closed') {
            // Remove from open positions
            setOpenPositions(prev => prev.filter(p => p.id !== updatedPosition.id));
            // Add to closed positions (avoid duplicates)
            setClosedPositions(prev => {
              const exists = prev.some(p => p.id === updatedPosition.id);
              if (exists) {
                return prev.map(p => p.id === updatedPosition.id ? updatedPosition : p);
              }
              return [updatedPosition, ...prev];
            });
            // Clean up refs
            delete previousPricesRef.current[updatedPosition.id];
            delete basePnlRef.current[updatedPosition.id];
            return;
          }
          
          // If admin edited this trade, update the basePnlRef with the new base value
          if (updatedPosition.price_mode === 'edited') {
            basePnlRef.current[updatedPosition.id] = updatedPosition.pnl || 0;
          }
          
          // Update the position in state with new data from database (only if still open)
          setOpenPositions(prev => 
            prev.map(p => 
              p.id === updatedPosition.id 
                ? { ...p, ...updatedPosition }
                : p
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Execute a limit order when price target is reached
  const executeLimitOrder = async (order: any, marketPrice: number) => {
    try {
      const entryPrice = order.limit_price;
      let usdAmount: number;
      let assetQuantity: number;
      let margin: number;

      if (order.input_mode === 'amount') {
        usdAmount = order.amount || 0;
        assetQuantity = usdAmount / entryPrice;
        margin = usdAmount / order.leverage;
      } else {
        assetQuantity = order.lot_size || 0;
        usdAmount = assetQuantity * entryPrice;
        margin = (assetQuantity * entryPrice) / order.leverage;
      }

      if (assetQuantity <= 0 || margin <= 0) return;

      // Check wallet balance
      const { data: wallet } = await supabase
        .from('user_wallets')
        .select('balance')
        .eq('user_id', order.user_id)
        .eq('currency', 'USD')
        .maybeSingle();

      const currentBalance = wallet?.balance || 0;
      if (currentBalance < margin) {
        // Mark as cancelled due to insufficient balance
        await supabase
          .from('limit_orders')
          .update({ status: 'cancelled' as any, updated_at: new Date().toISOString() })
          .eq('id', order.id);
        toast.error(`Limit order for ${order.symbol} cancelled - insufficient balance`);
        return;
      }

      // Deduct margin
      await supabase
        .from('user_wallets')
        .update({ balance: currentBalance - margin })
        .eq('user_id', order.user_id)
        .eq('currency', 'USD');

      // Check for existing position to average into
      const { data: existingPosition } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', order.user_id)
        .eq('symbol', order.symbol)
        .eq('position_type', order.position_type)
        .eq('status', 'open')
        .maybeSingle();

      if (existingPosition) {
        const oldAmount = Number(existingPosition.amount);
        const oldEntryPrice = Number(existingPosition.entry_price);
        const oldMargin = Number(existingPosition.margin);
        const newTotalAmount = oldAmount + assetQuantity;
        const newAvgEntryPrice = ((oldAmount * oldEntryPrice) + (assetQuantity * entryPrice)) / newTotalAmount;
        const newTotalMargin = oldMargin + margin;
        const newLeverage = Math.round((newTotalAmount * newAvgEntryPrice) / newTotalMargin);

        await supabase
          .from('positions')
          .update({
            amount: newTotalAmount,
            entry_price: newAvgEntryPrice,
            current_price: marketPrice,
            margin: newTotalMargin,
            leverage: newLeverage,
            stop_loss: order.stop_loss ?? existingPosition.stop_loss,
            take_profit: order.take_profit ?? existingPosition.take_profit,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPosition.id);
      } else {
        await supabase.from('positions').insert({
          user_id: order.user_id,
          symbol: order.symbol,
          position_type: order.position_type,
          amount: assetQuantity,
          entry_price: entryPrice,
          current_price: marketPrice,
          leverage: order.leverage,
          margin: margin,
          status: 'open',
          stop_loss: order.stop_loss,
          take_profit: order.take_profit,
        });
      }

      // Record transaction
      await supabase.from('wallet_transactions').insert({
        user_id: order.user_id,
        type: 'trade',
        amount: margin,
        currency: 'USD',
        status: 'Completed',
        reference_id: null,
      });

      // Mark limit order as executed
      await supabase
        .from('limit_orders')
        .update({ status: 'executed' as any, executed_at: new Date().toISOString() })
        .eq('id', order.id);

      toast.success(`Limit ${order.position_type === 'long' ? 'BUY' : 'SELL'} order executed! ${order.symbol} @ $${entryPrice.toFixed(2)}`);
      fetchPositions();
    } catch (error) {
      console.error('Error executing limit order:', error);
    }
  };

  // Monitor limit orders even when no open positions exist
  useEffect(() => {
    if (!user || hasOpenPositions) return;

    const checkLimitOrders = async () => {
      try {
        const { data: limitOrders } = await supabase
          .from('limit_orders')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'pending' as any);

        if (!limitOrders || limitOrders.length === 0) return;

        const symbols = Array.from(new Set(limitOrders.map(o => o.symbol.toUpperCase())));
        const cryptoSyms = symbols.filter(s => !isForexSymbol(s) && !isCommoditySymbol(s));

        const [cryptoRes, forexRes, commoditiesRes] = await Promise.all([
          cryptoSyms.length > 0
            ? supabase.functions.invoke('fetch-crypto-data', { body: { symbols: cryptoSyms } })
            : Promise.resolve({ data: null, error: null }),
          symbols.some(s => isForexSymbol(s))
            ? invokeForexData()
            : Promise.resolve({ data: null, error: null }),
          symbols.some(s => isCommoditySymbol(s))
            ? supabase.functions.invoke('fetch-commodities-data')
            : Promise.resolve({ data: null, error: null }),
        ]);

        const prices: Record<string, number> = {};
        if (cryptoRes.data?.cryptoData) {
          cryptoRes.data.cryptoData.forEach((c: any) => { if (c.symbol && c.price) prices[c.symbol.toUpperCase()] = parseFloat(c.price); });
        }
        if (forexRes.data?.forexData) {
          forexRes.data.forexData.forEach((f: any) => { const p = parseFloat(f.price); if (p > 0) { prices[(f.symbol || '').toUpperCase()] = p; prices[(f.name || '').toUpperCase()] = p; } });
        }
        if (commoditiesRes.data?.commoditiesData) {
          commoditiesRes.data.commoditiesData.forEach((c: any) => { const p = parseFloat(c.price); if (p > 0) prices[(c.symbol || '').toUpperCase()] = p; });
        }

        for (const order of limitOrders) {
          const mp = prices[order.symbol.toUpperCase()] || 0;
          if (mp <= 0) continue;
          const shouldExecute = 
            (order.position_type === 'long' && mp <= order.limit_price) ||
            (order.position_type === 'short' && mp >= order.limit_price);
          if (shouldExecute) {
            await executeLimitOrder(order, mp);
          }
        }
      } catch (err) {
        console.error('Error checking limit orders (no positions):', err);
      }
    };

    checkLimitOrders();
    const intervalId = setInterval(checkLimitOrders, 5000);
    return () => clearInterval(intervalId);
  }, [user, hasOpenPositions]);

  const fetchPositions = async () => {
    try {
      setLoading(true);
      
      const { data: open, error: openError } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', user?.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      const { data: closed, error: closedError } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', user?.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      const { data: pending } = await supabase
        .from('limit_orders')
        .select('*')
        .eq('user_id', user?.id)
        .eq('status', 'pending' as any)
        .order('created_at', { ascending: false });

      if (openError) throw openError;
      if (closedError) throw closedError;

      setOpenPositions(open || []);
      setClosedPositions(closed || []);
      setPendingOrders(pending || []);
    } catch (error) {
      console.error('Error fetching positions:', error);
      toast.error('Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  const handleClosePosition = async (position: Position) => {
    // Check if already permanently closed - prevent double close
    if (permanentlyClosedIdsRef.current.has(position.id)) {
      console.log('Position already closed, ignoring duplicate close request:', position.id);
      toast.info('This position has already been closed');
      setClosePositionId(null);
      return;
    }

    try {
      // IMMEDIATELY mark as permanently closed to prevent any re-adds
      permanentlyClosedIdsRef.current.add(position.id);
      
      // Start closing animation
      setClosingPositionId(position.id);
      
      // IMMEDIATELY remove from open positions state to prevent re-showing
      setOpenPositions(prev => prev.filter(p => p.id !== position.id));
      
      const closePrice = position.current_price;
      const quantity = getEffectivePositionAmount(position);
      const pnl = position.position_type === 'long' 
        ? (closePrice - position.entry_price) * quantity
        : (position.entry_price - closePrice) * quantity;

      const closedAt = new Date().toISOString();

      // Close position in database - use status check to prevent double close
      const { data: updateResult, error } = await supabase
        .from('positions')
        .update({
          status: 'closed',
          closed_at: closedAt,
          close_price: closePrice,
          pnl: pnl,
          closed_by: user?.id
        })
        .eq('id', position.id)
        .eq('status', 'open') // CRITICAL: Only update if still open
        .select();

      if (error) throw error;

      // Check if update actually happened (position was still open)
      if (!updateResult || updateResult.length === 0) {
        console.log('Position was already closed in database:', position.id);
        toast.info('Position was already closed');
        setClosingPositionId(null);
        setClosePositionId(null);
        return;
      }

      // Show success animation
      setClosingPositionId(null);
      setClosedSuccessId(position.id);

      // Wait for animation to complete before moving to closed
      await new Promise(resolve => setTimeout(resolve, 800));

      // Add to closed positions at the top
      const closedPosition: Position = {
        ...position,
        status: 'closed',
        closed_at: closedAt,
        close_price: closePrice,
        pnl: pnl
      };
      
      setClosedPositions(prev => {
        // Avoid duplicates
        if (prev.some(p => p.id === position.id)) {
          return prev;
        }
        return [closedPosition, ...prev];
      });
      
      // Clean up refs and animation state
      setClosedSuccessId(null);
      delete previousPricesRef.current[position.id];
      delete basePnlRef.current[position.id];

      // Get current wallet balance
      const { data: wallet, error: walletError } = await supabase
        .from('user_wallets')
        .select('balance')
        .eq('user_id', user?.id)
        .eq('currency', 'USD')
        .single();

      if (walletError) {
        console.error('Error fetching wallet:', walletError);
      } else {
        const currentBalance = wallet?.balance || 0;
        
        // Return margin + PnL to wallet
        const finalAmount = position.margin + pnl;
        const newBalance = currentBalance + finalAmount;

        await supabase
          .from('user_wallets')
          .update({ balance: newBalance })
          .eq('user_id', user?.id)
          .eq('currency', 'USD');

        // Record transaction
        await supabase.from('wallet_transactions').insert({
          user_id: user?.id,
          type: 'trade',
          amount: finalAmount,
          currency: 'USD',
          status: 'Completed',
          reference_id: position.id
        });
      }

      toast.success(`Position closed: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} PnL. Wallet updated with $${(position.margin + pnl).toFixed(2)}`);
      setClosePositionId(null);
    } catch (error) {
      console.error('Error closing position:', error);
      toast.error('Failed to close position');
      // Remove from permanently closed set if error occurred
      permanentlyClosedIdsRef.current.delete(position.id);
      setClosingPositionId(null);
      setClosedSuccessId(null);
    }
  };

  // Auto-close position when stop loss or take profit is triggered
  const handleAutoClose = async (position: Position, reason: 'stop_loss' | 'take_profit' | 'liquidation') => {
    // Check if already permanently closed - prevent double close
    if (permanentlyClosedIdsRef.current.has(position.id)) {
      return;
    }

    try {
      // IMMEDIATELY mark as permanently closed to prevent any re-adds
      permanentlyClosedIdsRef.current.add(position.id);
      
      // IMMEDIATELY remove from open positions state
      setOpenPositions(prev => prev.filter(p => p.id !== position.id));
      
      // Determine close price + final pnl based on trigger reason
      const closePrice = reason === 'stop_loss'
        ? (position.stop_loss || position.current_price)
        : reason === 'take_profit'
          ? (position.take_profit || position.current_price)
          : position.current_price; // liquidation closes at the price that hit -100%

      const quantity = getEffectivePositionAmount(position);
      const computedPnl = position.position_type === 'long'
        ? (closePrice - position.entry_price) * quantity
        : (position.entry_price - closePrice) * quantity;
      // On liquidation cap loss to exactly -margin (no over-loss into balance)
      const pnl = reason === 'liquidation'
        ? -Number(position.margin)
        : computedPnl;

      const closedAt = new Date().toISOString();

      // Close position in database - use status check to prevent double close
      const { data: updateResult, error } = await supabase
        .from('positions')
        .update({
          status: 'closed',
          closed_at: closedAt,
          close_price: closePrice,
          pnl: pnl,
          closed_by: user?.id
        })
        .eq('id', position.id)
        .eq('status', 'open')
        .select();

      if (error) throw error;

      // Check if update actually happened
      if (!updateResult || updateResult.length === 0) {
        return;
      }

      // Add to closed positions
      const closedPosition: Position = {
        ...position,
        status: 'closed',
        closed_at: closedAt,
        close_price: closePrice,
        pnl: pnl
      };
      
      setClosedPositions(prev => {
        if (prev.some(p => p.id === position.id)) {
          return prev;
        }
        return [closedPosition, ...prev];
      });
      
      // Clean up refs
      delete previousPricesRef.current[position.id];
      delete basePnlRef.current[position.id];

      // Get current wallet balance and update
      const { data: wallet, error: walletError } = await supabase
        .from('user_wallets')
        .select('balance')
        .eq('user_id', user?.id)
        .eq('currency', 'USD')
        .single();

      if (!walletError && wallet) {
        const currentBalance = wallet.balance || 0;
        const finalAmount = position.margin + pnl;
        const newBalance = currentBalance + finalAmount;

        await supabase
          .from('user_wallets')
          .update({ balance: newBalance })
          .eq('user_id', user?.id)
          .eq('currency', 'USD');

        // Record transaction
        await supabase.from('wallet_transactions').insert({
          user_id: user?.id,
          type: 'trade',
          amount: finalAmount,
          currency: 'USD',
          status: 'Completed',
          reference_id: position.id
        });
      }

      if (reason === 'stop_loss') {
        toast.warning(`⚠️ Stop Loss triggered for ${position.symbol}! Position closed at $${closePrice.toFixed(2)}. PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
      } else if (reason === 'liquidation') {
        toast.error(`💥 ${position.symbol} liquidated at $${closePrice.toFixed(2)} — loss reached 100% of margin. PnL: $${pnl.toFixed(2)}`);
      } else {
        toast.success(`🎯 Take Profit reached for ${position.symbol}! Position closed at $${closePrice.toFixed(2)}. PnL: +$${pnl.toFixed(2)}`);
      }
    } catch (error) {
      console.error(`Error auto-closing position on ${reason}:`, error);
      permanentlyClosedIdsRef.current.delete(position.id);
    }
  };

  const calculatePnL = (position: Position) => {
    if (position.status === 'closed') {
      return position.pnl || 0;
    }

    const quantity = getEffectivePositionAmount(position);
    if (position.position_type === 'long') {
      return (position.current_price - position.entry_price) * quantity;
    } else {
      return (position.entry_price - position.current_price) * quantity;
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const PositionCard = ({ position, showCloseButton = false, selectable = false }: { position: Position; showCloseButton?: boolean; selectable?: boolean }) => {
    const pnl = calculatePnL(position);
    const isProfit = pnl >= 0;
    const isLong = position.position_type === 'long';
    const priceChange = priceChanges[position.id];
    const isClosing = closingPositionId === position.id;
    const isClosedSuccess = closedSuccessId === position.id;
    const isSelected = selectedIds.has(position.id);
    const sideLabel = isLong ? 'BUY' : 'SELL';
    const sideColor = isLong ? 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10' : 'text-red-500 border-red-500/40 bg-red-500/10';
    const entry = formatMarketPrice(position.entry_price);
    const exit = formatMarketPrice(position.status === 'closed' ? (position.close_price ?? position.current_price) : position.current_price);
    const lot = (position.amount ?? 0) >= 1 ? Number(position.amount).toFixed(2) : Number(position.amount).toFixed(4);

    return (
      <div
        className={`relative px-2.5 py-2.5 sm:px-4 sm:py-3.5 border-b border-border/60 transition-all duration-300 ${
          isClosedSuccess ? 'scale-95 opacity-0' : ''
        } ${isClosing ? 'opacity-60' : ''} ${isSelected ? 'bg-primary/[0.04]' : 'bg-card hover:bg-muted/30'}`}
      >
        {isClosedSuccess && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/10 z-10 animate-fade-in rounded-lg">
            <div className="flex items-center gap-2 px-3 py-2 bg-card rounded-xl border border-emerald-500/40 shadow-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 animate-scale-in" />
              <span className="text-emerald-600 font-bold text-sm">Closed!</span>
            </div>
          </div>
        )}
        {isClosing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10 rounded-lg">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Checkbox */}
          {selectable && (
            <button
              onClick={() => toggleSelected(position.id)}
              className={`shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                isSelected
                  ? 'bg-[hsl(var(--gold))] border-[hsl(var(--gold))] text-gold-foreground'
                  : 'bg-card border-border hover:border-[hsl(var(--gold))]'
              }`}
              aria-label={isSelected ? 'Deselect' : 'Select'}
            >
              {isSelected && <CheckCircle2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" strokeWidth={3} />}
            </button>
          )}

          {/* Symbol + prices */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
              <h3 className="font-bold text-[13px] sm:text-base text-primary tracking-tight truncate max-w-[140px] sm:max-w-none">
                {position.symbol}
              </h3>
              <span className={`px-1.5 py-[1px] rounded-md text-[9px] sm:text-[10px] font-bold border ${sideColor}`}>
                {sideLabel}
              </span>
              <span className="text-[9px] font-bold text-muted-foreground bg-muted/60 px-1.5 py-[1px] rounded-md">
                {position.leverage}x
              </span>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-mono min-w-0">
              <span className="truncate">{entry}</span>
              {isLong ? (
                <ArrowUp className="h-3 w-3 text-emerald-500 shrink-0" strokeWidth={2.5} />
              ) : (
                <ArrowDown className="h-3 w-3 text-red-500 shrink-0" strokeWidth={2.5} />
              )}
              <span
                className={`transition-all px-1 rounded truncate ${
                  position.status !== 'closed' && priceChange?.flash
                    ? priceChange.direction === 'up'
                      ? 'bg-emerald-500/15 text-emerald-600'
                      : 'bg-red-500/15 text-red-500'
                    : ''
                }`}
              >
                {exit}
              </span>
            </div>
          </div>

          {/* Lot — hidden on very small screens to save space */}
          <div className="hidden xs:block text-center shrink-0 min-w-[38px] sm:min-w-[44px]">
            <p className="text-xs sm:text-sm font-bold text-primary tabular-nums">{lot}</p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">Lot</p>
          </div>

          {/* PnL */}
          <div className="text-right shrink-0 min-w-[64px] sm:min-w-[80px]">
            <p className={`text-sm sm:text-lg font-bold tabular-nums leading-tight ${isProfit ? 'text-emerald-600' : 'text-red-500'}`}>
              {isProfit ? '+' : ''}{formatLivePnl(pnl)}
            </p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold truncate">
              ${position.margin.toFixed(0)} margin
            </p>
          </div>

          {/* Close button (single) */}
          {showCloseButton && !selectable && !isClosing && !isClosedSuccess && (
            <button
              onClick={() => setClosePositionId(position.id)}
              className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted hover:bg-red-500/10 text-muted-foreground hover:text-red-500 flex items-center justify-center transition-colors"
              aria-label="Close position"
            >
              <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>

        {/* SL/TP strip */}
        {(position.stop_loss || position.take_profit) && (
          <div className="flex items-center gap-3 mt-2 pl-7 sm:pl-9 text-[10px] font-medium flex-wrap">
            {position.stop_loss && (
              <span className="flex items-center gap-1 text-red-500">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                SL ${formatMarketPrice(position.stop_loss)}
              </span>
            )}
            {position.take_profit && (
              <span className="flex items-center gap-1 text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                TP ${formatMarketPrice(position.take_profit)}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const PendingOrderRow = ({ order }: { order: any }) => {
    const isLong = order.position_type === 'long';
    const sideLabel = isLong ? 'BUY' : 'SELL';
    const sideColor = isLong ? 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10' : 'text-red-500 border-red-500/40 bg-red-500/10';
    return (
      <div className="px-2.5 py-2.5 sm:px-4 sm:py-3 border-b border-border/60 bg-card hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
              <h3 className="font-bold text-[13px] sm:text-base text-primary tracking-tight truncate max-w-[140px] sm:max-w-none">{order.symbol}</h3>
              <span className={`px-1.5 py-[1px] rounded-md text-[9px] sm:text-[10px] font-bold border ${sideColor}`}>{sideLabel}</span>
              <span className="text-[9px] font-bold text-muted-foreground bg-muted/60 px-1.5 py-[1px] rounded-md">{order.leverage}x</span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground font-mono truncate">
              Limit @ {formatMarketPrice(order.limit_price)}
            </p>
          </div>
          <div className="hidden xs:block text-center shrink-0 min-w-[38px] sm:min-w-[44px]">
            <p className="text-xs sm:text-sm font-bold text-primary tabular-nums">
              {order.lot_size ? Number(order.lot_size).toFixed(2) : Number(order.amount ?? 0).toFixed(2)}
            </p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
              {order.lot_size ? 'Lot' : 'Amt'}
            </p>
          </div>
          <div className="shrink-0">
            <span className="text-[9px] sm:text-[10px] font-bold uppercase text-[hsl(var(--gold))] bg-[hsl(var(--gold))]/10 px-1.5 sm:px-2 py-1 rounded-md">
              Pending
            </span>
          </div>
        </div>
      </div>
    );
  };

  const handleBulkClose = async () => {
    const targets = openPositions.filter(p => selectedIds.has(p.id));
    if (targets.length === 0) return;
    setBulkClosing(true);
    for (const p of targets) {
      // eslint-disable-next-line no-await-in-loop
      await handleClosePosition(p);
    }
    setSelectedIds(new Set());
    setBulkClosing(false);
  };



  // Derived totals
  const totalPnL = openPositions.reduce((sum, pos) => sum + calculatePnL(pos), 0);
  const totalMargin = openPositions.reduce((sum, pos) => sum + pos.margin, 0);
  const pnlPct = totalMargin > 0 ? (totalPnL / totalMargin) * 100 : 0;
  const totalIsProfit = totalPnL >= 0;

  const allSelected = openPositions.length > 0 && openPositions.every(p => selectedIds.has(p.id));
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(openPositions.map(p => p.id)));
  };

  // Closed-tab filtering
  const now = Date.now();
  const rangeMs: Record<string, number> = {
    today: 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  const filteredClosed = closedPositions.filter((p) => {
    if (historySearch && !p.symbol.toLowerCase().includes(historySearch.toLowerCase())) return false;
    if (historyType !== "all" && p.position_type !== historyType) return false;
    if (historyOutcome === "profit" && (p.pnl || 0) <= 0) return false;
    if (historyOutcome === "loss" && (p.pnl || 0) >= 0) return false;
    if (historyRange !== "all") {
      const closedAt = p.closed_at ? new Date(p.closed_at).getTime() : new Date(p.opened_at).getTime();
      if (now - closedAt > rangeMs[historyRange]) return false;
    }
    return true;
  });
  const sortedClosed = [...filteredClosed].sort((a, b) => {
    const dir = historySortDir === "asc" ? 1 : -1;
    if (historySortField === "date") {
      const aTime = new Date(a.closed_at || a.opened_at).getTime();
      const bTime = new Date(b.closed_at || b.opened_at).getTime();
      return (aTime - bTime) * dir;
    }
    if (historySortField === "symbol") return a.symbol.localeCompare(b.symbol) * dir;
    if (historySortField === "pnl") return ((Number(a.pnl) || 0) - (Number(b.pnl) || 0)) * dir;
    return 0;
  });
  const netClosedPnl = filteredClosed.reduce((s, p) => s + (Number(p.pnl) || 0), 0);

  const tabs: Array<{ id: "open" | "pending" | "closed"; label: string; count: number }> = [
    { id: "open", label: "Position", count: openPositions.length },
    { id: "pending", label: "Pending Order", count: pendingOrders.length },
    { id: "closed", label: "Closed", count: closedPositions.length },
  ];

  return (
    <div className="min-h-screen relative bg-background pb-32">
      {/* Header */}
      <header className="sticky top-0 z-50 h-16 bg-background border-b border-border">
        <div className="relative h-full flex items-center justify-between px-4 sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full hover:bg-primary/10 text-primary active:scale-90 transition-all"
            onClick={() => navigate("/dashboard")}
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
          </Button>
          <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-primary uppercase">
            My Positions
          </h1>
          <button
            onClick={fetchPositions}
            disabled={loading}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-[hsl(var(--gold))]/10 hover:bg-[hsl(var(--gold))]/20 active:scale-95 transition-all text-[hsl(var(--gold))] disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      <main className="relative z-10 animate-fade-in">
        {/* Compact portfolio strip (open tab only) */}
        {activeTab === "open" && openPositions.length > 0 && (
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-card border-b border-border flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Floating P&L</p>
              <p className={`text-lg sm:text-xl font-bold tabular-nums truncate ${totalIsProfit ? "text-emerald-600" : "text-red-500"}`}>
                {totalIsProfit ? "+" : ""}${totalPnL.toFixed(2)}
                <span className="ml-1.5 text-[11px] sm:text-xs font-semibold">
                  ({totalIsProfit ? "+" : ""}{pnlPct.toFixed(2)}%)
                </span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Margin</p>
              <p className="text-xs sm:text-sm font-bold text-primary tabular-nums">${totalMargin.toFixed(2)}</p>
            </div>
          </div>
        )}

        {/* Tabs - clean underline style */}
        <div className="sticky top-16 z-40 bg-background border-b border-border">
          <div className="flex items-center px-3">
            {tabs.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTab(t.id);
                    setSelectedIds(new Set());
                  }}
                  className={`relative flex-1 py-3 text-sm font-bold tracking-tight transition-colors ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span className={`ml-1 text-xs font-bold ${active ? "text-primary" : "text-muted-foreground"}`}>
                      ({t.count})
                    </span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-10 rounded-full bg-[hsl(var(--gold))]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Section toolbar */}
        {activeTab === "open" && openPositions.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 text-xs bg-muted/30 border-b border-border">
            <span className="font-semibold text-muted-foreground uppercase tracking-wide">All orders</span>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors font-semibold"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
          </div>
        )}

        {/* Open Positions */}
        {activeTab === "open" && (
          <div>
            {openPositions.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-muted-foreground text-sm">No open positions</p>
                <Button className="mt-4" onClick={() => navigate("/dashboard")}>
                  Start Trading
                </Button>
              </div>
            ) : (
              openPositions.map(position => (
                <PositionCard
                  key={position.id}
                  position={position}
                  showCloseButton={true}
                  selectable={true}
                />
              ))
            )}
          </div>
        )}

        {/* Pending Orders */}
        {activeTab === "pending" && (
          <div>
            {pendingOrders.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-muted-foreground text-sm">No pending orders</p>
              </div>
            ) : (
              pendingOrders.map(order => <PendingOrderRow key={order.id} order={order} />)
            )}
          </div>
        )}

        {/* Closed (with filters) */}
        {activeTab === "closed" && (
          <div>
            {/* Filter toggle bar */}
            <div className="flex items-center justify-between px-4 py-2.5 text-xs bg-muted/30 border-b border-border">
              <span className="font-semibold text-muted-foreground uppercase tracking-wide">
                {filteredClosed.length} trade{filteredClosed.length !== 1 ? "s" : ""}
                {filteredClosed.length > 0 && (
                  <span className={`ml-2 ${netClosedPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    Net {netClosedPnl >= 0 ? "+" : ""}${netClosedPnl.toFixed(2)}
                  </span>
                )}
              </span>
              <button
                onClick={() => setShowFilters(v => !v)}
                className={`flex items-center gap-1 font-bold transition-colors ${
                  showFilters ? "text-[hsl(var(--gold))]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Filter className="h-3.5 w-3.5" /> Filters
              </button>
            </div>

            {showFilters && (
              <div className="p-4 space-y-3 bg-card border-b border-border">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search symbol..."
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>
                  <Select value={historyType} onValueChange={(v: any) => setHistoryType(v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="long">Buy Only</SelectItem>
                      <SelectItem value="short">Sell Only</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={historyOutcome} onValueChange={(v: any) => setHistoryOutcome(v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Outcome" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Outcomes</SelectItem>
                      <SelectItem value="profit">Profit</SelectItem>
                      <SelectItem value="loss">Loss</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={historyRange} onValueChange={(v: any) => setHistoryRange(v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Date Range" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="today">Last 24 Hours</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(historySearch || historyType !== "all" || historyOutcome !== "all" || historyRange !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHistorySearch("");
                      setHistoryType("all");
                      setHistoryOutcome("all");
                      setHistoryRange("all");
                    }}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Clear filters
                  </Button>
                )}
              </div>
            )}

            {sortedClosed.length === 0 ? (
              <div className="p-10 text-center">
                <History className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No closed trades</p>
              </div>
            ) : (
              sortedClosed.map(position => <PositionCard key={position.id} position={position} />)
            )}
          </div>
        )}
      </main>

      {/* Sticky action bar (above BottomNav) — Position tab only */}
      {activeTab === "open" && openPositions.length > 0 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 bg-card border-t border-border shadow-[0_-4px_20px_-8px_hsl(220_30%_20%/0.15)]">
          <div className="flex items-center justify-between px-3 py-2.5 gap-2">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm font-bold text-primary px-2 py-1.5 rounded-lg hover:bg-primary/5 transition-colors"
            >
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                allSelected ? "bg-[hsl(var(--gold))] border-[hsl(var(--gold))]" : "border-border bg-card"
              }`}>
                {allSelected && <CheckCircle2 className="h-3 w-3 text-gold-foreground" strokeWidth={3} />}
              </span>
              Select All
            </button>

            <button
              onClick={() => setShowFilters(v => !v)}
              className="flex items-center gap-1.5 text-sm font-bold text-[hsl(var(--gold))] hover:bg-[hsl(var(--gold))]/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Filter className="h-4 w-4" /> Custom
            </button>

            <button
              onClick={handleBulkClose}
              disabled={selectedIds.size === 0 || bulkClosing}
              className="h-10 px-6 rounded-full bg-[hsl(var(--gold))] text-gold-foreground font-bold text-sm shadow-sm hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {bulkClosing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>Close{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Close Position Confirmation Dialog */}
      <AlertDialog open={!!closePositionId} onOpenChange={() => setClosePositionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Position?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close this position? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const position = openPositions.find(p => p.id === closePositionId);
                if (position) handleClosePosition(position);
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Close Position
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );

};

export default Positions;