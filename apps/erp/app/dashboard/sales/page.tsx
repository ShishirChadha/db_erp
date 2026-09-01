"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Loader2, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import RequirePageAccess from "@/components/RequirePageAccess";
import { useRole } from "@/lib/auth/useRole";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { StatCardsRow } from "@/components/StatCardsRow";
import { RecordZohoInvoiceDialog } from "@/components/RecordZohoInvoiceDialog";
import { AttachInvoiceFileDialog } from "@/components/AttachInvoiceFileDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { EditSaleDialog } from "@/components/EditSaleDialog";
import { ResizableHeader } from "@/components/ResizableHeader";
import { CustomerDetailDialog } from "@/components/CustomerDetailDialog";
import { Pagination } from "@/components/Pagination";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];
const COLUMN_PREFS_KEY = "sales-ledger-visible-columns";

interface Sale {
  id: string;
  sale_date: string;
  customer_id: string | null;
  customer_name: string | null;
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
  ram?: string | null;
  ssd?: string | null;
  bundled_accessories_display?: { name: string; quantity: number }[];
}

type SortDir = "asc" | "desc";

// Column-definition-driven table: one place per column controls its header
// label, sort accessor, cell render, and default visibility/width -- keeps the
// header row, sort logic, and column-selector all in sync instead of hardcoding
// three separate lists.
interface ColumnDef {
  key: string;
  label: string;
  className?: string;
  defaultWidth: number;
  sortable?: boolean; // sort key sent to the server (see /api/sales's getSortValue)
  render: (s: Sale, ctx: RowCtx) => React.ReactNode;
  optional?: boolean; // can be hidden via the column selector
  defaultVisible?: boolean;
}

interface RowCtx {
  index: number;
  page: number;
  pageSize: number;
  isOwner: boolean;
  canEditSale: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDone: () => void;
}

const item = (s: Sale) =>
  s.asset_number || (s.serial_number ? `SN: ${s.serial_number}` : s.accessory_id ? "Accessory" : s.repair_job_id ? (s.repair_job_number || "Repair") : "—");

const COLUMNS: ColumnDef[] = [
  {
    key: "index",
    label: "#",
    className: "border p-2 text-right",
    defaultWidth: 50,
    render: (_s, ctx) => <span className="text-muted-foreground tabular-nums">{(ctx.page - 1) * ctx.pageSize + ctx.index + 1}</span>,
  },
  {
    key: "sale_date",
    label: "Date",
    className: "border p-2 whitespace-nowrap",
    defaultWidth: 110,
    sortable: true,
    render: (s) => s.sale_date?.slice(0, 10),
    optional: true,
    defaultVisible: true,
  },
  {
    key: "customer_name",
    label: "Customer",
    className: "border p-2",
    defaultWidth: 150,
    sortable: true,
    render: (s, ctx) => <CustomerCell sale={s} onDone={ctx.onDone} canReassign={ctx.canEditSale} />,
    optional: true,
    defaultVisible: true,
  },
  {
    key: "item",
    label: "Item",
    className: "border p-2",
    defaultWidth: 150,
    sortable: true,
    render: (s) => <ItemCell sale={s} />,
    optional: true,
    defaultVisible: true,
  },
  {
    key: "description",
    label: "Description",
    className: "border p-2",
    defaultWidth: 200,
    sortable: true,
    render: (s) => (
      <>
        {s.sku_description || s.full_sku_code || s.repair_description || "—"}
        {s.sku_description && s.full_sku_code && (
          <span className="text-muted-foreground"> · {s.full_sku_code}</span>
        )}
      </>
    ),
    optional: true,
    defaultVisible: true,
  },
  {
    key: "ram",
    label: "RAM",
    className: "border p-2 whitespace-nowrap",
    defaultWidth: 90,
    sortable: true,
    render: (s) => s.ram || "—",
    optional: true,
    defaultVisible: true,
  },
  {
    key: "ssd",
    label: "SSD",
    className: "border p-2 whitespace-nowrap",
    defaultWidth: 100,
    sortable: true,
    render: (s) => s.ssd || "—",
    optional: true,
    defaultVisible: true,
  },
  {
    key: "bundle",
    label: "Bundle",
    className: "border p-2",
    defaultWidth: 180,
    sortable: true,
    render: (s) =>
      s.bundled_accessories_display && s.bundled_accessories_display.length > 0
        ? s.bundled_accessories_display.map((b, i) => (
            <span key={i} className="block">
              {b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ""}
            </span>
          ))
        : "—",
    optional: true,
    defaultVisible: true,
  },
  {
    key: "sale_total",
    label: "Total",
    className: "border p-2 text-right",
    defaultWidth: 100,
    sortable: true,
    render: (s) => <span className="tabular-nums">₹{s.sale_total?.toFixed(2)}</span>,
    optional: true,
    defaultVisible: true,
  },
  {
    key: "payment_status",
    label: "Payment",
    className: "border p-2",
    defaultWidth: 100,
    sortable: true,
    render: (s) => (
      <>
        <span className="capitalize">{s.payment_status}</span>
        {s.is_deleted && <span className="ml-1 text-destructive text-xs font-medium">VOIDED</span>}
      </>
    ),
    optional: true,
    defaultVisible: true,
  },
  {
    key: "amount_paid",
    label: "Amount Paid",
    className: "border p-2",
    defaultWidth: 120,
    sortable: true,
    render: (s) => <span className="tabular-nums">₹{s.amount_paid?.toFixed(2)}</span>,
    optional: true,
    defaultVisible: true,
  },
  {
    key: "payment_account",
    label: "Received Into",
    className: "border p-2",
    defaultWidth: 120,
    sortable: true,
    render: (s) => s.payment_account || "—",
    optional: true,
    defaultVisible: true,
  },
  {
    key: "sold_by",
    label: "Sold By",
    className: "border p-2",
    defaultWidth: 100,
    sortable: true,
    render: (s) => s.sold_by || "—",
    optional: true,
    defaultVisible: true,
  },
  {
    key: "invoice",
    label: "Invoice",
    className: "border p-2",
    defaultWidth: 140,
    sortable: true,
    render: (s, ctx) => (
      <InvoiceCell sale={s} isOwner={ctx.isOwner} onDone={ctx.onDone} />
    ),
    optional: true,
    defaultVisible: true,
  },
  {
    key: "actions",
    label: "Actions",
    className: "border p-2",
    defaultWidth: 90,
    render: (s, ctx) => (
      <ActionsCell sale={s} canEditSale={ctx.canEditSale} onDone={ctx.onDone} />
    ),
  },
];

function CustomerCell({ sale, onDone, canReassign }: { sale: Sale; onDone: () => void; canReassign: boolean }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!sale.customer_id) return <>{sale.customer_name || "—"}</>;
  return (
    <>
      <button type="button" onClick={() => setShowDetail(true)} className="text-primary underline text-left">
        {sale.customer_name || "—"}
      </button>
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

function InvoiceCell({ sale, isOwner, onDone }: { sale: Sale; isOwner: boolean; onDone: () => void }) {
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

function ActionsCell({ sale, canEditSale, onDone }: { sale: Sale; canEditSale: boolean; onDone: () => void }) {
  const [showEdit, setShowEdit] = useState(false);
  return (
    <>
      {canEditSale && (
        <button onClick={() => setShowEdit(true)} className="text-primary underline text-xs">
          Edit
        </button>
      )}
      {showEdit && <EditSaleDialog saleId={sale.id} onClose={() => setShowEdit(false)} onSaved={onDone} />}
    </>
  );
}

function SaleRow({ sale, ctx, visibleColumns }: { sale: Sale; ctx: RowCtx; visibleColumns: ColumnDef[] }) {
  return (
    <tr className={sale.is_deleted ? "opacity-50" : undefined}>
      <td className="border p-2 w-8 text-center">
        {/* Voided sales are a read-only reference view -- never selectable for a
            combined invoice regardless of their (frozen) finalized flag. */}
        {!sale.finalized && !sale.is_deleted && ctx.isOwner && (
          <Checkbox checked={ctx.selected} onCheckedChange={() => ctx.onToggleSelect(sale.id)} />
        )}
      </td>
      {visibleColumns.map((col) => (
        <td key={col.key} className={col.className}>
          {col.render(sale, ctx)}
        </td>
      ))}
    </tr>
  );
}

function ColumnSelector({ visible, onChange }: { visible: Set<string>; onChange: (next: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const optionalColumns = COLUMNS.filter((c) => c.optional);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="border p-2 rounded text-sm inline-flex items-center gap-1"
      >
        Columns <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 bg-card border rounded shadow-md p-2 w-48">
            {optionalColumns.map((col) => (
              <label key={col.key} className="flex items-center gap-2 text-sm py-1 px-1 cursor-pointer hover:bg-muted rounded">
                <Checkbox
                  checked={visible.has(col.key)}
                  onCheckedChange={(checked) => {
                    const next = new Set(visible);
                    if (checked) next.add(col.key); else next.delete(col.key);
                    onChange(next);
                  }}
                />
                {col.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
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
  const [search, setSearch] = useState("");
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
  // Defaults to newest-first by Date -- matches the old fixed `order('created_at',
  // {ascending: false})` the API used before sorting became a user-driven param.
  const [sortKey, setSortKey] = useState<string | null>("sale_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  // Sticky toolbar (search/filters + scroll buttons) stays pinned to the top of the
  // page. The table header below it is sticky within its own scroll box (see the
  // table wrapper's maxHeight comment), so no cross-element height measurement is
  // needed to keep them from overlapping.
  const toolbarRef = useRef<HTMLDivElement>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth]))
  );

  const CHECKBOX_COL_WIDTH = 40;
  const resetColumnWidths = () => {
    setColWidths(Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth])));
  };

  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(() => {
    const defaults = new Set(COLUMNS.filter((c) => !c.optional || c.defaultVisible).map((c) => c.key));
    if (typeof window === "undefined") return defaults;
    try {
      const saved = window.localStorage.getItem(COLUMN_PREFS_KEY);
      if (!saved) return defaults;
      const savedKeys: string[] = JSON.parse(saved);
      // Only optional columns are ever hidden -- mandatory columns always stay visible
      // even if a stale saved list from an older column set doesn't mention them.
      return new Set(COLUMNS.filter((c) => !c.optional || savedKeys.includes(c.key)).map((c) => c.key));
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify([...visibleColumnKeys]));
  }, [visibleColumnKeys]);

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => visibleColumnKeys.has(c.key)),
    [visibleColumnKeys]
  );

  const fitColumnsToScreen = () => {
    const container = scrollRef.current;
    if (!container) return;
    const available = container.clientWidth - CHECKBOX_COL_WIDTH;
    const currentTotal = visibleColumns.reduce((sum, c) => sum + (colWidths[c.key] ?? c.defaultWidth), 0);
    if (currentTotal <= 0 || available <= 0) return;
    const scale = available / currentTotal;
    const MIN_WIDTH = 50;
    setColWidths((prev) => {
      const next = { ...prev };
      visibleColumns.forEach((c) => {
        next[c.key] = Math.max(MIN_WIDTH, Math.round((prev[c.key] ?? c.defaultWidth) * scale));
      });
      return next;
    });
  };

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
    // Sorting has to happen server-side, over the full filtered set, before
    // pagination slices it -- otherwise "sort by X" would only reorder whichever
    // page happened to already be loaded instead of sorting across all pages.
    if (sortKey) {
      params.set("sort", sortKey);
      params.set("dir", sortDir);
    }
    const res = await apiFetch(`/api/sales?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      setSales(json.data || []);
      setTotal(json.total || 0);
    } else {
      setSales([]);
      setTotal(0);
    }
    setLoading(false);
  }, [buildFilterParams, showVoided, page, pageSize, sortKey, sortDir]);

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

  // Any filter or sort change invalidates the current page's meaning -- reset to
  // page 1 (mirrors StockView.tsx / customers/page.tsx's own reset-on-filter-change
  // effect; sort is included since it's now a server-side full-dataset sort).
  useEffect(() => { setPage(1); }, [search, paymentFilter, receivedIntoFilter, awaitingInvoiceOnly, showVoided, pageSize, sortKey, sortDir]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Both awaitingInvoiceOnly filtering and sorting now happen server-side (over the
  // full filtered dataset, before pagination -- see fetchSales), so `sales` already
  // reflects them; no further client-side transform needed.
  const displayedSales = sales;

  // Only un-finalized, non-voided sales are ever selectable (SaleRow only renders a
  // checkbox for those) -- select-all must match that same set, not every visible row.
  const selectableIds = displayedSales.filter(s => !s.finalized && !s.is_deleted).map(s => s.id);
  const toggleSelectAll = () => {
    setSelected(prev => prev.size === selectableIds.length ? new Set() : new Set(selectableIds));
  };
  // Sourced from the SQL counts fetch -- counts every matching sale, not just the
  // current page (see fetchStats above).
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

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sales Ledger</h1>
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

      {/* Sticky toolbar: search/filters + horizontal scroll controls stay pinned
          to the top of the page while scrolling down through rows. */}
      <div ref={toolbarRef} className="sticky top-0 z-30 bg-muted pb-3">
        <div className="flex gap-4 flex-wrap items-center pt-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, asset, serial, invoice..."
            className="border p-2 rounded bg-card"
          />
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="border p-2 rounded bg-card">
            <option value="">All Payment Statuses</option>
            <option value="pending">Payment Pending</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </select>
          <select value={receivedIntoFilter} onChange={(e) => setReceivedIntoFilter(e.target.value)} className="border p-2 rounded bg-card">
            <option value="">All Received Into</option>
            {PAYMENT_ACCOUNTS.map((acc) => (
              <option key={acc} value={acc}>{acc}</option>
            ))}
          </select>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border p-2 rounded bg-card">
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
          <ColumnSelector visible={visibleColumnKeys} onChange={setVisibleColumnKeys} />
          <label className="flex items-center gap-1.5 text-sm border p-2 rounded bg-card cursor-pointer">
            <Checkbox checked={showVoided} onCheckedChange={(v) => setShowVoided(!!v)} />
            Show voided sales
          </label>
          {isOwner && selected.size >= 2 && (
            allSelectedExternal ? (
              <button
                onClick={() => setShowBatchZoho(true)}
                className="bg-warning text-warning-foreground px-3 py-2 rounded text-sm"
              >
                Record Combined Zoho Invoice # ({selected.size} sales)
              </button>
            ) : (
              <button
                onClick={() => generateCombinedInvoice()}
                disabled={batchBusy}
                className="bg-warning text-warning-foreground px-3 py-2 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {batchBusy && <Loader2 className="size-4 animate-spin" />}
                {batchBusy ? "Generating…" : `Generate Combined Invoice (${selected.size} sales)`}
              </button>
            )
          )}
          {batchErr && <span className="text-destructive text-xs">{batchErr}</span>}
        </div>

        {!loading && (
          <div className="flex justify-between items-center gap-2 pt-2">
            <div className="flex gap-2">
              <button onClick={fitColumnsToScreen} className="border rounded px-2 py-1 text-xs text-muted-foreground bg-card hover:bg-muted">
                Fit Columns to Screen
              </button>
              <button onClick={resetColumnWidths} className="border rounded px-2 py-1 text-xs text-muted-foreground bg-card hover:bg-muted">
                Reset Widths
              </button>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => scrollBy(-300)}
                className="border rounded p-1 text-muted-foreground bg-card hover:bg-muted"
                title="Scroll left"
                aria-label="Scroll table left"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={() => scrollBy(300)}
                className="border rounded p-1 text-muted-foreground bg-card hover:bg-muted"
                title="Scroll right"
                aria-label="Scroll table right"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
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
        <div className="relative">
          {/* overflow-x-auto alone makes the browser treat this element as a scroll
              container in BOTH axes per the CSS Overflow spec, which broke the sticky
              header's "top" offset (it resolved against this ever-growing box instead
              of the page). Giving it a bounded height + overflow-y-auto makes it a real,
              self-contained scroll box, so `sticky top-0` inside it works reliably --
              the table now scrolls within its own frame instead of the whole page. */}
          <div ref={scrollRef} className="overflow-auto border rounded" style={{ maxHeight: "calc(100vh - 320px)" }}>
            <table className="border text-sm" style={{ tableLayout: "fixed", width: "max-content" }}>
              <colgroup>
                <col style={{ width: 40 }} />
                {visibleColumns.map((col) => (
                  <col key={col.key} style={{ width: colWidths[col.key] }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th
                    className="border p-2 text-center sticky top-0 z-20 bg-card"
                  >
                    {isOwner && selectableIds.length > 0 && (
                      <Checkbox
                        checked={
                          selected.size === selectableIds.length
                            ? true
                            : selected.size > 0
                            ? "indeterminate"
                            : false
                        }
                        onCheckedChange={toggleSelectAll}
                      />
                    )}
                  </th>
                  {visibleColumns.map((col) => (
                    <ResizableHeader
                      key={col.key}
                      label={col.label}
                      width={colWidths[col.key]}
                      className={col.className}
                      onSort={col.sortable ? () => toggleSort(col.key) : undefined}
                      sortIndicator={sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                      onResize={(w) => setColWidths((prev) => ({ ...prev, [col.key]: w }))}
                      stickyTop={0}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedSales.map((s, idx) => (
                  <SaleRow
                    key={s.id}
                    sale={s}
                    visibleColumns={visibleColumns}
                    ctx={{
                      index: idx,
                      page,
                      pageSize,
                      isOwner,
                      canEditSale,
                      selected: selected.has(s.id),
                      onToggleSelect: toggleSelect,
                      onDone: refresh,
                    }}
                  />
                ))}
                {displayedSales.length === 0 && (
                  <tr><td colSpan={visibleColumns.length + 1} className="border p-4 text-center text-muted-foreground">No sales found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
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
