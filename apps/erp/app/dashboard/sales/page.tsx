"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Loader2, ArrowLeft, X, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { getCachedListPageSize } from "@/lib/useListPageSize";
import { useIsDesktopViewport } from "@/lib/useIsDesktopViewport";
import { useResizablePaneWidth } from "@/lib/useResizablePaneWidth";
import RequirePageAccess from "@/components/RequirePageAccess";
import { useRole } from "@/lib/auth/useRole";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { StatCardsRow } from "@/components/StatCardsRow";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerSummaryLine } from "@/components/CustomerSummaryLine";
import type { CustomerSummary } from "@/lib/customer-summary";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { PAYMENT_STATUS_TONES, toneFor } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

// Modal dialogs only render behind a click (gated by a state flag) -- code-split
// out of the initial bundle rather than shipped unconditionally.
const RecordZohoInvoiceDialog = dynamic(() => import("@/components/RecordZohoInvoiceDialog").then(m => m.RecordZohoInvoiceDialog), { ssr: false });
const AttachInvoiceFileDialog = dynamic(() => import("@/components/AttachInvoiceFileDialog").then(m => m.AttachInvoiceFileDialog), { ssr: false });
const EditSaleDialog = dynamic(() => import("@/components/EditSaleDialog").then(m => m.EditSaleDialog), { ssr: false });
const CustomerDetailDialog = dynamic(() => import("@/components/CustomerDetailDialog").then(m => m.CustomerDetailDialog), { ssr: false });
const ReasonConfirmDialog = dynamic(() => import("@/components/ReasonConfirmDialog").then(m => m.ReasonConfirmDialog), { ssr: false });

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

// Short tag for the list pane -- the account/entity a sale is billed against,
// abbreviated the way the business already refers to these three internally.
const ACCOUNT_ABBREV: Record<string, string> = { Digitalbluez: "DB", Techtenth: "TT", Cash: "CS" };
const accountAbbrev = (account: string | null) => (account ? ACCOUNT_ABBREV[account] ?? account : null);

interface Sale {
  id: string;
  sale_date: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_summary?: CustomerSummary | null;
  asset_number: string | null;
  serial_number: string | null;
  asset_ledger_id: string | null;
  accessory_id: string | null;
  accessory_quantity: number | null;
  repair_job_id: string | null;
  repair_job_number?: string | null;
  repair_description?: string | null;
  sale_base_price: number;
  sale_gst: number;
  sale_total: number;
  sale_type: string;
  payment_status: string;
  amount_paid: number;
  payment_account: string | null;
  sold_by: string | null;
  finalized: boolean;
  is_deleted?: boolean;
  refund_resolution?: { type: 'refund' | 'credit_note'; amount: number; payment_account?: string | null } | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_id?: string | null;
  original_sold_date?: string | null;
  invoice_mode?: "erp" | "external";
  sku_description?: string | null;
  full_sku_code?: string | null;
  hsn_code?: string | null;
  eway_bill_number?: string | null;
  eway_bill_date?: string | null;
  cpu?: string | null;
  generation?: string | null;
  ram?: string | null;
  ssd?: string | null;
  bundled_accessories_display?: { name: string; quantity: number; unit_price: number; hsn_code?: string | null }[];
  payment_date?: string | null;
}

// An asset_number only ever exists once a real PO has been attached (see
// CLAUDE.md) -- a unit can be QC'd/sold entirely by serial_number before
// that happens, and once it does, the serial number is still the physical
// identifier staff read off the unit itself, so both stay visible rather
// than the asset number silently hiding it.
const item = (s: Sale) =>
  s.asset_number
    ? (s.serial_number ? `${s.asset_number} · SN: ${s.serial_number}` : s.asset_number)
    : (s.serial_number ? `SN: ${s.serial_number}` : s.accessory_id ? "Accessory" : s.repair_job_id ? (s.repair_job_number || "Repair") : "—");

function CustomerCell({ sale, onDone, canReassign }: { sale: Sale; onDone: () => void; canReassign: boolean }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!sale.customer_id) return <>{sale.customer_name || "—"}</>;
  return (
    <>
      <button type="button" onClick={() => setShowDetail(true)} className="text-primary underline text-left">
        {sale.customer_name || "—"}
      </button>
      <CustomerSummaryLine summary={sale.customer_summary} />
      {showDetail && (
        <CustomerDetailDialog
          customerId={sale.customer_id}
          onClose={() => setShowDetail(false)}
          onCustomerUpdated={onDone}
          onReassign={canReassign ? async (newCustomerId) => {
            const res = await apiFetch(`/api/sales/${sale.id}`, {
              method: "PATCH",
              body: JSON.stringify({ customer_id: newCustomerId }),
            });
            if (res.ok) {
              setShowDetail(false);
              onDone();
            } else {
              const e = await res.json().catch(() => ({}));
              alert(e.error || "Failed to change customer.");
            }
          } : undefined}
        />
      )}
    </>
  );
}

// Links to the existing per-unit / per-SKU detail pages so the sold item can be
// inspected without leaving a trail of copy-pasted asset numbers into search boxes.
function ItemCell({ sale }: { sale: Sale }) {
  const label = item(sale);
  if (sale.asset_ledger_id) {
    return (
      <Link href={`/dashboard/stock/${sale.asset_ledger_id}`} className="text-primary underline">
        {label}
      </Link>
    );
  }
  if (sale.accessory_id) {
    return (
      <Link href={`/dashboard/accessories/${sale.accessory_id}`} className="text-primary underline">
        {label}
      </Link>
    );
  }
  if (sale.repair_job_id) {
    return (
      <Link href="/dashboard/repair-jobs" className="text-primary underline">
        {label}
      </Link>
    );
  }
  return <>{label}</>;
}

function InvoiceSection({ sale, isOwner, onDone }: { sale: Sale; isOwner: boolean; onDone: () => void }) {
  const [showZohoDialog, setShowZohoDialog] = useState(false);
  const [showAttachDialog, setShowAttachDialog] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [removeErr, setRemoveErr] = useState("");
  const isExternal = sale.invoice_mode === "external";
  const { run: generateInvoice, pending: generating } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/sales/${sale.id}/finalize`, { method: "POST", body: "{}" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || "Failed to generate invoice.");
    } else {
      onDone();
    }
  });

  const handleRemoveFromInvoice = async (reason: string) => {
    setRemoveErr("");
    const res = await apiFetch(`/api/invoices/${sale.invoice_id}/items/${sale.id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setRemoveErr(e.error || "Failed to remove from invoice.");
      throw new Error(e.error || "Failed to remove from invoice.");
    }
    setShowRemoveDialog(false);
    onDone();
  };

  return (
    <>
      {sale.finalized ? (
        <span className="text-success inline-flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1.5">
            ✓ {sale.invoice_number}
            {/* Only Zoho-recorded invoices can be missing their PDF -- an ERP-generated
                one always has its own rendered PDF via /api/invoices/[id]/pdf. */}
            {isExternal && isOwner && sale.invoice_id && (
              <Button variant="link" size="sm" onClick={() => setShowAttachDialog(true)} className="text-primary text-xs">
                File
              </Button>
            )}
            {isOwner && sale.invoice_id && (
              <button
                type="button"
                title="Remove this item from the invoice (e.g. it was checked into the invoice by mistake)"
                onClick={() => { setRemoveErr(""); setShowRemoveDialog(true); }}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
          {sale.invoice_date && (
            <span className="text-muted-foreground text-xs">
              {new Date(sale.invoice_date).toLocaleDateString()}
            </span>
          )}
        </span>
      ) : sale.is_deleted ? (
        <span className="text-muted-foreground text-xs inline-flex flex-col gap-0.5">
          Voided -- not invoiceable
          {sale.refund_resolution && (
            <span>
              {sale.refund_resolution.type === "refund"
                ? `Refunded ₹${sale.refund_resolution.amount.toFixed(2)}${sale.refund_resolution.payment_account ? ` via ${sale.refund_resolution.payment_account}` : ""}`
                : `₹${sale.refund_resolution.amount.toFixed(2)} credit note issued`}
            </span>
          )}
        </span>
      ) : !isOwner ? (
        <span className="text-muted-foreground text-xs">Awaiting invoice</span>
      ) : isExternal ? (
        <Button variant="link" size="sm" onClick={() => setShowZohoDialog(true)} className="text-warning text-xs" title="This entity is issuing invoices in Zoho during the transition">
          Record Zoho Invoice #
        </Button>
      ) : (
        <Button variant="link" size="sm" onClick={() => generateInvoice()} disabled={generating} className="text-warning text-xs inline-flex items-center gap-1">
          {generating && <Loader2 className="size-3 animate-spin" />}
          Generate Invoice
        </Button>
      )}
      {showZohoDialog && (
        <RecordZohoInvoiceDialog saleIds={[sale.id]} onClose={() => setShowZohoDialog(false)} onRecorded={onDone} />
      )}
      {showAttachDialog && sale.invoice_id && (
        <AttachInvoiceFileDialog
          invoiceId={sale.invoice_id}
          invoiceNumber={sale.invoice_number}
          onClose={() => setShowAttachDialog(false)}
          onAttached={onDone}
        />
      )}
      {showRemoveDialog && (
        <ReasonConfirmDialog
          open={showRemoveDialog}
          onOpenChange={(o) => !o && setShowRemoveDialog(false)}
          title="Remove this item from the invoice?"
          description={`This un-invoices the sale -- it stays intact and becomes available again to invoice separately later. The invoice's totals are recomputed from its remaining items. Refused if this is the invoice's only item.`}
          confirmLabel="Remove Item"
          error={removeErr}
          onConfirm={handleRemoveFromInvoice}
        />
      )}
    </>
  );
}

// The most recent sale_payments installment's date (see /api/sales's
// latestPaymentDatesBySaleId) -- clicking it opens Edit Sale's payment list, which
// has its own per-payment editable date field (owner-only), rather than duplicating
// a second date-edit control here.
function PaymentDateField({ sale, canEditSale, onDone }: { sale: Sale; canEditSale: boolean; onDone: () => void }) {
  const [showEdit, setShowEdit] = useState(false);
  if (!sale.payment_date) return <>—</>;
  return (
    <>
      {canEditSale ? (
        <button type="button" onClick={() => setShowEdit(true)} className="text-primary underline">
          {sale.payment_date.slice(0, 10)}
        </button>
      ) : (
        sale.payment_date.slice(0, 10)
      )}
      {showEdit && <EditSaleDialog saleId={sale.id} onClose={() => setShowEdit(false)} onSaved={onDone} />}
    </>
  );
}

// Not every sale needs an e-way bill (only GST goods movement above the
// threshold) -- a quiet, optional field filled in after the fact once the
// bill is raised, rather than something required at sale entry.
function EwayBillField({ sale, canEditSale, onDone }: { sale: Sale; canEditSale: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [err, setErr] = useState("");

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr("");
    const res = await apiFetch(`/api/sales/${sale.id}`, {
      method: "PATCH",
      body: JSON.stringify({ eway_bill_number: number.trim() || null, eway_bill_date: date || null }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error || "Failed to save.");
      throw new Error(e.error || "Failed to save.");
    }
    setEditing(false);
    onDone();
  });

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="E-way bill number" className="h-8 w-40" />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-36" />
        <Button size="sm" onClick={() => save()} disabled={saving} loading={saving}>Save</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
        {err && <span className="text-destructive text-xs">{err}</span>}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {sale.eway_bill_number || sale.eway_bill_date ? (
        <>
          {sale.eway_bill_number || "—"}
          {sale.eway_bill_date && ` · dated ${sale.eway_bill_date.slice(0, 10)}`}
        </>
      ) : (
        <span className="text-muted-foreground">Not set</span>
      )}
      {canEditSale && (
        <button
          type="button"
          title="Edit e-way bill"
          onClick={() => { setNumber(sale.eway_bill_number || ""); setDate(sale.eway_bill_date || ""); setErr(""); setEditing(true); }}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

// One field in the detail pane's label/value grid -- keeps every row's spacing
// and label styling consistent without repeating the wrapper markup.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  );
}

// Right-pane detail view -- everything the old wide table's columns showed for
// one sale, now laid out as a single record instead of a table row, matching an
// email/Zoho-Invoices-style reading pane.
function SaleDetailPane({ sale, isOwner, canEditSale, onDone, onBack }: {
  sale: Sale;
  isOwner: boolean;
  canEditSale: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const cpuPart = sale.cpu ? `${sale.generation ? `${sale.generation} Gen ` : ""}${sale.cpu}` : null;
  const specParts = [cpuPart, sale.ram, sale.ssd].filter(Boolean);

  return (
    <div className={cn("flex flex-col h-full", sale.is_deleted && "opacity-60")}>
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">
            <CustomerCell sale={sale} onDone={onDone} canReassign={canEditSale} />
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5"><ItemCell sale={sale} /></p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="text-xl font-semibold tabular-nums text-foreground">₹{sale.sale_total?.toFixed(2)}</span>
          <div className="flex items-center gap-1.5">
            <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, sale.payment_status)}>{sale.payment_status}</StatusBadge>
            <StatusBadge tone={sale.is_deleted ? "danger" : sale.finalized ? "success" : "warning"}>
              {sale.is_deleted ? "Voided" : sale.finalized ? "Invoiced" : "Invoice Pending"}
            </StatusBadge>
          </div>
          {canEditSale && (
            <Button variant="link" size="sm" onClick={() => setShowEdit(true)} className="text-primary text-xs">
              Edit Sale
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Sold Date">
          {sale.original_sold_date ? (
            <>
              {sale.original_sold_date.slice(0, 10)}
              <span className="text-muted-foreground"> · Replaced {sale.sale_date?.slice(0, 10)}</span>
            </>
          ) : (
            sale.sale_date?.slice(0, 10)
          )}
        </Field>
        <Field label="Payment Date"><PaymentDateField sale={sale} canEditSale={canEditSale} onDone={onDone} /></Field>
        <Field label="Description">
          {sale.sku_description || sale.full_sku_code || sale.repair_description || "—"}
          {sale.sku_description && sale.full_sku_code && (
            <span className="text-muted-foreground"> · {sale.full_sku_code}</span>
          )}
          {specParts.length > 0 && (
            <span className="text-muted-foreground"> · {specParts.join(" / ")}</span>
          )}
        </Field>
        {sale.hsn_code && <Field label="HSN Code">{sale.hsn_code}</Field>}
        <Field label="E-way Bill"><EwayBillField sale={sale} canEditSale={canEditSale} onDone={onDone} /></Field>
        {sale.bundled_accessories_display && sale.bundled_accessories_display.length > 0 && (
          <Field label="Bundled Accessories">
            <div className="space-y-0.5">
              {sale.bundled_accessories_display.map((b, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <span>
                    {b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ""}
                    {b.hsn_code && <span className="text-muted-foreground text-xs"> (HSN {b.hsn_code})</span>}
                  </span>
                  <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                    {b.unit_price > 0 ? `₹${(b.unit_price * b.quantity).toFixed(2)}` : "Free"}
                  </span>
                </div>
              ))}
            </div>
          </Field>
        )}
        <Field label="Amount Paid"><span className="tabular-nums">₹{sale.amount_paid?.toFixed(2)}</span></Field>
        <Field label="Received Into">{sale.payment_account || "—"}</Field>
        <Field label="Sold By">{sale.sold_by || "—"}</Field>
        <Field label="Invoice"><InvoiceSection sale={sale} isOwner={isOwner} onDone={onDone} /></Field>
      </div>

      {showEdit && <EditSaleDialog saleId={sale.id} onClose={() => setShowEdit(false)} onSaved={onDone} />}
    </div>
  );
}

// Left-pane list block -- deliberately just the 4 fields the user scans a ledger
// by (customer, serial/asset, sold date, status), matching an email-client /
// Zoho-Invoices-style list row. Everything else lives in the detail pane.
function SaleListItem({ sale, active, selectable, checked, onToggleCheck, onOpen }: {
  sale: Sale;
  active: boolean;
  selectable: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted",
        sale.is_deleted && "opacity-50"
      )}
    >
      {selectable && (
        <span onClick={(e) => e.stopPropagation()} className="pt-0.5">
          <Checkbox checked={checked} onCheckedChange={onToggleCheck} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{sale.customer_name || "—"}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">₹{sale.sale_total?.toFixed(2)}</span>
        </div>
        {sale.customer_summary?.contact_person && (
          <p className="text-xs text-muted-foreground truncate">{sale.customer_summary.contact_person}</p>
        )}
        <div className="flex items-baseline justify-between gap-2 mt-1">
          <p className="text-xs text-muted-foreground truncate">{item(sale)}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            {accountAbbrev(sale.payment_account) && (
              <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground" title={sale.payment_account ?? undefined}>
                {accountAbbrev(sale.payment_account)}
              </span>
            )}
            <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, sale.payment_status)}>{sale.payment_status}</StatusBadge>
            <StatusBadge tone={sale.is_deleted ? "danger" : sale.finalized ? "success" : "warning"}>
              {sale.is_deleted ? "Voided" : sale.finalized ? "Invoiced" : "Pending"}
            </StatusBadge>
            <span
              className="text-xs text-muted-foreground whitespace-nowrap"
              title={sale.original_sold_date ? `Originally sold ${sale.original_sold_date.slice(0, 10)}, replaced ${sale.sale_date?.slice(0, 10)}` : undefined}
            >
              {(sale.original_sold_date || sale.sale_date)?.slice(0, 10)}
              {sale.original_sold_date && <sup className="ml-0.5">R</sup>}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// This page has its own page-size dropdown (a self-service override on top of
// the global default below) -- 25 stays an option for anyone who prefers a
// shorter list here specifically.
const PAGE_SIZE_OPTIONS = [25, 50, 100];

function SalesLedgerPage() {
  const { isOwner, canEditPage } = useRole();
  const canEditSale = isOwner || canEditPage("sales") || canEditPage("live_stock");
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // Seeded from the global "rows per page" setting (Settings > List Page Size)
  // instead of a hardcoded 25 -- the dropdown below still lets this one page be
  // overridden locally.
  const [pageSize, setPageSize] = useState(() => getCachedListPageSize());
  // searchInput updates on every keystroke (so the box feels responsive); search only
  // catches up 300ms after typing stops, and is what actually drives fetchSales below --
  // without this, every keystroke fired its own full /api/sales request (each doing
  // several sequential DB round trips server-side over the full sales table), which
  // piled up overlapping in-flight requests and was the real cause of "search is slow /
  // sometimes errors" here. Same fix already applied to StockView.tsx's search box.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [paymentFilter, setPaymentFilter] = useState("");
  const [receivedIntoFilter, setReceivedIntoFilter] = useState("");
  // Pinning a customer (via the search-suggestion dropdown below) swaps free-text
  // search for an exact customer_id filter -- that's what guarantees EVERY sale for
  // that customer shows, latest first, rather than only whatever still matches the
  // typed text (Zoho's "click a suggested invoice -> see this customer's history").
  const [customerFilter, setCustomerFilter] = useState<{ id: string; name: string } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // 'YYYY-MM', native <input type="month">.
  const [monthFilter, setMonthFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchErr, setBatchErr] = useState("");
  const [awaitingInvoiceOnly, setAwaitingInvoiceOnly] = useState(false);
  // Voided sales are excluded from the ledger by default (matches every other
  // filter/stat here); toggling this shows ONLY voided ones, as an audit/reference
  // view -- mirrors the Vendors page's "Show deleted" pattern.
  const [showVoided, setShowVoided] = useState(false);
  const [showBatchZoho, setShowBatchZoho] = useState(false);
  // Stat cards (Total Sold / Pending / Partial / Awaiting Invoice) need counts over
  // every matching sale, not just the current page -- SQL exact counts (see
  // /api/sales' counts=true branch), same pattern StockView.tsx uses for its own.
  const [statCounts, setStatCounts] = useState({ totalCount: 0, pendingCount: 0, partialCount: 0, awaitingInvoiceCount: 0, sumSaleTotal: 0, sumAmountPaid: 0 });
  // Which sale is open in the right-hand detail pane.
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const isDesktop = useIsDesktopViewport();
  const { width: listPaneWidth, handleMouseDown: handlePaneResize } = useResizablePaneWidth("sales-list-pane-width");

  const buildFilterParams = useCallback((includeFinalized: boolean) => {
    const params = new URLSearchParams();
    if (customerFilter) params.set("customer_id", customerFilter.id);
    else if (search) params.set("search", search);
    if (paymentFilter) params.set("payment_status", paymentFilter);
    if (receivedIntoFilter) params.set("received_into", receivedIntoFilter);
    if (monthFilter) params.set("month", monthFilter);
    if (includeFinalized && awaitingInvoiceOnly) params.set("finalized", "false");
    return params;
  }, [search, customerFilter, paymentFilter, receivedIntoFilter, monthFilter, awaitingInvoiceOnly]);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    const params = buildFilterParams(true);
    if (showVoided) params.set("voided", "true");
    params.set("page", String(page));
    params.set("limit", String(pageSize));
    // Newest sold first, matching every other ledger page's date-column default.
    params.set("sort", "sale_date");
    params.set("dir", "desc");
    const res = await apiFetch(`/api/sales?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      const data: Sale[] = json.data || [];
      setSales(data);
      setTotal(json.total || 0);
      // Auto-open the first row on desktop (email/Zoho-Invoices convention) --
      // but only when nothing is selected yet, or the previously active sale
      // fell off this page/filter, so re-fetching after an edit doesn't yank
      // focus away from what the user is currently looking at.
      setActiveSaleId((prev) => (prev && data.some((s) => s.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null));
    } else {
      setSales([]);
      setTotal(0);
      setActiveSaleId(null);
    }
    setLoading(false);
  }, [buildFilterParams, showVoided, page, pageSize]);

  // SQL exact counts (see /api/sales' counts=true branch), deliberately excluding
  // the awaitingInvoiceOnly-driven `finalized` filter so Pending/Partial/Awaiting
  // Invoice always count across every matching sale independent of that toggle.
  const fetchStats = useCallback(async () => {
    const params = buildFilterParams(false);
    params.set("counts", "true");
    const res = await apiFetch(`/api/sales?${params.toString()}`);
    if (res.ok) setStatCounts(await res.json());
  }, [buildFilterParams]);

  // Any filter change invalidates the current page's meaning -- reset to page 1
  // during render (React's supported "adjust state while rendering" pattern),
  // not in a separate effect keyed on the same filters -- that shape fired
  // fetchSales twice per filter change (once with the new filter but the
  // stale page, again once the reset effect changed `page`), and on a slow
  // connection the stale response could land last and overwrite correct rows.
  const filterKey = JSON.stringify([search, customerFilter?.id, paymentFilter, receivedIntoFilter, monthFilter, awaitingInvoiceOnly, showVoided, pageSize]);
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  useEffect(() => { fetchSales(); }, [fetchSales]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Any row-level or batch mutation (edit, void, invoice, payment, customer
  // reassignment) needs both the visible page and the unpaginated stat counts
  // refreshed -- they're two separate fetches now that the table is paginated.
  const refresh = useCallback(() => { fetchSales(); fetchStats(); }, [fetchSales, fetchStats]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const { totalCount, pendingCount, partialCount, awaitingInvoiceCount, sumSaleTotal, sumAmountPaid } = statCounts;

  // Checkboxes are selectable on every row (any sale can be picked to total up for a
  // bank-reconciliation check) -- but combining into ONE invoice still only makes sense
  // for a set that's entirely un-finalized and non-voided, so that eligibility is
  // checked separately from "is this row selected at all" rather than baked into which
  // rows can be checked in the first place.
  const selectedSales = sales.filter(s => selected.has(s.id));
  const selectedTotal = selectedSales.reduce((a, s) => a + (Number(s.sale_total) || 0), 0);
  const selectedPaidTotal = selectedSales.reduce((a, s) => a + (Number(s.amount_paid) || 0), 0);
  const eligibleForCombinedInvoice = selectedSales.length >= 2 && selectedSales.every(s => !s.finalized && !s.is_deleted);

  // A combined invoice over the selected sales is either a Zoho recording (all
  // selected are external-mode) or ERP generation (none are) -- mixed selections
  // are already invalid (different entities) and the server rejects them.
  const allSelectedExternal = eligibleForCombinedInvoice && selectedSales.every(s => s.invoice_mode === "external");

  const { run: generateCombinedInvoice, pending: batchBusy } = useAsyncAction(async () => {
    setBatchErr("");
    const res = await apiFetch("/api/sales/finalize-batch", {
      method: "POST",
      body: JSON.stringify({ sale_ids: [...selected] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBatchErr(data.error || "Failed to generate combined invoice.");
    } else {
      setSelected(new Set());
      refresh();
    }
  });

  const activeSale = useMemo(() => sales.find(s => s.id === activeSaleId) ?? null, [sales, activeSaleId]);

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1
          className="text-xl font-bold shrink-0"
          title="Every sale (units + accessories), payment tracking, and incentive attribution. Select 2+ un-invoiced sales for the same customer and account to combine them into one invoice."
        >
          Sales Ledger
        </h1>
        <a
          href="/dashboard/entry/sell?return_to=%2Fdashboard%2Fsales"
          className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium shrink-0"
        >
          + New Sale
        </a>
      </div>

      <StatCardsRow
        cards={[
          { label: "Total Sold", value: totalCount },
          {
            label: "Payment Pending",
            value: pendingCount,
            active: paymentFilter === "pending",
            onClick: () => setPaymentFilter(paymentFilter === "pending" ? "" : "pending"),
          },
          {
            label: "Partial Payment",
            value: partialCount,
            active: paymentFilter === "partial",
            onClick: () => setPaymentFilter(paymentFilter === "partial" ? "" : "partial"),
          },
          {
            label: "Awaiting Invoice",
            value: awaitingInvoiceCount,
            active: awaitingInvoiceOnly,
            onClick: () => setAwaitingInvoiceOnly(prev => !prev),
          },
        ]}
      />

      <div className="flex gap-2 flex-wrap items-center mb-2">
        <div className="relative flex-1 min-w-[180px]">
          {customerFilter ? (
            <div className="h-8 flex items-center gap-1.5 px-3 border rounded-md bg-muted text-sm">
              <span className="truncate">Customer: <span className="font-medium">{customerFilter.name}</span></span>
              <button type="button" onClick={() => setCustomerFilter(null)} className="text-muted-foreground hover:text-foreground ml-auto">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                // Delay so a suggestion's onClick fires before the dropdown unmounts.
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Search customer, asset, serial, invoice, amount..."
                className="w-full"
              />
              {showSuggestions && searchInput.trim() && (() => {
                const suggestions = sales.filter((s) => s.customer_id).slice(0, 8);
                return suggestions.length > 0 ? (
                  <div className="absolute z-20 top-full left-0 mt-1 w-full max-w-md bg-card border rounded-md shadow-lg max-h-72 overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setCustomerFilter({ id: s.customer_id!, name: s.customer_name || "Unknown customer" });
                          setSearchInput("");
                          setShowSuggestions(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b border-border last:border-0 flex items-baseline justify-between gap-2"
                      >
                        <span className="truncate">
                          <span className="font-medium">{s.customer_name || "—"}</span>
                          <span className="text-muted-foreground"> · {(s.original_sold_date || s.sale_date)?.slice(0, 10)}</span>
                        </span>
                        <span className="tabular-nums shrink-0">₹{s.sale_total?.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
            </>
          )}
        </div>
        <Select value={paymentFilter || "all"} onValueChange={(v) => setPaymentFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-auto"><SelectValue placeholder="All Payment Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payment Statuses</SelectItem>
            <SelectItem value="pending">Payment Pending</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
        <Select value={receivedIntoFilter || "all"} onValueChange={(v) => setReceivedIntoFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-auto"><SelectValue placeholder="All Received Into" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Received Into</SelectItem>
            {PAYMENT_ACCOUNTS.map((acc) => (
              <SelectItem key={acc} value={acc}>{acc}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="h-8 w-auto"
            title="Filter by month"
          />
          {monthFilter && (
            <button type="button" onClick={() => setMonthFilter("")} title="Clear month filter" className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
          <SelectTrigger className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm border p-2 rounded bg-card cursor-pointer">
          <Checkbox checked={showVoided} onCheckedChange={(v) => setShowVoided(!!v)} />
          Show voided
        </label>
        {isOwner && eligibleForCombinedInvoice && (
          allSelectedExternal ? (
            <button
              onClick={() => setShowBatchZoho(true)}
              className="bg-warning text-warning-foreground px-3 py-2 rounded text-sm"
            >
              Record Combined Zoho Invoice # ({selected.size})
            </button>
          ) : (
            <button
              onClick={() => generateCombinedInvoice()}
              disabled={batchBusy}
              className="bg-warning text-warning-foreground px-3 py-2 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {batchBusy && <Loader2 className="size-4 animate-spin" />}
              {batchBusy ? "Generating…" : `Generate Combined Invoice (${selected.size})`}
            </button>
          )
        )}
        {batchErr && <span className="text-destructive text-xs">{batchErr}</span>}
      </div>
      {showBatchZoho && (
        <RecordZohoInvoiceDialog
          saleIds={[...selected]}
          onClose={() => setShowBatchZoho(false)}
          onRecorded={() => { setSelected(new Set()); refresh(); }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-muted-foreground">
        {/* Sum for whatever's currently searched/filtered (e.g. every line item on one
            invoice number) -- computed server-side (see /api/sales' counts=true branch),
            so it stays accurate across every matching sale, not just the current page,
            without fetching them all into the browser to add up. */}
        <span>
          {total} sale{total === 1 ? "" : "s"} in this view -- total <span className="font-medium text-foreground">₹{sumSaleTotal.toFixed(2)}</span>
          {" "}· paid <span className="font-medium text-foreground">₹{sumAmountPaid.toFixed(2)}</span>
        </span>
        {isOwner && selected.size > 0 && (
          <span>
            {selected.size} selected -- total <span className="font-medium text-foreground">₹{selectedTotal.toFixed(2)}</span>
            {" "}· paid <span className="font-medium text-foreground">₹{selectedPaidTotal.toFixed(2)}</span>
            {" "}
            <button type="button" onClick={() => setSelected(new Set())} className="underline hover:text-foreground">Clear</button>
          </span>
        )}
      </div>

      {loading && sales.length === 0 ? (
        <div>Loading...</div>
      ) : (
        <div className={cn(
          "flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex",
          // A background refresh (e.g. after Edit Sale saves) re-fetches in place
          // rather than unmounting this pane -- that's what keeps the list's scroll
          // position intact instead of snapping back to the top every time. This dim
          // is just a subtle "updating" signal, not a full loading-state swap.
          loading && "opacity-60"
        )}>
          {/* List pane -- hidden on mobile once a sale is open, matching an
              email client's drill-in navigation; always visible at md+. */}
          <div
            className={cn("w-full md:flex-shrink-0 border-r border-border flex flex-col", activeSale && "hidden md:flex")}
            style={isDesktop ? { width: listPaneWidth } : undefined}
          >
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
              {sales.map((s) => (
                <SaleListItem
                  key={s.id}
                  sale={s}
                  active={s.id === activeSaleId}
                  selectable={isOwner}
                  checked={selected.has(s.id)}
                  onToggleCheck={() => toggleSelect(s.id)}
                  onOpen={() => setActiveSaleId(s.id)}
                />
              ))}
              {sales.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No sales found.</p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
            </div>
          </div>

{isDesktop && (
  <div
    onMouseDown={handlePaneResize}
    className="hidden md:block w-1.5 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
    title="Drag to resize"
  />
)}

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn("flex-1 min-w-0", !activeSale && "hidden md:flex md:items-center md:justify-center")}>
            {activeSale ? (
              <SaleDetailPane
                sale={activeSale}
                isOwner={isOwner}
                canEditSale={canEditSale}
                onDone={refresh}
                onBack={() => setActiveSaleId(null)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a sale to view details.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SalesPageGuarded() {
  return (
    <RequirePageAccess pageKey="sales">
      <SalesLedgerPage />
    </RequirePageAccess>
  );
}
