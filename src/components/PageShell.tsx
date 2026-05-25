import { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";
import BottomNav from "@/components/BottomNav";

interface PageShellProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  headerAction?: ReactNode;
  children: ReactNode;
  maxWidth?: "2xl" | "4xl" | "6xl" | "7xl" | "wide" | "full";
}

const maxWidthMap = {
  "2xl": "max-w-2xl lg:max-w-4xl",
  "4xl": "max-w-4xl lg:max-w-5xl",
  "6xl": "max-w-6xl lg:max-w-[1500px]",
  "7xl": "max-w-7xl lg:max-w-[1600px]",
  "wide": "max-w-7xl lg:max-w-[1700px] xl:max-w-[1800px]",
  "full": "max-w-full",
};

const PageShell = ({
  title,
  subtitle,
  icon: Icon,
  headerAction,
  children,
  maxWidth = "4xl",
}: PageShellProps) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-background via-muted/40 to-background">
      {/* Animated Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
        <div
          className="absolute top-1/3 -right-40 w-[600px] h-[600px] bg-accent/20 rounded-full blur-[140px] animate-pulse"
          style={{ animationDelay: "1s" }}
        />
        <div
          className="absolute bottom-0 left-1/3 w-[450px] h-[450px] bg-secondary/15 rounded-full blur-[120px] animate-pulse"
          style={{ animationDelay: "2s" }}
        />
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.03]" />
      </div>

      {/* Header — Magnetic Dock style */}
      <header className="sticky top-0 z-50 h-20 backdrop-blur-md bg-background/80 border-b border-border/60">
        <div className="relative h-full flex items-center justify-between px-4 sm:px-5">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full hover:bg-primary/10 text-primary active:scale-90 transition-all duration-300"
              onClick={() => navigate("/dashboard")}
              aria-label="Back to Dashboard"
            >
              <ArrowLeft className="h-5 w-5" strokeWidth={2.5} />
            </Button>
            <div
              className="flex items-center gap-2 cursor-pointer group"
              onClick={() => navigate("/dashboard")}
            >
              <img
                src={logo}
                alt="Grow FX Trade"
                className="h-10 w-auto sm:h-12 object-contain transition-transform duration-500 group-hover:scale-105"
              />
            </div>
          </div>
          {headerAction && (
            <div className="flex items-center gap-2">{headerAction}</div>
          )}
        </div>
      </header>


      {/* Main Content */}
      <main className={`relative z-10 container mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-6 sm:py-8 ${maxWidthMap[maxWidth]} pb-24`}>
        {/* Hero Title */}
        <div className="mb-6 sm:mb-8 animate-fade-in">
          <div className="relative inline-block">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/30 via-accent/30 to-secondary/30 blur-2xl opacity-60" />
            <h1 className="relative text-2xl sm:text-3xl md:text-4xl font-bold mb-2 tracking-tight flex items-center gap-3">
              {Icon && (
                <span className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-accent/30">
                  <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                </span>
              )}
              <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                {title}
              </span>
            </h1>
          </div>
          {subtitle && (
            <div className="flex items-center gap-2 mt-2">
              <div className="h-1 w-12 rounded-full bg-gradient-to-r from-primary to-accent" />
              <p className="text-sm sm:text-base text-muted-foreground">{subtitle}</p>
            </div>
          )}
        </div>

        <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
          {children}
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default PageShell;

/* Reusable glass-card wrapper class string for consistency */
export const glassCardClass =
  "relative rounded-2xl bg-card/60 backdrop-blur-xl border border-border/60 shadow-xl overflow-hidden";
