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

// Records one installment against a sale via the append-only sale_payments ledger
// (POST /api/sales/[id]/payments) -- open to any role with sell/live-stock access, not
// owner-only, since an employee taking a customer's second/third installment should be
// able to log it themselves. sales.amount_paid/payment_status update automatically
// (trigger-derived), so this dialog never writes them directly.
export function AddPaymentDialog({
  saleId,
  balanceDue,
  onClose,
  onSaved,
}: {
  saleId: string;
  balanceDue: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(balanceDue > 0 ? balanceDue : 0);
  const [paymentAccount, setPaymentAccount] = useState("");
  const [note, setNote] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState("");

  const { run: submit, pending } = useAsyncAction(async () => {
    setErr("");
    const body = { amount, payment_account: paymentAccount || undefined, note: note || undefined, recorded_at: paymentDate };
    let res = await apiFetch(`/api/sales/${saleId}/payments`, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error_code === "exceeds_sale_total") {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return;
        res = await apiFetch(`/api/sales/${saleId}/payments`, {
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
          <DialogTitle>Add Payment</DialogTitle>
          <DialogDescription>
            {balanceDue > 0 ? `Balance due: ₹${balanceDue.toFixed(2)}` : "Record an amount received for this sale."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {err && <div className="text-destructive text-sm">{err}</div>}
          <div>
            <Label>Amount Received (₹)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="text-right"
              autoFocus
            />
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
          <div>
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2nd installment" />
          </div>
          <div>
            <Label>Payment Date</Label>
            <Input
              type="date"
              value={paymentDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
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
