import { useEffect, useState } from "react";
import { modeLogger, type ModeEvent } from "@/lib/modeEventLogger";

export function useModeEvents(maxBuffer = 500): ModeEvent[] {
  const [events, setEvents] = useState<ModeEvent[]>(() => modeLogger.list());

  useEffect(() => {
    const off = modeLogger.subscribe((evt) => {
      setEvents((prev) => {
        const next = [...prev, evt];
        return next.length > maxBuffer ? next.slice(-maxBuffer) : next;
      });
    });
    const offClear = modeLogger.subscribeClear(() => setEvents([]));
    return () => {
      off();
      offClear();
    };
  }, [maxBuffer]);

  return events;
}
