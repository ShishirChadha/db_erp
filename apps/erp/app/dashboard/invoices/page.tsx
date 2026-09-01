"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Eye, Edit, FileText, Trash2, Mail, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import DeleteInvoiceDialog from "@/components/DeleteInvoiceDialog";
import RequirePageAccess from "@/components/RequirePageAccess";
import { apiFetch } from "@/lib/api-client";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { INVOICE_STATUS_TONES, toneFor } from "@/lib/status-styles";

const PAGE_SIZE = 25

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

    const { data, error, count } = await query;
    if (error) console.error(error);
    else { setInvoices(data || []); setTotal(count || 0); }
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

  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const handleDownloadPDF = async (invoiceId: string) => {
    const key = `${invoiceId}:pdf`;
    if (pendingKey) return;
    setPendingKey(key);
    try {
      const res = await apiFetch(`/api/invoices/${invoiceId}/pdf`);
      if (!res.ok) {
        toast.error("Failed to generate PDF");
        return;
      }
      const pdfBlob = await res.blob();
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, "_blank");
    } finally {
      setPendingKey(null);
    }
  };

  const handleEmail = async (invoiceId: string, customerEmail: string | null) => {
    if (pendingKey) return;
    const to = window.prompt("Send invoice to which email address?", customerEmail || "");
    if (!to) return;
    setPendingKey(`${invoiceId}:email`);
    try {
      const res = await apiFetch(`/api/invoices/${invoiceId}/email`, {
        method: "POST",
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to send email.");
      } else {
        toast.success(`Sent to ${data.sent_to}.`);
      }
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
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
      <div className="flex flex-wrap gap-4 items-end">
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

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Deleted Remarks</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center">Loading...</TableCell></TableRow>
            ) : invoices.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center">No invoices found.</TableCell></TableRow>
            ) : (
              invoices.map((inv, idx) => (
                <TableRow key={inv.id} className={inv.is_deleted ? "opacity-50" : ""}>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</TableCell>
                  <TableCell>{format(new Date(inv.invoice_date), "dd/MM/yyyy")}</TableCell>
                  <TableCell className="font-medium">
                    {inv.invoice_number}
                    {inv.source === "imported_zoho" && (
                      <Badge variant="outline" className="ml-2 text-xs">Imported</Badge>
                    )}
                  </TableCell>
                  <TableCell>{inv.customer_name}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{inv.grand_total?.toFixed(2)}</TableCell>
                  <TableCell><StatusBadge tone={toneFor(INVOICE_STATUS_TONES, inv.status)}>{inv.status.replace("_", " ")}</StatusBadge></TableCell>
                  <TableCell>{inv.deleted_remarks || "-"}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {!inv.is_deleted ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => router.push(`/dashboard/invoices/${inv.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {inv.status === "draft" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push(`/dashboard/invoices/${inv.id}/edit`)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownloadPDF(inv.id)}
                          disabled={pendingKey === `${inv.id}:pdf`}
                        >
                          {pendingKey === `${inv.id}:pdf` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEmail(inv.id, inv.customer_email)}
                          disabled={pendingKey === `${inv.id}:email`}
                        >
                          {pendingKey === `${inv.id}:email` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setInvoiceToDelete(inv);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Deleted</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

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