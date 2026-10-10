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
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];
const BILLING_INTERVALS: { value: string; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "one_time", label: "One-time (whole period)" },
];

interface RentalAgreementDetail {
  id: string;
  agreement_number: string;
  customer_name: string | null;
  status: string;
  expected_return_date: string | null;
  billing_interval: string;
  rent_amount: number;
  gst_percentage: number | null;
  payment_account: string | null;
  next_billing_date: string | null;
  notes: string | null;
}

// Edits the agreement's own fields -- rent amount, billing interval/next bill date,
// due-back date, received-into account, and notes. Deliberately does NOT expose
// `status`: closing/cancelling an agreement goes through the dedicated
// POST /api/rentals/[id]/close route, which checks every unit is already settled --
// a plain PATCH here would let someone close an agreement with units still on_rent.
// Deposit money fields are likewise handled by their own owner-only route
// (RentalDepositDialog), not here -- see lib/rentals.ts / CLAUDE.md "Laptop rentals".
export function EditRentalDialog({
  agreementId,
  onClose,
  onSaved,
}: {
  agreementId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [agreement, setAgreement] = useState<RentalAgreementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [expectedReturn, setExpectedReturn] = useState("");
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [rentAmount, setRentAmount] = useState(0);
  const [gstPercentage, setGstPercentage] = useState(18);
  const [paymentAccount, setPaymentAccount] = useState("");
  const [nextBillingDate, setNextBillingDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    apiFetch(`/api/rentals/${agreementId}`).then(async (res) => {
      if (res.ok) {
        const data: RentalAgreementDetail = await res.json();
        setAgreement(data);
        setExpectedReturn(data.expected_return_date?.slice(0, 10) || "");
        setBillingInterval(data.billing_interval || "monthly");
        setRentAmount(data.rent_amount || 0);
        setGstPercentage(data.gst_percentage ?? 18);
        setPaymentAccount(data.payment_account || "");
        setNextBillingDate(data.next_billing_date?.slice(0, 10) || "");
        setNotes(data.notes || "");
      } else {
        setErr("Failed to load this rental agreement.");
      }
      setLoading(false);
    });
  }, [agreementId]);

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr("");
    try {
      const body: Record<string, unknown> = {
        expected_return_date: expectedReturn || null,
        billing_interval: billingInterval,
        rent_amount: Number(rentAmount),
        gst_percentage: Number(gstPercentage) || 0,
        payment_account: paymentAccount || null,
        next_billing_date: billingInterval === "one_time" ? null : (nextBillingDate || null),
        notes: notes || null,
      };
      const res = await apiFetch(`/api/rentals/${agreementId}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "Failed to save.");
        return;
      }
      onSaved();
      onClose();
    } catch (e: any) {
      // useAsyncAction's run() has no catch block by design (try/finally only, so a
      // double-click can't fire a second request while one is in flight) -- this
      // dialog must catch and surface its own errors rather than relying on it.
      setErr(e?.message || "Failed to save.");
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Rental</DialogTitle>
          <DialogDescription>
            {agreement?.agreement_number}{agreement?.customer_name ? ` — ${agreement.customer_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !agreement ? (
          <div className="py-6 text-center text-sm text-destructive">{err || "Rental agreement not found."}</div>
        ) : (
          <div className="space-y-4">
            {err && <div className="text-destructive text-sm">{err}</div>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Billing</Label>
                <Select value={billingInterval} onValueChange={setBillingInterval}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BILLING_INTERVALS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  Rent per {billingInterval === "one_time" ? "period" : billingInterval === "quarterly" ? "quarter" : "month"} (₹, pre-GST)
                </Label>
                <Input type="number" value={rentAmount} onChange={(e) => setRentAmount(Number(e.target.value))} className="text-right" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Received into</Label>
                <Select value={paymentAccount} onValueChange={setPaymentAccount}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_ACCOUNTS.map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>GST % (only applies if this account is GST-registered)</Label>
                <Input type="number" value={gstPercentage} onChange={(e) => setGstPercentage(Number(e.target.value))} className="text-right" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due back (optional)</Label>
                <Input type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
              </div>
              {billingInterval !== "one_time" && (
                <div>
                  <Label>Next bill date</Label>
                  <Input type="date" value={nextBillingDate} onChange={(e) => setNextBillingDate(e.target.value)} />
                  <p className="text-xs text-muted-foreground mt-1">
                    Changing this restarts the billing-due reminder for the new date.
                  </p>
                </div>
              )}
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything worth noting about this rental..."
                rows={4}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving || loading || !agreement} loading={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
