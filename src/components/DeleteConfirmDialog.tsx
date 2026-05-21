import { useState, useEffect } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Loader2 } from "lucide-react";

export interface DeleteRecord {
  type: "deposit" | "withdrawal";
  id: string;
  userName?: string;
  userEmail?: string;
  amount?: number | string;
  currency?: string;
  status?: string;
  method?: string;
  reference?: string;
  createdAt?: string;
  extra?: Record<string, string | undefined>;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: DeleteRecord | null;
  onConfirm: (reason: string) => Promise<void> | void;
}

export const DeleteConfirmDialog = ({ open, onOpenChange, record, onConfirm }: Props) => {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setReason(""); setSubmitting(false); } }, [open]);

  if (!record) return null;

  const title = record.type === "deposit" ? "Delete deposit record?" : "Delete withdrawal record?";
  const typeBadge = record.type === "deposit" ? "Deposit" : "Withdrawal";
  const reasonValid = reason.trim().length >= 3;

  const handleConfirm = async () => {
    if (!reasonValid) return;
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Record will be moved to <strong>Trash</strong> (recoverable). This action is logged in the Audit Log.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="capitalize">{typeBadge}</Badge>
            {record.status && (
              <Badge variant="secondary" className="capitalize">{record.status}</Badge>
            )}
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <div className="text-xs text-muted-foreground">User</div>
              <div className="font-medium">{record.userName || "—"}</div>
              {record.userEmail && (
                <div className="text-xs text-muted-foreground break-all">{record.userEmail}</div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Amount</div>
              <div className="font-semibold text-base">
                {record.amount !== undefined
                  ? `${record.currency === "INR" ? "₹" : "$"}${Number(record.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "—"}
                {record.currency && <span className="ml-1 text-xs text-muted-foreground">{record.currency}</span>}
              </div>
            </div>
            {record.method && (
              <div>
                <div className="text-xs text-muted-foreground">Method</div>
                <div className="capitalize">{record.method}</div>
              </div>
            )}
            {record.reference && (
              <div>
                <div className="text-xs text-muted-foreground">Reference</div>
                <code className="text-xs break-all">{record.reference}</code>
              </div>
            )}
            {record.createdAt && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Created</div>
                <div className="text-xs">{new Date(record.createdAt).toLocaleString()}</div>
              </div>
            )}
            {record.extra && Object.entries(record.extra).filter(([, v]) => !!v).map(([k, v]) => (
              <div key={k} className="col-span-2">
                <div className="text-xs text-muted-foreground capitalize">{k}</div>
                <div className="text-xs break-words">{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="delete-reason">
            Reason <span className="text-destructive">*</span>
            <span className="text-xs text-muted-foreground ml-2">(min 3 chars, saved in audit log)</span>
          </Label>
          <Textarea
            id="delete-reason"
            placeholder="e.g. Duplicate entry, user requested removal, test record cleanup…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            disabled={submitting}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleConfirm(); }}
            disabled={!reasonValid || submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Move to Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
