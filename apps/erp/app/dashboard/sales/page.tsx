"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import RequireOwner from "@/components/RequireOwner";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { StatCardsRow } from "@/components/StatCardsRow";
import { RecordZohoInvoiceDialog } from "@/components/RecordZohoInvoiceDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { EditSaleDialog } from "@/components/EditSaleDialog";

interface Sale {
  id: string;
  sale_date: string;
  customer_name: string | null;
  asset_number: string | null;
  serial_number: string | null;
  accessory_id: string | null;
  accessory_quantity: number | null;
  sale_base_price: number;
  sale_gst: number;
  sale_total: number;
  sale_type: string;
  payment_status: string;
  amount_paid: number;
  payment_account: string | null;
  sold_by: string | null;
  finalized: boolean;
  invoice_number: string | null;
  invoice_mode?: "erp" | "external";
}

function SaleRow({
  sale,
  onDone,
  selected,
  onToggleSelect,
  index,
}: {
  sale: Sale;
  onDone: () => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  index: number;
}) {
  const [showZohoDialog, setShowZohoDialog] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
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
    <tr>
      <td className="border p-2 w-8 text-center">
        {!sale.finalized && (
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(sale.id)} />
        )}
      </td>
      <td className="border p-2 text-right tabular-nums text-gray-400">{index + 1}</td>
      <td className="border p-2">{sale.sale_date?.slice(0, 10)}</td>
      <td className="border p-2">{sale.customer_name || "—"}</td>
      <td className="border p-2">{sale.asset_number || (sale.serial_number ? `SN: ${sale.serial_number}` : sale.accessory_id ? "Accessory" : "—")}</td>
      <td className="border p-2 text-right tabular-nums">₹{sale.sale_total?.toFixed(2)}</td>
      <td className="border p-2 capitalize">{sale.payment_status}</td>
      <td className="border p-2 text-right tabular-nums">₹{sale.amount_paid?.toFixed(2)}</td>
      <td className="border p-2">{sale.payment_account || "—"}</td>
      <td className="border p-2">{sale.sold_by || "—"}</td>
      <td className="border p-2">
        {sale.finalized ? (
          <span className="text-green-600">✓ {sale.invoice_number}</span>
        ) : isExternal ? (
          <button onClick={() => setShowZohoDialog(true)} className="text-amber-700 underline text-xs" title="This entity is issuing invoices in Zoho during the transition">
            Record Zoho Invoice #
          </button>
        ) : (
          <button onClick={() => generateInvoice()} disabled={generating} className="text-amber-700 underline text-xs inline-flex items-center gap-1">
            {generating && <Loader2 className="size-3 animate-spin" />}
            Generate Invoice
          </button>
        )}
        {showZohoDialog && (
          <RecordZohoInvoiceDialog saleIds={[sale.id]} onClose={() => setShowZohoDialog(false)} onRecorded={onDone} />
        )}
      </td>
      <td className="border p-2">
        <button onClick={() => setShowEdit(true)} className="text-blue-600 underline text-xs">
          Edit
        </button>
        {showEdit && (
          <EditSaleDialog saleId={sale.id} onClose={() => setShowEdit(false)} onSaved={onDone} />
        )}
      </td>
    </tr>
  );
}

function SalesLedgerPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchErr, setBatchErr] = useState("");
  const [awaitingInvoiceOnly, setAwaitingInvoiceOnly] = useState(false);
  const [showBatchZoho, setShowBatchZoho] = useState(false);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (paymentFilter) params.set("payment_status", paymentFilter);
    const res = await apiFetch(`/api/sales?${params.toString()}`);
    setSales(res.ok ? await res.json() : []);
    setLoading(false);
  }, [search, paymentFilter]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const displayedSales = awaitingInvoiceOnly ? sales.filter(s => !s.finalized) : sales;
  // Only un-finalized sales are ever selectable (SaleRow only renders a checkbox
  // for those) -- select-all must match that same set, not every visible row.
  const selectableIds = displayedSales.filter(s => !s.finalized).map(s => s.id);
  const toggleSelectAll = () => {
    setSelected(prev => prev.size === selectableIds.length ? new Set() : new Set(selectableIds));
  };
  const pendingCount = sales.filter(s => s.payment_status === "pending").length;
  const partialCount = sales.filter(s => s.payment_status === "partial").length;
  const awaitingInvoiceCount = sales.filter(s => !s.finalized).length;

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
      fetchSales();
    }
  });

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sales Ledger</h1>
      <p className="text-sm text-gray-500 mb-4">
        Every sale (units + accessories), payment tracking, and incentive attribution. New sales are recorded from <a href="/dashboard/entry/sell?return_to=%2Fdashboard%2Fsales" className="underline">New Entry → Sell</a>.
        Select 2 or more un-invoiced sales for the same customer and account to combine them into one invoice.
      </p>

      <StatCardsRow
        cards={[
          { label: "Total Sold", value: sales.length },
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

      <div className="flex gap-4 mb-4 flex-wrap items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer, asset, serial, invoice..."
          className="border p-2 rounded"
        />
        <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="border p-2 rounded">
          <option value="">All Payment Statuses</option>
          <option value="pending">Payment Pending</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
        {selected.size >= 2 && (
          allSelectedExternal ? (
            <button
              onClick={() => setShowBatchZoho(true)}
              className="bg-amber-600 text-white px-3 py-2 rounded text-sm"
            >
              Record Combined Zoho Invoice # ({selected.size} sales)
            </button>
          ) : (
            <button
              onClick={() => generateCombinedInvoice()}
              disabled={batchBusy}
              className="bg-amber-600 text-white px-3 py-2 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {batchBusy && <Loader2 className="size-4 animate-spin" />}
              {batchBusy ? "Generating…" : `Generate Combined Invoice (${selected.size} sales)`}
            </button>
          )
        )}
        {batchErr && <span className="text-red-600 text-xs">{batchErr}</span>}
      </div>
      {showBatchZoho && (
        <RecordZohoInvoiceDialog
          saleIds={[...selected]}
          onClose={() => setShowBatchZoho(false)}
          onRecorded={() => { setSelected(new Set()); fetchSales(); }}
        />
      )}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2 w-8 text-center">
                  {selectableIds.length > 0 && (
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
                <th className="border p-2 w-10 text-right">#</th>
                <th className="border p-2">Date</th>
                <th className="border p-2">Customer</th>
                <th className="border p-2">Item</th>
                <th className="border p-2 text-right">Total</th>
                <th className="border p-2">Payment</th>
                <th className="border p-2">Amount Paid</th>
                <th className="border p-2">Received Into</th>
                <th className="border p-2">Sold By</th>
                <th className="border p-2">Invoice</th>
                <th className="border p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedSales.map((s, idx) => (
                <SaleRow
                  key={s.id}
                  sale={s}
                  onDone={fetchSales}
                  selected={selected.has(s.id)}
                  onToggleSelect={toggleSelect}
                  index={idx}
                />
              ))}
              {displayedSales.length === 0 && (
                <tr><td colSpan={12} className="border p-4 text-center text-gray-400">No sales found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SalesPageGuarded() {
  return (
    <RequireOwner>
      <SalesLedgerPage />
    </RequireOwner>
  );
}
