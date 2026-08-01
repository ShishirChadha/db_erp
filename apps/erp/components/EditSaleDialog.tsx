"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useCustomOptions } from "@/lib/useCustomOptions";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SearchableCustomerSelect } from "@/components/SearchableCustomerSelect";
import { ReasonConfirmDialog } from "@/components/ReasonConfirmDialog";
import { AddPaymentDialog } from "@/components/AddPaymentDialog";
import { FixSkuDialog } from "@/components/FixSkuDialog";
import { useRole } from "@/lib/auth/useRole";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];
const ACCESSORY_CATEGORIES = "RAM,SSD,CPU,GPU,KBD,MOUSE,ACC,ADP";

interface BundledAccessory {
  accessory_id: string;
  quantity: number;
  accessory_name?: string;
}

interface SaleDetail {
  id: string;
  sale_date: string;
  customer_id: string | null;
  customer_name: string | null;
  asset_number: string | null;
  serial_number: string | null;
  accessory_id: string | null;
  asset_ledger_id: string | null;
  bundled_accessories: BundledAccessory[] | null;
  sale_base_price: number;
  sale_gst: number;
  sale_total: number;
  sale_type: string;
  payment_status: string;
  amount_paid: number;
  payment_account: string | null;
  sold_by: string | null;
  notes: string | null;
  finalized: boolean;
  invoice_number: string | null;
  is_deleted: boolean;
  history: { field_name: string; old_value: string | null; new_value: string | null; changed_at: string; reason: string | null }[];
}

interface SalePayment {
  id: string;
  amount: number;
  payment_account: string | null;
  note: string | null;
  recorded_at: string;
  recorded_by_name: string | null;
}

export function EditSaleDialog({
  saleId,
  onClose,
  onSaved,
}: {
  saleId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { isOwner } = useRole();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidErr, setVoidErr] = useState("");

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [soldBy, setSoldBy] = useState("");
  const [saleType, setSaleType] = useState("GST");
  const [saleDate, setSaleDate] = useState("");
  const [basePrice, setBasePrice] = useState(0);
  const [gstPercent, setGstPercent] = useState(18);
  const [paymentAccount, setPaymentAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [showAddPayment, setShowAddPayment] = useState(false);

  const [bundled, setBundled] = useState<BundledAccessory[]>([]);
  const [bundleSearch, setBundleSearch] = useState("");
  const [bundleOptions, setBundleOptions] = useState<{ id: string; full_sku_code: string; sku_description: string }[]>([]);
  const [showChangeSku, setShowChangeSku] = useState(false);

  const { values: staffNames } = useCustomOptions("staff_names");

  useEffect(() => {
    if (!bundleSearch.trim()) { setBundleOptions([]); return; }
    const t = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}&search=${encodeURIComponent(bundleSearch)}`);
      setBundleOptions(res.ok ? await res.json() : []);
    }, 300);
    return () => clearTimeout(t);
  }, [bundleSearch]);

  const loadPayments = () => {
    apiFetch(`/api/sales/${saleId}/payments`).then(async (res) => {
      if (res.ok) setPayments(await res.json());
    });
  };

  useEffect(() => {
    apiFetch(`/api/sales/${saleId}`).then(async (res) => {
      if (res.ok) {
        const data: SaleDetail = await res.json();
        setSale(data);
        setCustomerId(data.customer_id);
        setSoldBy(data.sold_by || "");
        setSaleType(data.sale_type || "GST");
        setSaleDate(data.sale_date?.slice(0, 10) || "");
        setBasePrice(data.sale_base_price);
        setGstPercent(data.sale_base_price ? Math.round((data.sale_gst / data.sale_base_price) * 10000) / 100 : 18);
        setPaymentAccount(data.payment_account || "");
        setNotes(data.notes || "");
        setBundled(data.bundled_accessories || []);
      } else {
        setErr("Failed to load sale.");
      }
      setLoading(false);
    });
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId]);

  const deletePayment = async (paymentId: string) => {
    if (!confirm("Remove this payment entry? This cannot be undone.")) return;
    const res = await apiFetch(`/api/sales/${saleId}/payments/${paymentId}`, { method: "DELETE" });
    if (res.ok) {
      loadPayments();
      apiFetch(`/api/sales/${saleId}`).then(async (r) => { if (r.ok) setSale(await r.json()); });
    } else {
      const e = await res.json().catch(() => ({}));
      alert(e.error || "Failed to remove payment.");
    }
  };

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr("");
    const body: Record<string, unknown> = {
      customer_id: customerId,
      sold_by: soldBy,
      sale_type: saleType,
      sale_date: saleDate,
      sale_base_price: basePrice,
      gst_percentage: saleType === "GST" ? gstPercent : 0,
      payment_account: paymentAccount || null,
      notes: notes || null,
      ...(sale?.asset_ledger_id
        ? { bundled_accessories: bundled.map(({ accessory_id, quantity }) => ({ accessory_id, quantity })) }
        : {}),
    };
    let res = await apiFetch(`/api/sales/${saleId}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error_code === "already_invoiced") {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return;
        res = await apiFetch(`/api/sales/${saleId}`, { method: "PATCH", body: JSON.stringify({ ...body, confirm_despite_invoice: true }) });
      }
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}));
        throw new Error(e2.error || "Failed to save.");
      }
    }
    onSaved();
    onClose();
  });

  const handleVoid = async (reason: string) => {
    setVoidErr("");
    let res = await apiFetch(`/api/sales/${saleId}/void`, { method: "POST", body: JSON.stringify({ reason }) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error_code === "already_invoiced") {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return;
        res = await apiFetch(`/api/sales/${saleId}/void`, { method: "POST", body: JSON.stringify({ reason, confirm_despite_invoice: true }) });
      }
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}));
        setVoidErr(e2.error || "Failed to void sale.");
        throw new Error(e2.error || "Failed to void sale.");
      }
    }
    setVoidOpen(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Sale</DialogTitle>
          <DialogDescription>
            {sale?.asset_number || (sale?.serial_number ? `SN: ${sale.serial_number}` : "Accessory sale")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-6 text-center text-sm text-gray-400">Loading…</div>
        ) : !sale ? (
          <div className="py-6 text-center text-sm text-red-600">{err || "Sale not found."}</div>
        ) : (
          <div className="space-y-4">
            {err && <div className="text-red-600 text-sm">{err}</div>}

            <div>
              <Label>Customer</Label>
              <SearchableCustomerSelect value={customerId} onChange={setCustomerId} onCustomerData={() => {}} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sold By</Label>
                <SearchableSelect options={staffNames} value={soldBy} onChange={setSoldBy} placeholder="Select..." />
              </div>
              <div>
                <Label>Sale Date</Label>
                <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sale Type</Label>
                <Select value={saleType} onValueChange={setSaleType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GST">GST</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Base Price (₹)</Label>
                <Input type="number" value={basePrice} onChange={(e) => setBasePrice(Number(e.target.value))} className="text-right" />
              </div>
            </div>

            {saleType === "GST" && (
              <div>
                <Label>GST %</Label>
                <Input type="number" value={gstPercent} onChange={(e) => setGstPercent(Number(e.target.value))} className="w-32 text-right" />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Received Into (default)</Label>
                <Select value={paymentAccount} onValueChange={setPaymentAccount}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_ACCOUNTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {sale.asset_ledger_id && (
              <div className="border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Laptop / SKU</Label>
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowChangeSku(true)}>Change SKU</Button>
                </div>
                <Label>Bundled Accessories</Label>
                <input
                  value={bundleSearch}
                  onChange={(e) => setBundleSearch(e.target.value)}
                  placeholder="Search accessory to add..."
                  className="border p-2 w-full rounded text-sm"
                />
                {bundleOptions.length > 0 && (
                  <ul className="border rounded divide-y max-h-32 overflow-y-auto text-sm">
                    {bundleOptions.map((a) => (
                      <li
                        key={a.id}
                        className="p-2 hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          if (bundled.some((b) => b.accessory_id === a.id)) return;
                          setBundled((prev) => [...prev, { accessory_id: a.id, quantity: 1, accessory_name: a.sku_description }]);
                          setBundleSearch("");
                          setBundleOptions([]);
                        }}
                      >
                        {a.full_sku_code} — {a.sku_description}
                      </li>
                    ))}
                  </ul>
                )}
                {bundled.length > 0 && (
                  <ul className="text-sm divide-y border rounded">
                    {bundled.map((b, idx) => (
                      <li key={b.accessory_id} className="p-2 flex items-center justify-between gap-2">
                        <span>{b.accessory_name || b.accessory_id}</span>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            value={b.quantity}
                            className="w-16 text-right"
                            onChange={(e) =>
                              setBundled((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) || 1 } : x)))
                            }
                          />
                          <button type="button" className="text-red-600 underline text-xs" onClick={() => setBundled((prev) => prev.filter((_, i) => i !== idx))}>
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {showChangeSku && sale.asset_ledger_id && (
              <FixSkuDialog
                assetId={sale.asset_ledger_id}
                onClose={() => setShowChangeSku(false)}
                onReassigned={() => { setShowChangeSku(false); onSaved(); }}
              />
            )}

            <div className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Payment</Label>
                  <div className="text-sm capitalize">
                    {sale.payment_status} · ₹{sale.amount_paid?.toFixed(2)} of ₹{sale.sale_total?.toFixed(2)}
                  </div>
                </div>
                {sale.payment_status !== "paid" && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowAddPayment(true)}>
                    Add Payment
                  </Button>
                )}
              </div>
              {payments.length > 0 && (
                <ul className="text-xs border-t pt-2 divide-y max-h-32 overflow-y-auto">
                  {payments.map((p) => (
                    <li key={p.id} className="py-1 flex items-center justify-between gap-2">
                      <div>
                        ₹{p.amount.toFixed(2)}{p.payment_account ? ` · ${p.payment_account}` : ""}
                        {p.note ? ` · ${p.note}` : ""}
                        <div className="text-gray-400">
                          {new Date(p.recorded_at).toLocaleString()}{p.recorded_by_name ? ` · ${p.recorded_by_name}` : ""}
                        </div>
                      </div>
                      <button type="button" onClick={() => deletePayment(p.id)} className="text-red-600 underline shrink-0">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {sale.history.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-blue-600 underline">
                  {showHistory ? "Hide" : "Show"} correction history ({sale.history.length})
                </button>
                {showHistory && (
                  <ul className="mt-2 text-xs border rounded divide-y max-h-40 overflow-y-auto">
                    {sale.history.map((h, i) => (
                      <li key={i} className="p-2">
                        <span className="font-medium">{h.field_name}</span>: {h.old_value ?? "—"} → {h.new_value ?? "—"}
                        {h.reason && <div className="text-gray-500">Reason: {h.reason}</div>}
                        <div className="text-gray-400">{new Date(h.changed_at).toLocaleString()}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {isOwner && (
              <div className="border-t pt-3">
                <Button variant="destructive" size="sm" onClick={() => setVoidOpen(true)}>
                  Void this sale
                </Button>
                <p className="text-xs text-gray-500 mt-1">
                  Reverses stock and marks this sale voided. Does not touch an already-generated invoice.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving || loading || !sale} loading={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>

      {voidOpen && (
        <ReasonConfirmDialog
          open={voidOpen}
          onOpenChange={setVoidOpen}
          title="Void this sale?"
          description="This reverses stock (unit returns to sellable, accessory quantity restored) and marks the sale voided. It does not touch an already-generated invoice."
          confirmLabel="Void Sale"
          error={voidErr}
          onConfirm={handleVoid}
        />
      )}

      {showAddPayment && sale && (
        <AddPaymentDialog
          saleId={saleId}
          balanceDue={sale.sale_total - sale.amount_paid}
          onClose={() => setShowAddPayment(false)}
          onSaved={() => {
            loadPayments();
            apiFetch(`/api/sales/${saleId}`).then(async (r) => { if (r.ok) setSale(await r.json()); });
            onSaved();
          }}
        />
      )}
    </Dialog>
  );
}
