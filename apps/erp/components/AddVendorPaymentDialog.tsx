"use client";

import { useState } from "react";
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

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

// Records one installment against a PO via the append-only vendor_payments ledger
// (POST /api/purchase-orders/[id]/payments) -- the debit-side twin of
// AddPaymentDialog.tsx. purchase_orders.amount_paid/payment_status update
// automatically (trigger-derived), so this dialog never writes them directly.
export function AddVendorPaymentDialog({
  poId,
  balanceDue,
  onClose,
  onSaved,
}: {
  poId: string;
  balanceDue: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(balanceDue > 0 ? balanceDue : 0);
  const [paymentAccount, setPaymentAccount] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const { run: submit, pending } = useAsyncAction(async () => {
    setErr("");
    const body = {
      amount,
      payment_account: paymentAccount || undefined,
      paid_on: paidOn || undefined,
      method: method || undefined,
      reference: reference || undefined,
      note: note || undefined,
    };
    let res = await apiFetch(`/api/purchase-orders/${poId}/payments`, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error_code === "exceeds_po_total") {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return;
        res = await apiFetch(`/api/purchase-orders/${poId}/payments`, {
          method: "POST",
          body: JSON.stringify({ ...body, confirm_overpayment: true }),
        });
      }
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}));
        setErr(e2.error || "Failed to record payment.");
        throw new Error(e2.error || "Failed to record payment.");
      }
    }
    onSaved();
    onClose();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Vendor Payment</DialogTitle>
          <DialogDescription>
            {balanceDue > 0 ? `Balance due: ₹${balanceDue.toFixed(2)}` : "Record an amount paid to this vendor for this PO."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {err && <div className="text-red-600 text-sm">{err}</div>}
          <div>
            <Label>Amount Paid (₹)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="text-right"
              autoFocus
            />
          </div>
          <div>
            <Label>Paid From</Label>
            <Select value={paymentAccount} onValueChange={setPaymentAccount}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {PAYMENT_ACCOUNTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date Paid</Label>
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div>
            <Label>Method (optional)</Label>
            <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. NEFT, UPI, Cheque" />
          </div>
          <div>
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2nd installment" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={() => submit()} disabled={pending || amount <= 0} loading={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Add Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
