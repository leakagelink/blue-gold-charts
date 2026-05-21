import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const CHANNEL = "online-users";

/**
 * Joins the global presence channel and tracks the current user_id.
 * Call once at app root for any logged-in user.
 */
export const useTrackPresence = (userId: string | undefined) => {
  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel(CHANNEL, {
      config: { presence: { key: userId } },
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          user_id: userId,
          online_at: new Date().toISOString(),
        });
      }
    });

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        channel.track({
          user_id: userId,
          online_at: new Date().toISOString(),
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [userId]);
};

/**
 * Subscribes to the global presence channel and returns a Set of
 * currently online user_ids. Use in admin views.
 */
export const useOnlineUsers = () => {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    const channel = supabase.channel(CHANNEL);

    const sync = () => {
      const state = channel.presenceState<{ user_id: string }>();
      const ids = new Set<string>();
      Object.values(state).forEach((entries) => {
        entries.forEach((entry: any) => {
          if (entry?.user_id) ids.add(entry.user_id);
        });
      });
      setOnline(ids);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return online;
};
