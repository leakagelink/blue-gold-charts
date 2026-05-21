/**
 * Structured logger for price-mode (live / edited / manual) DB writes & realtime events.
 *
 * - Console output is colorized + tagged so devs can filter by `[ModeEvent]` in DevTools.
 * - Events are kept in an in-memory ring buffer (last 500) and persisted to localStorage
 *   so the admin "Mode Events" console can render history across reloads.
 * - Subscribers (UI) get notified via an EventTarget for live streaming.
 * - Severity `warn` / `error` automatically marked as alerts.
 */

export type ModeEventLevel = "debug" | "info" | "warn" | "error";

export type ModeEventKind =
  | "db_update"        // a write was attempted/committed
  | "db_skip"          // a write was intentionally skipped (e.g. live feed sees edited row)
  | "db_guard_block"   // a write was blocked by a .neq/.eq guard (0 rows affected when expected)
  | "realtime_in"      // postgres_changes payload received
  | "mode_transition"  // price_mode changed (live↔edited, etc.)
  | "reset_to_live"    // broker reset edited→live
  | "manual_close"     // manual close path
  | "error";

export interface ModeEvent {
  id: string;
  ts: number;
  level: ModeEventLevel;
  kind: ModeEventKind;
  source: string;             // e.g. "Positions.tsx", "AdminTradeManagement.tsx"
  position_id?: string;
  symbol?: string;
  price_mode?: string | null;
  message: string;
  data?: Record<string, unknown>;
}

const STORAGE_KEY = "cgfx.modeEvents.v1";
const RING_SIZE = 500;
const target = new EventTarget();

const colorByLevel: Record<ModeEventLevel, string> = {
  debug: "color:#94a3b8",
  info:  "color:#34d399;font-weight:600",
  warn:  "color:#fbbf24;font-weight:600",
  error: "color:#f87171;font-weight:700",
};

let buffer: ModeEvent[] = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ModeEvent[];
    return Array.isArray(parsed) ? parsed.slice(-RING_SIZE) : [];
  } catch {
    return [];
  }
})();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-RING_SIZE)));
  } catch {
    /* quota — ignore */
  }
}

function emit(evt: ModeEvent) {
  buffer.push(evt);
  if (buffer.length > RING_SIZE) buffer = buffer.slice(-RING_SIZE);
  persist();
  target.dispatchEvent(new CustomEvent("mode-event", { detail: evt }));

  const tag = `%c[ModeEvent ${evt.level.toUpperCase()}] ${evt.kind}`;
  const args: unknown[] = [tag, colorByLevel[evt.level], evt.source, evt.message];
  if (evt.position_id) args.push({ position_id: evt.position_id, symbol: evt.symbol, price_mode: evt.price_mode });
  if (evt.data) args.push(evt.data);

  if (evt.level === "error") console.error(...args);
  else if (evt.level === "warn") console.warn(...args);
  else console.log(...args);
}

export const modeLogger = {
  log(input: Omit<ModeEvent, "id" | "ts">) {
    emit({
      id: crypto.randomUUID(),
      ts: Date.now(),
      ...input,
    });
  },
  debug(source: string, kind: ModeEventKind, message: string, extra: Partial<ModeEvent> = {}) {
    this.log({ level: "debug", source, kind, message, ...extra });
  },
  info(source: string, kind: ModeEventKind, message: string, extra: Partial<ModeEvent> = {}) {
    this.log({ level: "info", source, kind, message, ...extra });
  },
  warn(source: string, kind: ModeEventKind, message: string, extra: Partial<ModeEvent> = {}) {
    this.log({ level: "warn", source, kind, message, ...extra });
  },
  error(source: string, kind: ModeEventKind, message: string, extra: Partial<ModeEvent> = {}) {
    this.log({ level: "error", source, kind, message, ...extra });
  },
  list(): ModeEvent[] {
    return [...buffer];
  },
  clear() {
    buffer = [];
    persist();
    target.dispatchEvent(new CustomEvent("mode-event-clear"));
  },
  subscribe(cb: (evt: ModeEvent) => void): () => void {
    const handler = (e: Event) => cb((e as CustomEvent<ModeEvent>).detail);
    target.addEventListener("mode-event", handler);
    return () => target.removeEventListener("mode-event", handler);
  },
  subscribeClear(cb: () => void): () => void {
    const handler = () => cb();
    target.addEventListener("mode-event-clear", handler);
    return () => target.removeEventListener("mode-event-clear", handler);
  },
};

// Expose for ad-hoc DevTools inspection: window.__modeEvents.list()
if (typeof window !== "undefined") {
  (window as unknown as { __modeEvents: typeof modeLogger }).__modeEvents = modeLogger;
}
