"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import RequirePageAccess from "@/components/RequirePageAccess";
import { useRole } from "@/lib/auth/useRole";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { StatCardsRow } from "@/components/StatCardsRow";
import { RecordZohoInvoiceDialog } from "@/components/RecordZohoInvoiceDialog";
import { AttachInvoiceFileDialog } from "@/components/AttachInvoiceFileDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { EditSaleDialog } from "@/components/EditSaleDialog";
import { CustomerDetailDialog } from "@/components/CustomerDetailDialog";
import { CustomerSummaryLine } from "@/components/CustomerSummaryLine";
import type { CustomerSummary } from "@/lib/customer-summary";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { PAYMENT_STATUS_TONES, toneFor } from "@/lib/status-styles";
import { cn } from "@/lib/utils";

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
  invoice_number: string | null;
  invoice_id?: string | null;
  invoice_mode?: "erp" | "external";
  sku_description?: string | null;
  full_sku_code?: string | null;
  cpu?: string | null;
  generation?: string | null;
  ram?: string | null;
  ssd?: string | null;
  bundled_accessories_display?: { name: string; quantity: number }[];
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

  return (
    <>
      {sale.finalized ? (
        <span className="text-success inline-flex items-center gap-1.5">
          ✓ {sale.invoice_number}
          {/* Only Zoho-recorded invoices can be missing their PDF -- an ERP-generated
              one always has its own rendered PDF via /api/invoices/[id]/pdf. */}
          {isExternal && isOwner && sale.invoice_id && (
            <button onClick={() => setShowAttachDialog(true)} className="text-primary underline text-xs">
              File
            </button>
          )}
        </span>
      ) : sale.is_deleted ? (
        <span className="text-muted-foreground text-xs">Voided -- not invoiceable</span>
      ) : !isOwner ? (
        <span className="text-muted-foreground text-xs">Awaiting invoice</span>
      ) : isExternal ? (
        <button onClick={() => setShowZohoDialog(true)} className="text-warning underline text-xs" title="This entity is issuing invoices in Zoho during the transition">
          Record Zoho Invoice #
        </button>
      ) : (
        <button onClick={() => generateInvoice()} disabled={generating} className="text-warning underline text-xs inline-flex items-center gap-1">
          {generating && <Loader2 className="size-3 animate-spin" />}
          Generate Invoice
        </button>
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
            <button onClick={() => setShowEdit(true)} className="text-primary underline text-xs">
              Edit Sale
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Sold Date">{sale.sale_date?.slice(0, 10)}</Field>
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
        {sale.bundled_accessories_display && sale.bundled_accessories_display.length > 0 && (
          <Field label="Bundle">
            {sale.bundled_accessories_display.map((b, i) => (
              <span key={i} className="block">
                {b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ""}
              </span>
            ))}
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
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">{item(sale)}</p>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{sale.sale_date?.slice(0, 10)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {accountAbbrev(sale.payment_account) && (
            <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground" title={sale.payment_account ?? undefined}>
              {accountAbbrev(sale.payment_account)}
            </span>
          )}
          <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, sale.payment_status)}>{sale.payment_status}</StatusBadge>
          <StatusBadge tone={sale.is_deleted ? "danger" : sale.finalized ? "success" : "warning"}>
            {sale.is_deleted ? "Voided" : sale.finalized ? "Invoiced" : "Invoice Pending"}
          </StatusBadge>
        </div>
      </div>
    </button>
  );
}

const PAGE_SIZE_OPTIONS = [25, 50];

function SalesLedgerPage() {
  const { isOwner, canEditPage } = useRole();
  const canEditSale = isOwner || canEditPage("sales") || canEditPage("live_stock");
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
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
  const [statCounts, setStatCounts] = useState({ totalCount: 0, pendingCount: 0, partialCount: 0, awaitingInvoiceCount: 0 });
  // Which sale is open in the right-hand detail pane.
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);

  const buildFilterParams = useCallback((includeFinalized: boolean) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (paymentFilter) params.set("payment_status", paymentFilter);
    if (receivedIntoFilter) params.set("received_into", receivedIntoFilter);
    if (includeFinalized && awaitingInvoiceOnly) params.set("finalized", "false");
    return params;
  }, [search, paymentFilter, receivedIntoFilter, awaitingInvoiceOnly]);

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
      setActiveSaleId((prev) => (prev && data.some((s) => s.id === prev)) ? prev : (data[0]?.id ?? null));
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

  useEffect(() => { fetchSales(); }, [fetchSales]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Any row-level or batch mutation (edit, void, invoice, payment, customer
  // reassignment) needs both the visible page and the unpaginated stat counts
  // refreshed -- they're two separate fetches now that the table is paginated.
  const refresh = useCallback(() => { fetchSales(); fetchStats(); }, [fetchSales, fetchStats]);

  // Any filter change invalidates the current page's meaning -- reset to page 1
  // (mirrors StockView.tsx / customers/page.tsx's own reset-on-filter-change effect).
  useEffect(() => { setPage(1); }, [search, paymentFilter, receivedIntoFilter, awaitingInvoiceOnly, showVoided, pageSize]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Only un-finalized, non-voided sales are ever selectable for a combined
  // invoice -- select-all must match that same set, not every visible row.
  const selectableIds = sales.filter(s => !s.finalized && !s.is_deleted).map(s => s.id);
  const { totalCount, pendingCount, partialCount, awaitingInvoiceCount } = statCounts;

  // A combined invoice over the selected sales is either a Zoho recording (all
  // selected are external-mode) or ERP generation (none are) -- mixed selections
  // are already invalid (different entities) and the server rejects them.
  const selectedSales = sales.filter(s => selected.has(s.id));
  const allSelectedExternal = selectedSales.length >= 2 && selectedSales.every(s => s.invoice_mode === "external");

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
    <div className="p-4 flex flex-col" style={{ height: "calc(100vh - 2rem)" }}>
      <h1 className="text-2xl font-bold mb-1">Sales Ledger</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Every sale (units + accessories), payment tracking, and incentive attribution. New sales are recorded from <a href="/dashboard/entry/sell?return_to=%2Fdashboard%2Fsales" className="underline">New Entry → Sell</a>.
        Select 2 or more un-invoiced sales for the same customer and account to combine them into one invoice.
      </p>

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
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search customer, asset, serial, invoice, amount..."
          className="border p-2 rounded bg-card text-sm flex-1 min-w-[180px]"
        />
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="border p-2 rounded bg-card text-sm">
          <option value="">All Payment Statuses</option>
          <option value="pending">Payment Pending</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
        <select value={receivedIntoFilter} onChange={(e) => setReceivedIntoFilter(e.target.value)} className="border p-2 rounded bg-card text-sm">
          <option value="">All Received Into</option>
          {PAYMENT_ACCOUNTS.map((acc) => (
            <option key={acc} value={acc}>{acc}</option>
          ))}
        </select>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border p-2 rounded bg-card text-sm">
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm border p-2 rounded bg-card cursor-pointer">
          <Checkbox checked={showVoided} onCheckedChange={(v) => setShowVoided(!!v)} />
          Show voided
        </label>
        {isOwner && selected.size >= 2 && (
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

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="flex-1 min-h-0 border rounded overflow-hidden flex">
          {/* List pane -- hidden on mobile once a sale is open, matching an
              email client's drill-in navigation; always visible at md+. */}
          <div className={cn("w-full md:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col", activeSale && "hidden md:flex")}>
            <div className="flex-1 overflow-y-auto">
              {sales.map((s) => (
                <SaleListItem
                  key={s.id}
                  sale={s}
                  active={s.id === activeSaleId}
                  selectable={isOwner && !s.finalized && !s.is_deleted}
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
