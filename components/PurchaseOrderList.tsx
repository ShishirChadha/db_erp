'use client';

import { useState, useEffect } from 'react';

// ── TypeScript types ──────────────────────────────────────────
interface Vendor {
  company_name?: string;
  vendor_code?: string;
}

interface PurchaseOrder {
  id: string;
  vendor_id: string;
  vendors?: Vendor;
  po_date: string;
  status: string;
  subtotal: number;
  tax_amount: number;
  total_cost: number;
  purchase_line_items?: any[];
  supplier_invoice_number?: string;
}

// ── Status badge styles ───────────────────────────────────────
const statusStyles: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  ordered: 'bg-blue-100 text-blue-800',
  received: 'bg-green-100 text-green-800',
  invoiced: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-emerald-100 text-emerald-800',
};

function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status] || ''}`}>
      {status}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────
export default function PurchaseOrderList({ refreshKey }: { refreshKey?: number }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/purchase-orders');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch');
      }
      const data = await res.json();
      setOrders(data);
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [refreshKey]);

  if (loading) return <p className="p-4 text-gray-500">Loading orders…</p>;
  if (error) return <p className="p-4 text-red-600">Error: {error}</p>;

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-xl font-semibold">Recent Purchase Orders</h2>
      {orders.length === 0 ? (
        <p className="text-gray-500">No purchase orders yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2">PO Date</th>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Invoice #</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2">{new Date(po.po_date).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-2">
                    {po.vendors
                      ? `${po.vendors.vendor_code ?? ''} – ${po.vendors.company_name ?? ''}`
                      : po.vendor_id}
                  </td>
                  <td className="px-4 py-2">{po.supplier_invoice_number || '–'}</td>
                  <td className="px-4 py-2">₹{po.total_cost.toFixed(2)}</td>
                  <td className="px-4 py-2"><Badge status={po.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}