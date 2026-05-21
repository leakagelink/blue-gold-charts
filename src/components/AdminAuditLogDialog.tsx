import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filterTable?: string;
}

export const AdminAuditLogDialog = ({ open, onOpenChange, filterTable }: Props) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (filterTable) query = query.eq("target_table", filterTable);
      const { data, error } = await query;
      if (error) throw error;

      const actorIds = Array.from(new Set((data || []).map(l => l.actor_id).filter(Boolean)));
      const targetUserIds = Array.from(new Set((data || []).map(l => l.target_user_id).filter(Boolean)));
      const allIds = Array.from(new Set([...actorIds, ...targetUserIds]));
      let profilesMap: Record<string, any> = {};
      if (allIds.length) {
        const { data: profiles } = await supabase
          .from("profiles").select("id, full_name, email").in("id", allIds);
        profilesMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
      }
      setLogs((data || []).map((l: any) => ({
        ...l,
        actor: profilesMap[l.actor_id],
        target_user: l.target_user_id ? profilesMap[l.target_user_id] : null,
      })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) fetchLogs(); /* eslint-disable-next-line */ }, [open, filterTable]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogTitle>Audit Log</DialogTitle>
              <DialogDescription>
                {filterTable ? `Actions on ${filterTable}` : "Broker actions on deposit & withdrawal records"} — latest 200 entries
              </DialogDescription>
            </div>
            <Button variant="outline" size="icon" onClick={fetchLogs} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </DialogHeader>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Broker</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              ) : logs.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No audit entries yet</TableCell></TableRow>
              ) : logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    <div>{new Date(l.created_at).toLocaleDateString()}</div>
                    <div className="text-muted-foreground">{new Date(l.created_at).toLocaleTimeString()}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{l.actor?.full_name || "—"}</div>
                    <div className="text-muted-foreground">{l.actor?.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={l.action === "soft_delete" ? "destructive" : "secondary"} className="capitalize">
                      {l.action.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{l.target_table}</div>
                    <code className="text-[10px] text-muted-foreground">{String(l.target_id).slice(0, 8)}…</code>
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.target_user ? (
                      <>
                        <div className="font-medium">{l.target_user.full_name}</div>
                        <div className="text-muted-foreground">{l.target_user.email}</div>
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-[240px] whitespace-pre-wrap break-words">
                    {l.reason || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    {l.metadata ? (
                      <code className="block whitespace-pre-wrap break-words text-[10px] text-muted-foreground">
                        {JSON.stringify(l.metadata)}
                      </code>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
