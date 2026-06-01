import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Upload, Download, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface AppRelease {
  id: string;
  version: string;
  file_url: string;
  file_path: string;
  file_size: number | null;
  release_notes: string | null;
  is_active: boolean;
  created_at: string;
}

const formatSize = (bytes: number | null) => {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
};

export default function AdminAppUpload() {
  const { user } = useAuth();
  const [releases, setReleases] = useState<AppRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const fetchReleases = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_releases")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setReleases((data as AppRelease[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchReleases();
  }, []);

  const syncDownloadSetting = async (url: string) => {
    const { data: existing } = await supabase
      .from("payment_settings")
      .select("id")
      .eq("setting_key", "app_download_url")
      .maybeSingle();
    if (existing) {
      await supabase
        .from("payment_settings")
        .update({ setting_value: url, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("payment_settings")
        .insert({ setting_key: "app_download_url", setting_value: url, updated_by: user?.id });
    }
  };

  const handleUpload = async () => {
    if (!file) return toast.error("Please choose an APK file");
    if (!version.trim()) return toast.error("Please enter a version");

    try {
      setUploading(true);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `releases/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("app-releases")
        .upload(path, file, { contentType: file.type || "application/vnd.android.package-archive", upsert: false });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("app-releases").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      // Deactivate previous releases
      await supabase.from("app_releases").update({ is_active: false }).eq("is_active", true);

      const { error: insErr } = await supabase.from("app_releases").insert({
        version: version.trim(),
        file_url: publicUrl,
        file_path: path,
        file_size: file.size,
        release_notes: notes.trim() || null,
        is_active: true,
        uploaded_by: user?.id,
      });
      if (insErr) throw insErr;

      await syncDownloadSetting(publicUrl);

      toast.success("App uploaded successfully");
      setVersion("");
      setNotes("");
      setFile(null);
      (document.getElementById("apk-file-input") as HTMLInputElement | null)!.value = "";
      fetchReleases();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSetActive = async (r: AppRelease) => {
    await supabase.from("app_releases").update({ is_active: false }).eq("is_active", true);
    const { error } = await supabase.from("app_releases").update({ is_active: true }).eq("id", r.id);
    if (error) return toast.error(error.message);
    await syncDownloadSetting(r.file_url);
    toast.success(`Version ${r.version} is now active`);
    fetchReleases();
  };

  const handleDelete = async (r: AppRelease) => {
    if (!confirm(`Delete version ${r.version}?`)) return;
    await supabase.storage.from("app-releases").remove([r.file_path]);
    const { error } = await supabase.from("app_releases").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Release deleted");
    fetchReleases();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            Upload Mobile App (APK)
          </CardTitle>
          <CardDescription>
            Upload the Android APK so users can download it from their profile and the sign-in page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                placeholder="e.g. 1.0.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apk-file-input">APK File</Label>
              <Input
                id="apk-file-input"
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Release Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="What's new in this version..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <Button onClick={handleUpload} disabled={uploading} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? "Uploading..." : "Upload & Publish"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded Releases</CardTitle>
          <CardDescription>The active release is shown to users.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : releases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No releases uploaded yet.</p>
          ) : (
            <div className="space-y-3">
              {releases.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 border rounded-lg"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">v{r.version}</span>
                      {r.is_active && (
                        <Badge className="bg-green-600 hover:bg-green-700">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{formatSize(r.file_size)}</span>
                    </div>
                    {r.release_notes && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{r.release_notes}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => window.open(r.file_url, "_blank")}>
                      <Download className="h-3.5 w-3.5 mr-1" /> Download
                    </Button>
                    {!r.is_active && (
                      <Button size="sm" variant="secondary" onClick={() => handleSetActive(r)}>
                        Set Active
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(r)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
