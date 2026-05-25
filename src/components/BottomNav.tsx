import { TrendingUp, Wallet, User, Layers, Newspaper, Zap, type LucideIcon } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

type NavItem = {
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  path: string;
};

const navItems: NavItem[] = [
  { icon: TrendingUp, label: "Trade", shortLabel: "Trade", path: "/dashboard" },
  { icon: Layers, label: "Positions", shortLabel: "Pos", path: "/positions" },
  { icon: Zap, label: "Signals", shortLabel: "Signals", path: "/signals" },
  { icon: Newspaper, label: "News", shortLabel: "News", path: "/news" },
  { icon: Wallet, label: "Wallet", shortLabel: "Wallet", path: "/wallet" },
  { icon: User, label: "Profile", shortLabel: "Me", path: "/profile" },
];

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const activeIndex = navItems.findIndex((i) => i.path === location.pathname);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = itemRefs.current[safeIndex];
      const container = containerRef.current;
      if (!el || !container) return;
      const elRect = el.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      setPill({
        left: elRect.left - cRect.left,
        width: elRect.width,
        height: elRect.height,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [safeIndex, location.pathname]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-safe pointer-events-none">
      <div className="pointer-events-auto mx-auto w-full max-w-[420px] px-3 pb-4 sm:pb-6">
        <div className="relative w-full h-[76px] rounded-[24px] bg-background/90 backdrop-blur-xl border border-border/70 shadow-[0_20px_40px_-15px_hsl(220_30%_20%/0.18)]">
          {/* Sliding navy pill behind active tab */}
          {pill && (
            <span
              aria-hidden
              className="absolute top-1/2 -translate-y-1/2 rounded-xl bg-primary transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.45)]"
              style={{
                left: pill.left + (pill.width - 54) / 2,
                width: 54,
                height: 54,
              }}
            />
          )}

          <div
            ref={containerRef}
            className="relative flex items-center justify-around h-full px-2"
          >
            {navItems.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === safeIndex;

              return (
                <button
                  key={item.path}
                  ref={(el) => (itemRefs.current[idx] = el)}
                  onClick={() => navigate(item.path)}
                  className="relative z-10 flex flex-col items-center justify-center gap-0.5 flex-1 h-12 select-none group"
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                >
                  {/* Gold notch on active */}
                  <span
                    aria-hidden
                    className={`absolute -top-3 left-1/2 -translate-x-1/2 h-1 rounded-full bg-[hsl(var(--gold))] transition-all duration-500 ease-out ${
                      active ? "w-4 opacity-100" : "w-0 opacity-0"
                    }`}
                  />

                  <Icon
                    className={`h-5 w-5 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      active
                        ? "text-primary-foreground -translate-y-0.5"
                        : "text-primary opacity-60 group-hover:opacity-100 group-hover:-translate-y-0.5 group-active:scale-90"
                    }`}
                    strokeWidth={active ? 2.5 : 2}
                  />
                  <span
                    className={`text-[9px] font-bold uppercase tracking-widest transition-all duration-300 ${
                      active
                        ? "text-primary-foreground opacity-100"
                        : "text-primary opacity-40 group-hover:opacity-70"
                    }`}
                  >
                    {item.shortLabel}
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
