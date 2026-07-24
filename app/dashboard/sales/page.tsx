"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import RequireOwner from "@/components/RequireOwner";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { StatCardsRow } from "@/components/StatCardsRow";
import { RecordZohoInvoiceDialog } from "@/components/RecordZohoInvoiceDialog";

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

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

function SaleRow({
  sale,
  onDone,
  selected,
  onToggleSelect,
}: {
  sale: Sale;
  onDone: () => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [paymentStatus, setPaymentStatus] = useState(sale.payment_status);
  const [amountPaid, setAmountPaid] = useState(sale.amount_paid);
  const [paymentAccount, setPaymentAccount] = useState(sale.payment_account || "");
  const [err, setErr] = useState("");
  const [editingPrice, setEditingPrice] = useState(false);
  const [basePrice, setBasePrice] = useState(sale.sale_base_price);
  const [priceErr, setPriceErr] = useState("");
  const [showZohoDialog, setShowZohoDialog] = useState(false);
  const isExternal = sale.invoice_mode === "external";

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr("");
    try {
      const res = await apiFetch(`/api/sales/${sale.id}`, {
        method: "PATCH",
        body: JSON.stringify({ payment_status: paymentStatus, amount_paid: amountPaid, payment_account: paymentAccount || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to save.");
      onDone();
    } catch (e: any) {
      setErr(e.message);
    }
  });

  const { run: savePrice, pending: savingPrice } = useAsyncAction(async () => {
    setPriceErr("");
    try {
      let res = await apiFetch(`/api/sales/${sale.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sale_base_price: basePrice }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        // Already invoiced -- confirm the owner understands the invoice won't
        // reflect this correction before silently letting it drift.
        if (e.error_code === "already_invoiced") {
          if (!confirm(`${e.error}\n\nProceed anyway?`)) return;
          res = await apiFetch(`/api/sales/${sale.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sale_base_price: basePrice, confirm_despite_invoice: true }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to save price.");
        } else {
          throw new Error(e.error || "Failed to save price.");
        }
      }
      setEditingPrice(false);
      onDone();
    } catch (e: any) {
      setPriceErr(e.message);
    }
  });

  const { run: generateInvoice, pending: generating } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/sales/${sale.id}/finalize`, { method: "POST", body: "{}" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || "Failed to generate invoice.");
    } else {
      onDone();
    }
  });

  const busy = saving || generating;

  return (
    <tr>
      <td className="border p-2 text-center">
        {!sale.finalized && (
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(sale.id)} />
        )}
      </td>
      <td className="border p-2">{sale.sale_date?.slice(0, 10)}</td>
      <td className="border p-2">{sale.customer_name || "—"}</td>
      <td className="border p-2">{sale.asset_number || (sale.serial_number ? `SN: ${sale.serial_number}` : sale.accessory_id ? "Accessory" : "—")}</td>
      <td className="border p-2 text-right">
        {editingPrice ? (
          <div className="flex flex-col items-end gap-1">
            {priceErr && <div className="text-red-600 text-xs">{priceErr}</div>}
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(Number(e.target.value))}
                className="border p-1 w-24 rounded text-xs text-right"
              />
              <button onClick={() => savePrice()} disabled={savingPrice} className="text-blue-600 underline text-xs inline-flex items-center gap-1">
                {savingPrice && <Loader2 className="size-3 animate-spin" />}
                Save
              </button>
              <button onClick={() => { setEditingPrice(false); setBasePrice(sale.sale_base_price); setPriceErr(""); }} className="text-gray-500 text-xs">
                Cancel
              </button>
            </div>
            <span className="text-xs text-gray-400">base price (GST recalculated)</span>
          </div>
        ) : (
          <button onClick={() => setEditingPrice(true)} className="hover:underline" title="Edit price">
            ₹{sale.sale_total?.toFixed(2)}
          </button>
        )}
      </td>
      <td className="border p-2">
        <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="border p-1 rounded text-xs">
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
      </td>
      <td className="border p-2">
        <input type="number" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="border p-1 w-20 rounded text-xs" />
      </td>
      <td className="border p-2">
        <select value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} className="border p-1 rounded text-xs">
          <option value="">—</option>
          {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </td>
      <td className="border p-2">{sale.sold_by || "—"}</td>
      <td className="border p-2">
        {sale.finalized ? (
          <span className="text-green-600">✓ {sale.invoice_number}</span>
        ) : isExternal ? (
          <button onClick={() => setShowZohoDialog(true)} className="text-amber-700 underline text-xs" title="This entity is issuing invoices in Zoho during the transition">
            Record Zoho Invoice #
          </button>
        ) : (
          <button onClick={() => generateInvoice()} disabled={busy} className="text-amber-700 underline text-xs inline-flex items-center gap-1">
            {generating && <Loader2 className="size-3 animate-spin" />}
            Generate Invoice
          </button>
        )}
        {showZohoDialog && (
          <RecordZohoInvoiceDialog saleIds={[sale.id]} onClose={() => setShowZohoDialog(false)} onRecorded={onDone} />
        )}
      </td>
      <td className="border p-2">
        {err && <div className="text-red-600 text-xs mb-1">{err}</div>}
        <button onClick={() => save()} disabled={busy} className="text-blue-600 underline text-xs inline-flex items-center gap-1">
          {saving && <Loader2 className="size-3 animate-spin" />}
          Save
        </button>
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
                <th className="border p-2"></th>
                <th className="border p-2">Date</th>
                <th className="border p-2">Customer</th>
                <th className="border p-2">Item</th>
                <th className="border p-2">Total</th>
                <th className="border p-2">Payment</th>
                <th className="border p-2">Amount Paid</th>
                <th className="border p-2">Received Into</th>
                <th className="border p-2">Sold By</th>
                <th className="border p-2">Invoice</th>
                <th className="border p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedSales.map(s => (
                <SaleRow
                  key={s.id}
                  sale={s}
                  onDone={fetchSales}
                  selected={selected.has(s.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
              {displayedSales.length === 0 && (
                <tr><td colSpan={11} className="border p-4 text-center text-gray-400">No sales found.</td></tr>
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
