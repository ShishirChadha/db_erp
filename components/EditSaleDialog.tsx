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

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

interface SaleDetail {
  id: string;
  sale_date: string;
  customer_id: string | null;
  customer_name: string | null;
  asset_number: string | null;
  serial_number: string | null;
  accessory_id: string | null;
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
  is_deleted: boolean;
  history: { field_name: string; old_value: string | null; new_value: string | null; changed_at: string; reason: string | null }[];
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
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [amountPaid, setAmountPaid] = useState(0);
  const [paymentAccount, setPaymentAccount] = useState("");

  const { values: staffNames } = useCustomOptions("staff_names");

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
        setPaymentStatus(data.payment_status);
        setAmountPaid(data.amount_paid);
        setPaymentAccount(data.payment_account || "");
      } else {
        setErr("Failed to load sale.");
      }
      setLoading(false);
    });
  }, [saleId]);

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr("");
    const body: Record<string, unknown> = {
      customer_id: customerId,
      sold_by: soldBy,
      sale_type: saleType,
      sale_date: saleDate,
      sale_base_price: basePrice,
      gst_percentage: saleType === "GST" ? gstPercent : 0,
      payment_status: paymentStatus,
      amount_paid: amountPaid,
      payment_account: paymentAccount || null,
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

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Payment Status</Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount Paid</Label>
                <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="text-right" />
              </div>
              <div>
                <Label>Received Into</Label>
                <Select value={paymentAccount} onValueChange={setPaymentAccount}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_ACCOUNTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
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

            <div className="border-t pt-3">
              <Button variant="destructive" size="sm" onClick={() => setVoidOpen(true)}>
                Void this sale
              </Button>
              <p className="text-xs text-gray-500 mt-1">
                Reverses stock and marks this sale voided. Does not touch an already-generated invoice.
              </p>
            </div>
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
    </Dialog>
  );
}
