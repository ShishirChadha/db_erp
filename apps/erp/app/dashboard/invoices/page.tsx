"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useIsDesktopViewport } from "@/lib/useIsDesktopViewport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import DeleteInvoiceDialog from "@/components/DeleteInvoiceDialog";
import RequirePageAccess from "@/components/RequirePageAccess";
import { withRetry } from "@/lib/db-retry";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { INVOICE_STATUS_TONES, toneFor } from "@/lib/status-styles";
import { cn } from "@/lib/utils";
import { ViewInvoicePage } from "./[id]/page";

const PAGE_SIZE = 25

// Left-pane list block -- customer, invoice number, invoice date, and a status
// badge, matching an email-client / Zoho-Invoices-style list row.
function InvoiceListItem({ inv, active, onOpen }: { inv: any; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted",
        inv.is_deleted && "opacity-50"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{inv.customer_name || "—"}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">₹{inv.grand_total?.toFixed(2)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">
            {inv.invoice_number}
            {inv.source === "imported_zoho" && (
              <Badge variant="outline" className="ml-1.5 text-[10px]">Imported</Badge>
            )}
          </p>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {inv.invoice_date ? format(new Date(inv.invoice_date), "dd/MM/yyyy") : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <StatusBadge tone={toneFor(INVOICE_STATUS_TONES, inv.status)}>{inv.status.replace("_", " ")}</StatusBadge>
          {inv.is_deleted && <StatusBadge tone="danger">Deleted</StatusBadge>}
        </div>
      </div>
    </button>
  );
}

// Right-pane detail view -- the full invoice document (parties, line items,
// totals, notes/terms/bank, and its own Preview/Download/Email/Print/Edit
// toolbar) embedded inline via its own `embedded` mode instead of behind a
// link-out. Delete lives here rather than in that toolbar since it's a list-
// page-level action (soft-delete dialog owned by this page, not the document
// view). `key={inv.id}` forces a clean remount per selection.
function InvoiceDetailPane({ inv, onDelete, onBack }: {
  inv: any;
  onDelete: (inv: any) => void;
  onBack: () => void;
}) {
  return (
    <div className={cn("flex flex-col h-full", inv.is_deleted && "opacity-60")}>
      <div className="flex items-center justify-between gap-2 p-4 pb-0">
        <button type="button" onClick={onBack} className="md:hidden inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to list
        </button>
        {!inv.is_deleted && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => onDelete(inv)}>
            <Trash2 className="mr-1.5 h-4 w-4 text-destructive" /> Delete
          </Button>
        )}
        {inv.is_deleted && (
          <span className="ml-auto text-sm text-muted-foreground">
            Deleted{inv.deleted_remarks ? ` -- ${inv.deleted_remarks}` : ""}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2">
        <ViewInvoicePage key={inv.id} invoiceId={inv.id} embedded />
      </div>
    </div>
  );
}

function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<any>(null);
  const router = useRouter();
  const supabase = createClient();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Which invoice is open in the right-hand detail pane.
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const isDesktop = useIsDesktopViewport();

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("invoices").select("*", { count: "exact" });

    // Filter deleted invoices based on toggle
    if (!showDeleted) {
      query = query.eq("is_deleted", false);
    }

    if (searchTerm) {
      query = query.or(
        `invoice_number.ilike.%${searchTerm}%,` +
        `customer_name.ilike.%${searchTerm}%`
      );
    }
    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    query = query.order("invoice_date", { ascending: false, nullsFirst: false });
    query = query.order("created_at", { ascending: false });
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, error, count } = await withRetry(() => query);
    if (error) { console.error(error); toast.error("Unable to load invoices -- check your connection and try again."); }
    else {
      const rows = data || [];
      setInvoices(rows);
      setTotal(count || 0);
      // Auto-open the first row on load/refetch -- but only when nothing is
      // selected yet, or the previously active invoice fell off this page/filter,
      // so re-fetching after an edit doesn't yank focus away from what's open.
      setActiveInvoiceId((prev) => (prev && rows.some((r) => r.id === prev)) ? prev : (isDesktop ? (rows[0]?.id ?? null) : null));
    }
    setLoading(false);
  }, [searchTerm, statusFilter, showDeleted, page, supabase]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [searchTerm, statusFilter, showDeleted]);

  const handleSoftDelete = async (remarks: string) => {
    if (!invoiceToDelete) return;
    const { error } = await supabase
      .from("invoices")
      .update({
        is_deleted: true,
        deleted_remarks: remarks,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", invoiceToDelete.id);
    if (error) {
      console.error(error);
      toast.error("Failed to delete invoice");
    } else {
      toast.success("Invoice moved to trash");
      fetchInvoices();
    }
    setInvoiceToDelete(null);
  };

  const activeInvoice = useMemo(() => invoices.find(i => i.id === activeInvoiceId) ?? null, [invoices, activeInvoiceId]);

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <div className="space-x-2">
          <Button variant="outline" onClick={() => router.push("/dashboard/invoices/import")}>
            Import Historical Invoice
          </Button>
          <Button onClick={() => router.push("/dashboard/invoices/new")}>
            <Plus className="mr-2 h-4 w-4" /> New Invoice
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end mb-4">
        <div className="flex-1">
          <Input
            placeholder="Search by invoice number or customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_approval">Pending Approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox id="showDeleted" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(!!v)} />
          <Label htmlFor="showDeleted">Show deleted records</Label>
        </div>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="flex-1 min-h-0 border rounded overflow-hidden flex">
          {/* List pane -- hidden on mobile once an invoice is open, matching an
              email client's drill-in navigation; always visible at md+. */}
          <div className={cn("w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col", activeInvoice && "hidden md:flex")}>
            <div className="flex-1 overflow-y-auto">
              {invoices.map((inv) => (
                <InvoiceListItem
                  key={inv.id}
                  inv={inv}
                  active={inv.id === activeInvoiceId}
                  onOpen={() => setActiveInvoiceId(inv.id)}
                />
              ))}
              {invoices.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No invoices found.</p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn("flex-1 min-w-0", !activeInvoice && "hidden md:flex md:items-center md:justify-center")}>
            {activeInvoice ? (
              <InvoiceDetailPane
                inv={activeInvoice}
                onDelete={(inv) => { setInvoiceToDelete(inv); setDeleteDialogOpen(true); }}
                onBack={() => setActiveInvoiceId(null)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select an invoice to view details.</p>
            )}
          </div>
        </div>
      )}

      <DeleteInvoiceDialog
        invoice={invoiceToDelete}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleSoftDelete}
      />
    </div>
  );
}

export default function InvoicesPageGuarded() {
  return (
    <RequirePageAccess pageKey="invoices">
      <InvoicesPage />
    </RequirePageAccess>
  );
}
