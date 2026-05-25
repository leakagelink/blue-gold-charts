import { TrendingUp, Wallet, User, Layers, Newspaper, Zap } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { icon: TrendingUp, label: "Trade", path: "/dashboard" },
    { icon: Layers, label: "Positions", path: "/positions" },
    { icon: Zap, label: "Signals", path: "/signals" },
    { icon: Newspaper, label: "News", path: "/news" },
    { icon: Wallet, label: "Wallet", path: "/wallet" },
    { icon: User, label: "Profile", path: "/profile" },
  ];

  const activeIndex = navItems.findIndex((i) => i.path === location.pathname);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;

  // Animated sliding pill measurement
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = itemRefs.current[safeIndex];
      const container = containerRef.current;
      if (!el || !container) return;
      const elRect = el.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      setPill({ left: elRect.left - cRect.left, width: elRect.width });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [safeIndex, location.pathname]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-safe pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-7xl px-2 sm:px-4 pb-2 sm:pb-3">
        <div className="relative">
          {/* Gold accent top line */}
          <div className="absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-[hsl(var(--gold))]/70 to-transparent" />

          {/* Frosted glass dock */}
          <div className="absolute inset-0 rounded-2xl backdrop-blur-2xl bg-background/85 border border-border/60 shadow-[0_8px_32px_-12px_hsl(220_30%_20%/0.25)]" />

          {/* Sliding active pill */}
          {pill && (
            <span
              aria-hidden
              className="absolute top-1.5 bottom-1.5 rounded-xl bg-primary/10 border border-primary/30 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.4)]"
              style={{ left: pill.left + 4, width: pill.width - 8 }}
            />
          )}

          <div
            ref={containerRef}
            className="relative flex items-stretch justify-around h-16 px-1"
          >
            {navItems.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === safeIndex;

              return (
                <button
                  key={item.path}
                  ref={(el) => (itemRefs.current[idx] = el)}
                  onClick={() => navigate(item.path)}
                  className="relative flex flex-col items-center justify-center gap-0.5 px-1.5 py-2 min-w-0 flex-1 group select-none"
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                >
                  {/* Top emerald notch */}
                  <span
                    className={`absolute -top-[3px] left-1/2 -translate-x-1/2 h-1 rounded-full bg-[hsl(var(--gold))] transition-all duration-500 ease-out ${
                      active
                        ? "w-8 opacity-100 shadow-[0_0_10px_hsl(var(--gold)/0.7)]"
                        : "w-0 opacity-0"
                    }`}
                  />

                  {/* Icon */}
                  <span
                    className={`relative flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-300 ${
                      active
                        ? "text-primary scale-110 -translate-y-0.5"
                        : "text-muted-foreground group-hover:text-foreground group-hover:-translate-y-0.5 group-active:scale-90"
                    }`}
                  >
                    <Icon
                      className={`h-[19px] w-[19px] transition-transform duration-500 ${
                        active ? "drop-shadow-[0_2px_4px_hsl(var(--primary)/0.3)]" : ""
                      }`}
                      strokeWidth={active ? 2.4 : 1.9}
                    />
                    {/* Ripple ping on active */}
                    {active && (
                      <span className="absolute inset-0 rounded-lg bg-primary/20 animate-ping opacity-75" />
                    )}
                  </span>

                  <span
                    className={`text-[10px] font-semibold tracking-wide transition-all duration-300 ${
                      active
                        ? "text-primary opacity-100 translate-y-0"
                        : "text-muted-foreground/80 opacity-90 group-hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
