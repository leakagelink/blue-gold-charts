import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  User,
  Mail,
  FileCheck,
  CheckCircle,
  Clock,
  XCircle,
  ChevronRight,
  Phone,
  Copy,
  Download,
  Smartphone,
  TrendingUp,
  CreditCard,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import PageShell from "@/components/PageShell";
import PaymentMethodsManager from "@/components/PaymentMethodsManager";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  mobile_number: string | null;
  client_id: string | null;
  created_at: string;
}

interface KYCStatus {
  status: "pending" | "approved" | "rejected";
}

interface TradeHistoryItem {
  symbol: string;
  side: string;
  amount: string;
  date: string;
  status: string;
  isProfit: boolean;
}

const SectionLabel = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex justify-between items-center mb-2 px-1">
    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </label>
    {right}
  </div>
);

const Profile = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [kycStatus, setKycStatus] = useState<KYCStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [appDownloadUrl, setAppDownloadUrl] = useState<string | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryItem[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    if (user) fetchProfile();
  }, [user, authLoading, navigate]);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles").select("*").eq("id", user?.id).single();
      if (error) throw error;
      setProfile(data);
      setFullName(data.full_name || "");
      setMobile(data.mobile_number || "");

      const { data: kycData } = await supabase
        .from("kyc_submissions").select("status").eq("user_id", user?.id).maybeSingle();
      if (kycData) setKycStatus(kycData as KYCStatus);

      const { data: appUrlSetting } = await supabase
        .from("payment_settings").select("setting_value").eq("setting_key", "app_download_url").maybeSingle();
      if (appUrlSetting?.setting_value) setAppDownloadUrl(appUrlSetting.setting_value);

      const { data: closedPositions } = await supabase
        .from("positions")
        .select("symbol, position_type, pnl, closed_at, status")
        .eq("user_id", user?.id)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(10);
      if (closedPositions) {
        setTradeHistory(closedPositions.map((p: any) => {
          const pnl = Number(p.pnl ?? 0);
          return {
            symbol: p.symbol,
            side: (p.position_type === "long" ? "BUY" : "SELL"),
            amount: pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`,
            date: p.closed_at ? new Date(p.closed_at).toLocaleDateString() : "",
            status: "closed",
            isProfit: pnl >= 0,
          };
        }));
      }
    } catch (error: any) {
      console.error("Error fetching profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      setSaving(true);
      const { error } = await supabase
        .from("profiles").update({ full_name: fullName }).eq("id", user.id);
      if (error) throw error;
      toast.success("Profile updated successfully!");
      fetchProfile();
    } catch (error: any) {
      console.error("Error updating profile:", error);
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", { year: "numeric", month: "long" });

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-card border border-border">
          <div className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="text-sm font-medium">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <PageShell title="My Profile" subtitle="Account management and identity" icon={User} maxWidth="wide">
      <div className="lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-6 xl:gap-8">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* High-Priority Client ID Card (Navy) */}
          {profile?.client_id && (
            <div className="relative overflow-hidden p-6 rounded-3xl bg-primary text-primary-foreground shadow-lg animate-fade-in">
              <div className="relative z-10 flex justify-between items-start">
                <div>
                  <p className="text-gold text-[10px] font-bold uppercase tracking-[0.15em] mb-1">
                    Client ID
                  </p>
                  <p
                    className="text-2xl font-bold tracking-tight"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    {profile.client_id}
                  </p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(profile.client_id || "");
                    toast.success("Client ID copied!");
                  }}
                  className="p-2.5 rounded-xl bg-primary-foreground/10 border border-primary-foreground/20 hover:bg-primary-foreground/20 transition-all active:scale-95"
                  aria-label="Copy Client ID"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-4 text-[10px] text-primary-foreground/60 leading-relaxed max-w-[240px]">
                Use this ID to login along with email or mobile number
              </p>
              {/* Subtle background geometry */}
              <div className="absolute -right-12 -bottom-12 w-32 h-32 border border-primary-foreground/5 rounded-full pointer-events-none" />
              <div className="absolute -right-6 -bottom-6 w-24 h-24 border border-primary-foreground/10 rounded-full pointer-events-none" />
            </div>
          )}

          {/* Core Identity Form */}
          <div className="space-y-6 bg-muted/40 p-6 rounded-[32px] border border-border animate-fade-in">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl overflow-hidden border border-border bg-card flex items-center justify-center">
                  <User className="w-7 h-7 text-primary" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-background rounded-full" />
              </div>
              <div>
                <h3 className="font-bold text-primary leading-tight">
                  {profile?.full_name || "User"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Member since {profile?.created_at ? formatDate(profile.created_at) : "Unknown"}
                </p>
              </div>
            </div>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
            >
              {/* Full Name */}
              <div>
                <SectionLabel>Full Name</SectionLabel>
                <div className="px-4 py-3 bg-card border border-border rounded-xl flex items-center gap-3 focus-within:border-accent transition-colors">
                  <User className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-auto border-0 bg-transparent p-0 text-sm font-medium text-primary focus-visible:ring-0 shadow-none"
                    placeholder="Enter full name"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <SectionLabel
                  right={<span className="text-[9px] font-bold text-muted-foreground/70 uppercase">Read-only</span>}
                >
                  Email Address
                </SectionLabel>
                <div className="px-4 py-3 bg-muted border border-border rounded-xl flex items-center gap-3">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-muted-foreground truncate">
                    {profile?.email || user?.email || ""}
                  </span>
                </div>
              </div>

              {/* Mobile */}
              <div>
                <SectionLabel>Mobile Number</SectionLabel>
                <div className="px-4 py-3 bg-card border border-border rounded-xl flex items-center gap-3 focus-within:border-accent transition-colors">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Input
                    type="tel"
                    value={mobile}
                    disabled
                    placeholder="Enter mobile number"
                    className="h-auto border-0 bg-transparent p-0 text-sm font-medium text-primary focus-visible:ring-0 shadow-none disabled:opacity-100"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={saving}
                className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold rounded-xl transition-all active:scale-[0.98]"
              >
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </div>

          {/* Trade History */}
          <div className="p-5 bg-card border border-border rounded-2xl animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h2 className="text-sm font-bold text-primary">Trade History</h2>
            </div>
            {tradeHistory.length === 0 ? (
              <div className="py-6 border border-dashed border-border rounded-xl bg-muted/30 flex flex-col items-center">
                <p className="text-[11px] text-muted-foreground text-center px-4">
                  No trade history yet
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tradeHistory.map((trade, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border hover:bg-muted/60 transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-sm text-primary">
                        {trade.symbol}{" "}
                        <span
                          className={`ml-1 text-[10px] font-bold ${
                            trade.side === "BUY" ? "text-emerald-600" : "text-red-500"
                          }`}
                        >
                          {trade.side}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">{trade.date}</div>
                    </div>
                    <div
                      className={`font-bold text-sm ${
                        trade.isProfit ? "text-emerald-600" : "text-red-500"
                      }`}
                    >
                      {trade.amount}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:sticky lg:top-24 lg:self-start space-y-3 mt-6 lg:mt-0">
          {/* KYC */}
          <button
            onClick={() => navigate("/kyc")}
            className="w-full p-5 bg-card border border-border rounded-2xl flex items-center gap-4 group hover:border-accent/50 transition-colors text-left animate-fade-in"
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                kycStatus?.status === "approved"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : kycStatus?.status === "rejected"
                  ? "bg-destructive/10 text-destructive"
                  : kycStatus?.status === "pending"
                  ? "bg-gold/10 text-gold"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {kycStatus?.status === "approved" ? (
                <CheckCircle className="w-5 h-5" />
              ) : kycStatus?.status === "rejected" ? (
                <XCircle className="w-5 h-5" />
              ) : kycStatus?.status === "pending" ? (
                <Clock className="w-5 h-5" />
              ) : (
                <FileCheck className="w-5 h-5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-primary">KYC Verification</h4>
              <p className="text-[11px] text-muted-foreground truncate">
                {kycStatus?.status === "approved"
                  ? "Your identity is verified"
                  : kycStatus?.status === "pending"
                  ? "Verification in progress"
                  : kycStatus?.status === "rejected"
                  ? "Please resubmit your documents"
                  : "Identity verification required"}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
          </button>

          {/* Withdrawal Methods */}
          <div className="p-5 bg-card border border-border rounded-2xl animate-fade-in">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-primary">
                  <CreditCard className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-primary">Withdrawal Methods</h4>
              </div>
            </div>
            <PaymentMethodsManager />
          </div>

          {/* Account Information Registry */}
          <div className="bg-muted/40 p-6 rounded-[32px] animate-fade-in">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-4">
              Account Information
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center bg-card p-3 rounded-xl border border-border">
                <span className="text-[11px] text-muted-foreground font-medium">Client ID</span>
                <span
                  className="text-[11px] font-bold text-primary tracking-tight"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {profile?.client_id || "N/A"}
                </span>
              </div>
              <div className="flex justify-between items-center bg-card p-3 rounded-xl border border-border">
                <span className="text-[11px] text-muted-foreground font-medium">Account ID</span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {user?.id.slice(0, 8)}...
                </span>
              </div>
              <div className="flex justify-between items-center bg-card p-3 rounded-xl border border-border">
                <span className="text-[11px] text-muted-foreground font-medium">Email Verified</span>
                <span
                  className={`text-[11px] font-bold ${
                    user?.email_confirmed_at ? "text-emerald-600" : "text-gold"
                  }`}
                >
                  {user?.email_confirmed_at ? "YES" : "NO"}
                </span>
              </div>
            </div>
          </div>

          {/* Native App Callout */}
          <div className="p-4 bg-gold/5 border border-gold/20 rounded-2xl flex items-center justify-between gap-3 animate-fade-in">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gold flex items-center justify-center text-gold-foreground shrink-0">
                <Smartphone className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-primary truncate">Download Mobile App</p>
                <p className="text-[9px] text-muted-foreground truncate">
                  {appDownloadUrl ? "Tap to download APK" : "Available soon on Android"}
                </p>
              </div>
            </div>
            {appDownloadUrl ? (
              <Button
                size="sm"
                onClick={() => window.open(appDownloadUrl, "_blank")}
                className="h-8 px-3 bg-gold hover:bg-gold/90 text-gold-foreground rounded-lg text-[10px] font-bold shrink-0"
              >
                <Download className="w-3 h-3 mr-1" />
                Get
              </Button>
            ) : (
              <span className="text-[9px] font-bold text-gold bg-gold/10 px-2 py-1 rounded-md shrink-0">
                PENDING
              </span>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default Profile;
