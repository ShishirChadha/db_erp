"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import RequireOwner from "@/components/RequireOwner";

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
}

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

function SaleRow({ sale, onDone }: { sale: Sale; onDone: () => void }) {
  const [paymentStatus, setPaymentStatus] = useState(sale.payment_status);
  const [amountPaid, setAmountPaid] = useState(sale.amount_paid);
  const [paymentAccount, setPaymentAccount] = useState(sale.payment_account || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      const res = await apiFetch(`/api/sales/${sale.id}`, {
        method: "PATCH",
        body: JSON.stringify({ payment_status: paymentStatus, amount_paid: amountPaid, payment_account: paymentAccount || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to save.");
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const generateInvoice = async () => {
    setBusy(true);
    const res = await apiFetch(`/api/sales/${sale.id}/finalize`, { method: "POST", body: "{}" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || "Failed to generate invoice.");
    } else {
      onDone();
    }
    setBusy(false);
  };

  return (
    <tr>
      <td className="border p-2">{sale.sale_date?.slice(0, 10)}</td>
      <td className="border p-2">{sale.customer_name || "—"}</td>
      <td className="border p-2">{sale.asset_number || (sale.serial_number ? `SN: ${sale.serial_number}` : sale.accessory_id ? "Accessory" : "—")}</td>
      <td className="border p-2 text-right">₹{sale.sale_total?.toFixed(2)}</td>
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
        ) : (
          <button onClick={generateInvoice} disabled={busy} className="text-amber-700 underline text-xs">Generate Invoice</button>
        )}
      </td>
      <td className="border p-2">
        {err && <div className="text-red-600 text-xs mb-1">{err}</div>}
        <button onClick={save} disabled={busy} className="text-blue-600 underline text-xs">Save</button>
      </td>
    </tr>
  );
}

function SalesLedgerPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sales Ledger</h1>
      <p className="text-sm text-gray-500 mb-4">
        Every sale (units + accessories), payment tracking, and incentive attribution. New sales are recorded from <a href="/dashboard/entry/sell" className="underline">New Entry → Sell</a>.
      </p>

      <div className="flex gap-4 mb-4 flex-wrap">
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
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
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
              {sales.map(s => <SaleRow key={s.id} sale={s} onDone={fetchSales} />)}
              {sales.length === 0 && (
                <tr><td colSpan={10} className="border p-4 text-center text-gray-400">No sales found.</td></tr>
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
