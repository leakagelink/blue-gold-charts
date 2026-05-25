import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeForexData, invokeCommoditiesData } from "@/lib/forexCache";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wallet, User, Settings, FileCheck, Menu, LogOut, Bitcoin, DollarSign, Euro, PoundSterling, Coins, Gem, Droplet, Flame, RotateCcw, Shield, Search, TrendingUp, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import TradingList from "@/components/TradingList";
import BottomNav from "@/components/BottomNav";
import logo from "@/assets/logo.png";
import { MarketNewsFeed } from "@/components/MarketNewsFeed";
import { TopMoversStrip } from "@/components/home/TopMoversStrip";
import { LiveSignals } from "@/components/home/LiveSignals";

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cryptoData, setCryptoData] = useState<any[]>([]);
  const [forexData, setForexData] = useState<any[]>([]);
  const [commoditiesData, setCommoditiesData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [forexLoading, setForexLoading] = useState(true);
  const [commoditiesLoading, setCommoditiesLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [forexEnabled, setForexEnabled] = useState(true);
  const [commoditiesEnabled, setCommoditiesEnabled] = useState(true);
  const [forexMomentumEnabled, setForexMomentumEnabled] = useState(true);
  const [commoditiesMomentumEnabled, setCommoditiesMomentumEnabled] = useState(true);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [activeMarketTab, setActiveMarketTab] = useState<string>("crypto");
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const marketTabs = ["crypto", ...(forexEnabled ? ["forex"] : []), ...(commoditiesEnabled ? ["commodities"] : [])];

  const handleSwipeStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };
  const handleSwipeEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dy = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    const idx = marketTabs.indexOf(activeMarketTab);
    if (idx < 0) return;
    if (dx < 0 && idx < marketTabs.length - 1) setActiveMarketTab(marketTabs[idx + 1]);
    if (dx > 0 && idx > 0) setActiveMarketTab(marketTabs[idx - 1]);
  };

  const fetchWalletBalance = async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("user_wallets")
        .select("balance")
        .eq("user_id", user.id)
        .eq("currency", "USD")
        .maybeSingle();
      setWalletBalance(Number(data?.balance ?? 0));
    } catch (e) {
      console.error("Wallet balance fetch error:", e);
    }
  };

  const fetchCryptoData = async (isBackgroundRefresh = false) => {
    try {
      if (!isBackgroundRefresh) setLoading(true);
      const { data, error } = await supabase.functions.invoke('fetch-crypto-data');
      
      if (error) {
        console.error('Error fetching crypto data:', error);
        return;
      }
      
      if (data?.cryptoData) {
        setCryptoData(data.cryptoData);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      if (!isBackgroundRefresh) setLoading(false);
    }
  };

  const fetchForexData = async (isBackgroundRefresh = false) => {
    try {
      if (!isBackgroundRefresh) setForexLoading(true);
      const { data, error } = await invokeForexData();
      
      if (error) {
        console.error('Error fetching forex data:', error);
        return;
      }
      
      if (data?.forexData) {
        setForexData(data.forexData);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      if (!isBackgroundRefresh) setForexLoading(false);
    }
  };

  const fetchCommoditiesData = async (isBackgroundRefresh = false) => {
    try {
      if (!isBackgroundRefresh) setCommoditiesLoading(true);
      const { data, error } = await invokeCommoditiesData();
      
      if (error) {
        console.error('Error fetching commodities data:', error);
        return;
      }
      
      if (data?.commoditiesData) {
        setCommoditiesData(data.commoditiesData);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      if (!isBackgroundRefresh) setCommoditiesLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }

    if (user) {
      checkUserApproval();
    }
  }, [user, authLoading, navigate]);

  const checkUserApproval = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_approved")
        .eq("id", user?.id)
        .single();

      if (error) throw error;

      if (!data?.is_approved) {
        navigate("/pending-approval");
        return;
      }

      // Fetch market settings
      await fetchMarketSettings();
      
      // User is approved, continue with normal dashboard flow
      fetchCryptoData();
      fetchForexData();
      fetchCommoditiesData();
      fetchWalletBalance();
      checkAdminStatus();

      // Realtime wallet updates
      const walletChannel = supabase
        .channel(`wallet-${user!.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_wallets", filter: `user_id=eq.${user!.id}` },
          () => fetchWalletBalance()
        )
        .subscribe();
      
      // Auto-refresh every 30 seconds for crypto + forex
      const refreshInterval = setInterval(() => {
        fetchCryptoData(true);
        fetchForexData(true);
        fetchCommoditiesData(true);
      }, 30000);

      // Faster commodities-only refresh (every 15s) so the table stays live
      const commoditiesInterval = setInterval(() => {
        fetchCommoditiesData(true);
      }, 15000);

      return () => {
        clearInterval(refreshInterval);
        clearInterval(commoditiesInterval);
        supabase.removeChannel(walletChannel);
      };
    } catch (error) {
      console.error("Error checking user approval:", error);
    }
  };
  
  const fetchMarketSettings = async () => {
    try {
      const { data: settingsData } = await supabase
        .from("payment_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["forex_enabled", "commodities_enabled", "forex_momentum_enabled", "commodities_momentum_enabled"]);
      
      if (settingsData) {
        settingsData.forEach((setting) => {
          if (setting.setting_key === "forex_enabled") {
            setForexEnabled(setting.setting_value !== "false");
          }
          if (setting.setting_key === "commodities_enabled") {
            setCommoditiesEnabled(setting.setting_value !== "false");
          }
          if (setting.setting_key === "forex_momentum_enabled") {
            setForexMomentumEnabled(setting.setting_value !== "false");
          }
          if (setting.setting_key === "commodities_momentum_enabled") {
            setCommoditiesMomentumEnabled(setting.setting_value !== "false");
          }
        });
      }
    } catch (error) {
      console.error("Error fetching market settings:", error);
    }
  };

  const checkAdminStatus = async () => {
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user?.id)
        .eq("role", "admin")
        .maybeSingle();

      setIsAdmin(!!data);
    } catch (error) {
      console.error("Error checking admin status:", error);
    }
  };


  const filterData = <T extends { name: string; symbol: string }>(data: T[]) => {
    if (!searchQuery.trim()) return data;
    
    const query = searchQuery.toLowerCase().trim();
    return data.filter(
      item =>
        item.name.toLowerCase().includes(query) ||
        item.symbol.toLowerCase().includes(query)
    );
  };

  const filteredCryptoData = filterData(cryptoData);
  const filteredForexData = filterData(forexData);
  const filteredCommoditiesData = filterData(commoditiesData);

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-background via-muted/40 to-background">
      {/* Animated Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute top-1/3 -right-40 w-[600px] h-[600px] bg-accent/20 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute bottom-0 left-1/3 w-[450px] h-[450px] bg-secondary/15 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: "2s" }} />
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.03]" />
      </div>

      {/* Header — Magnetic Dock style: asymmetric, h-20, navy filled profile */}
      <header className="sticky top-0 z-50 h-20 backdrop-blur-md bg-background/80 border-b border-border/60">
        <div className="relative h-full flex items-center justify-between px-4 sm:px-5">
          {/* Left: menu + brand */}
          <div className="flex items-center gap-3 sm:gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full hover:bg-primary/10 active:scale-90 transition-all duration-300 text-primary"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Menu"
            >
              <Menu className={`h-5 w-5 transition-transform duration-300 ${sidebarOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
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

          {/* Right: wallet pill, shield, profile, sign out */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/wallet")}
              className="flex items-center gap-2 bg-primary/5 hover:bg-primary/10 active:scale-95 transition-all duration-300 px-3 py-1.5 rounded-full"
              title="Wallet Balance"
            >
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-primary font-mono tabular-nums">
                ${walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </button>

            {isAdmin && (
              <button
                onClick={() => navigate("/admin")}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-[hsl(var(--gold))]/10 hover:bg-[hsl(var(--gold))]/20 hover:scale-105 active:scale-95 transition-all duration-300 text-[hsl(var(--gold))]"
                title="Broker Dashboard"
              >
                <Shield className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}

            <button
              onClick={() => navigate("/profile")}
              className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300 shadow-[0_4px_12px_-4px_hsl(var(--primary)/0.4)]"
              title="Profile"
            >
              <User className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>

            <button
              onClick={signOut}
              className="ml-0.5 p-1.5 text-muted-foreground hover:text-destructive transition-colors duration-300 active:scale-90"
              title="Sign Out"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>


      <div className="flex relative z-10">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "w-64" : "w-0"} transition-all duration-500 overflow-hidden border-r border-border/40 backdrop-blur-xl bg-card/40 hidden sm:block`}>
          <nav className="p-4 space-y-2">
            <Button variant="ghost" className="w-full justify-start hover:bg-gradient-to-r hover:from-primary/10 hover:to-accent/10 hover:text-primary transition-all" onClick={() => navigate("/dashboard")}>
              <TrendingUp className="mr-2 h-4 w-4" />
              Trading
            </Button>
            <Button variant="ghost" className="w-full justify-start hover:bg-gradient-to-r hover:from-primary/10 hover:to-accent/10 hover:text-primary transition-all" onClick={() => navigate("/wallet")}>
              <Wallet className="mr-2 h-4 w-4" />
              Wallet
            </Button>
            <Button variant="ghost" className="w-full justify-start hover:bg-gradient-to-r hover:from-primary/10 hover:to-accent/10 hover:text-primary transition-all" onClick={() => navigate("/profile")}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </Button>
            <Button variant="ghost" className="w-full justify-start hover:bg-gradient-to-r hover:from-primary/10 hover:to-accent/10 hover:text-primary transition-all" onClick={() => navigate("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
            <Button variant="ghost" className="w-full justify-start hover:bg-gradient-to-r hover:from-primary/10 hover:to-accent/10 hover:text-primary transition-all" onClick={() => navigate("/kyc")}>
              <FileCheck className="mr-2 h-4 w-4" />
              KYC Verification
            </Button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-3 sm:p-4 md:p-6 lg:p-8 pb-20 overflow-x-hidden">
          <div className="max-w-7xl xl:max-w-[1700px] 2xl:max-w-[1900px] mx-auto w-full overflow-hidden">
            {/* Hero Header */}
            <div className="mb-6 sm:mb-8 animate-fade-in">
              <div className="relative inline-block">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary/30 via-accent/30 to-secondary/30 blur-2xl opacity-60" />
                <h1 className="relative text-3xl sm:text-4xl md:text-5xl font-bold mb-2 tracking-tight">
                  <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                    Trading Dashboard
                  </span>
                </h1>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="h-1 w-12 rounded-full bg-gradient-to-r from-primary to-accent" />
                <p className="text-sm sm:text-base text-muted-foreground">Monitor and trade across multiple markets in real-time</p>
              </div>
            </div>

            {/* Search Bar */}
            <div className="mb-4 sm:mb-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/40 via-accent/40 to-primary/40 rounded-xl opacity-0 group-focus-within:opacity-100 blur transition-opacity duration-500" />
                <div className="relative">
                  <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    type="text"
                    placeholder="Search by name or symbol..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 sm:pl-12 h-11 sm:h-12 text-sm sm:text-base bg-card/60 backdrop-blur-xl border-border/60 focus:border-primary/60 transition-all rounded-xl"
                  />
                </div>
              </div>
            </div>

            {/* Top Movers Strip - Compact, mobile-optimized */}
            <div className="mb-4 sm:mb-6 animate-fade-in" style={{ animationDelay: "0.15s" }}>
              <TopMoversStrip compact />
            </div>

            {/* Pro desktop layout: markets + side rail */}
            <div className="xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:gap-6 2xl:gap-8">
            <div className="min-w-0">
            <Tabs value={activeMarketTab} onValueChange={setActiveMarketTab} className="w-full animate-fade-in touch-pan-y" style={{ animationDelay: "0.2s" }} onTouchStart={handleSwipeStart} onTouchEnd={handleSwipeEnd}>
              <TabsList className={`grid w-full mb-4 sm:mb-6 h-auto p-1.5 bg-card/60 backdrop-blur-xl border border-border/60 rounded-2xl shadow-lg ${
                forexEnabled && commoditiesEnabled ? 'grid-cols-3' : 
                forexEnabled || commoditiesEnabled ? 'grid-cols-2' : 'grid-cols-1'
              }`}>
                <TabsTrigger 
                  value="crypto" 
                  className="text-xs sm:text-sm py-2.5 sm:py-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:via-secondary data-[state=active]:to-accent data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.5)] font-semibold transition-all duration-300"
                >
                  Crypto
                </TabsTrigger>
                {forexEnabled && (
                  <TabsTrigger 
                    value="forex"
                    className="text-xs sm:text-sm py-2.5 sm:py-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:via-secondary data-[state=active]:to-accent data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.5)] font-semibold transition-all duration-300"
                  >
                    Forex
                  </TabsTrigger>
                )}
                {commoditiesEnabled && (
                  <TabsTrigger 
                    value="commodities"
                    className="text-xs sm:text-sm py-2.5 sm:py-3 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary data-[state=active]:via-secondary data-[state=active]:to-accent data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.5)] font-semibold transition-all duration-300"
                  >
                    Commodities
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="crypto" className="animate-fade-in">
                <div className="relative rounded-2xl bg-card/50 backdrop-blur-xl border border-border/60 p-4 sm:p-6 shadow-xl">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
                  <div className="flex items-center justify-between mb-4 sm:mb-5">
                    <h2 className="text-lg sm:text-xl md:text-2xl font-bold flex items-center gap-2 mb-0">
                      <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-accent/30">
                        <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                      </div>
                      <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                        Cryptocurrency Markets
                      </span>
                    </h2>
                    <Button variant="ghost" size="icon" className="hover:bg-accent/15 hover:text-accent transition-all" onClick={() => fetchCryptoData()} aria-label="Refresh markets" title="Refresh markets">
                      <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                  {loading ? (
                    <div className="space-y-3">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="animate-pulse bg-muted/50 rounded-lg p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-muted"></div>
                            <div>
                              <div className="h-4 w-24 bg-muted rounded mb-2"></div>
                              <div className="h-3 w-16 bg-muted rounded"></div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="h-4 w-20 bg-muted rounded mb-2"></div>
                            <div className="h-3 w-12 bg-muted rounded"></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredCryptoData.length > 0 ? (
                    <TradingList data={filteredCryptoData} />
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No cryptocurrencies found matching "{searchQuery}"
                    </div>
                  )}
                </div>
              </TabsContent>

              {forexEnabled && (
                <TabsContent value="forex" className="animate-fade-in">
                  <div className="relative rounded-2xl bg-card/50 backdrop-blur-xl border border-border/60 p-4 sm:p-6 shadow-xl">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
                    <div className="flex items-center justify-between mb-4 sm:mb-5">
                      <h2 className="text-lg sm:text-xl md:text-2xl font-bold flex items-center gap-2 mb-0">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-accent/30">
                          <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                        </div>
                        <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                          Forex Markets
                        </span>
                      </h2>
                      <Button variant="ghost" size="icon" className="hover:bg-accent/15 hover:text-accent transition-all" onClick={() => fetchForexData()} aria-label="Refresh forex" title="Refresh forex">
                        <RotateCcw className={`h-4 w-4 ${forexLoading ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    {forexLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="animate-pulse bg-muted/50 rounded-lg p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-muted"></div>
                              <div>
                                <div className="h-4 w-24 bg-muted rounded mb-2"></div>
                                <div className="h-3 w-16 bg-muted rounded"></div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="h-4 w-20 bg-muted rounded mb-2"></div>
                              <div className="h-3 w-12 bg-muted rounded"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : filteredForexData.length > 0 ? (
                      <TradingList data={filteredForexData} momentumEnabled={forexMomentumEnabled} />
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No forex pairs found matching "{searchQuery}"
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}

              {commoditiesEnabled && (
                <TabsContent value="commodities" className="animate-fade-in">
                  <div className="relative rounded-2xl bg-card/50 backdrop-blur-xl border border-border/60 p-4 sm:p-6 shadow-xl">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
                    <div className="flex items-center justify-between mb-4 sm:mb-5">
                      <h2 className="text-lg sm:text-xl md:text-2xl font-bold flex items-center gap-2 mb-0">
                        <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-accent/30">
                          <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                        </div>
                        <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                          Commodities Markets
                        </span>
                      </h2>
                      <Button variant="ghost" size="icon" className="hover:bg-accent/15 hover:text-accent transition-all" onClick={() => fetchCommoditiesData()} aria-label="Refresh commodities" title="Refresh commodities">
                        <RotateCcw className={`h-4 w-4 ${commoditiesLoading ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    {commoditiesLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="animate-pulse bg-muted/50 rounded-lg p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-muted"></div>
                              <div>
                                <div className="h-4 w-24 bg-muted rounded mb-2"></div>
                                <div className="h-3 w-16 bg-muted rounded"></div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="h-4 w-20 bg-muted rounded mb-2"></div>
                              <div className="h-3 w-12 bg-muted rounded"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : filteredCommoditiesData.length > 0 ? (
                      <TradingList data={filteredCommoditiesData} momentumEnabled={commoditiesMomentumEnabled} />
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No commodities found matching "{searchQuery}"
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}
            </Tabs>

            </div>

            {/* Right rail on xl+ */}
            <div className="xl:sticky xl:top-24 xl:self-start xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-1 space-y-6 xl:space-y-5 mt-8 xl:mt-0">
              <div className="-mx-3 sm:-mx-4 md:-mx-6 xl:mx-0 animate-fade-in" style={{ animationDelay: "0.25s" }}>
                <LiveSignals authenticated />
              </div>
              <div className="animate-fade-in" style={{ animationDelay: "0.3s" }}>
                <div className="relative rounded-2xl bg-card/50 backdrop-blur-xl border border-border/60 p-4 sm:p-6 shadow-xl">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />
                  <MarketNewsFeed variant="dashboard" defaultCategory="all" limit={8} />
                </div>
              </div>
            </div>
            </div>
          </div>
        </main>
      </div>

      {/* Bottom Navigation Bar */}
      <BottomNav />
    </div>
  );
};

export default Dashboard;
