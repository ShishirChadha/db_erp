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
import { AddPaymentDialog } from "@/components/AddPaymentDialog";
import { RecordZohoInvoiceDialog } from "@/components/RecordZohoInvoiceDialog";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

interface LinkedSale {
  id: string;
  finalized: boolean;
  invoice_id: string | null;
  invoice_number: string | null;
  sale_total: number;
  sale_gst: number;
  sale_base_price: number;
  amount_paid: number;
  invoice_mode?: "erp" | "external";
}

export interface RepairJobDetail {
  id: string;
  job_number: string;
  is_own_stock: boolean;
  customer_device_description: string | null;
  customer_device_serial: string | null;
  problem_description: string | null;
  solution_description: string | null;
  job_date: string | null;
  status: string;
  payment_status: string;
  amount_charged: number | null;
  amount_paid: number;
  payment_account: string | null;
  gst_percentage: number | null;
  sales: LinkedSale | null;
}

// Repair charges become a real `sales` row (sales.repair_job_id) the moment the job is
// marked Done (see POST /api/repair-jobs/[id]/finalize) -- once that's happened, this
// job's own amount_charged/gst_percentage/payment_account are a frozen snapshot of
// what was billed, not a live editable value, so those fields lock and further
// payments/invoicing happen against the linked sale instead (same handoff already
// documented in CLAUDE.md).
export function EditRepairJobDialog({
  job,
  onClose,
  onSaved,
}: {
  job: RepairJobDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const billed = !!job.sales;

  const [deviceDescription, setDeviceDescription] = useState(job.customer_device_description || "");
  const [deviceSerial, setDeviceSerial] = useState(job.customer_device_serial || "");
  const [problem, setProblem] = useState(job.problem_description || "");
  const [solution, setSolution] = useState(job.solution_description || "");
  const [jobDate, setJobDate] = useState(job.job_date?.slice(0, 10) || "");
  const [amountCharged, setAmountCharged] = useState<number | "">(job.amount_charged ?? "");
  const [paymentAccount, setPaymentAccount] = useState(job.payment_account || "");
  const [gstPercent, setGstPercent] = useState(job.gst_percentage ?? 18);
  const [paymentStatus, setPaymentStatus] = useState(job.payment_status);
  const [amountPaid, setAmountPaid] = useState(job.amount_paid || 0);
  const [err, setErr] = useState("");
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showZohoDialog, setShowZohoDialog] = useState(false);

  const gstApplies = !billed && paymentAccount === "Digitalbluez";
  const gstAmount = gstApplies ? Math.round((Number(amountCharged) || 0) * gstPercent) / 100 : 0;
  const totalAfterGst = (Number(amountCharged) || 0) + gstAmount;

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setErr("");
    const body: Record<string, unknown> = {
      problem_description: problem,
      solution_description: solution,
      job_date: jobDate || undefined,
      payment_status: paymentStatus,
      amount_paid: amountPaid,
    };
    if (!job.is_own_stock) {
      body.customer_device_description = deviceDescription;
      body.customer_device_serial = deviceSerial;
    }
    if (!billed) {
      body.amount_charged = amountCharged === "" ? null : amountCharged;
      body.payment_account = paymentAccount || null;
      body.gst_percentage = gstApplies ? gstPercent : null;
    }
    const res = await apiFetch(`/api/repair-jobs/${job.id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || "Failed to save.");
    }
    onSaved();
    onClose();
  });

  const { run: markDone, pending: marking } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/repair-jobs/${job.id}/finalize`, { method: "POST" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error || "Failed to mark done.");
      return;
    }
    onSaved();
    onClose();
  });

  const { run: generateInvoice, pending: generating } = useAsyncAction(async () => {
    if (!job.sales) return;
    const res = await apiFetch(`/api/sales/${job.sales.id}/finalize`, { method: "POST", body: "{}" });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error || "Failed to generate invoice.");
      return;
    }
    onSaved();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Repair Job</DialogTitle>
          <DialogDescription>{job.job_number}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {err && <div className="text-destructive text-sm">{err}</div>}

          <div>
            <Label>Job Date</Label>
            <Input type="date" value={jobDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setJobDate(e.target.value)} />
          </div>

          {!job.is_own_stock && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Device Description</Label>
                <Input value={deviceDescription} onChange={(e) => setDeviceDescription(e.target.value)} />
              </div>
              <div>
                <Label>Serial Number</Label>
                <Input value={deviceSerial} onChange={(e) => setDeviceSerial(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <Label>Problem</Label>
            <Textarea rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} />
          </div>

          <div>
            <Label>Solution</Label>
            <Textarea rows={2} value={solution} onChange={(e) => setSolution(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{gstApplies ? "Amount Charged (₹, pre-GST)" : "Amount Charged (₹)"}</Label>
              <Input
                type="number"
                value={amountCharged}
                disabled={billed}
                onChange={(e) => setAmountCharged(e.target.value === "" ? "" : Number(e.target.value))}
                className="text-right"
              />
            </div>
            <div>
              <Label>Received Into</Label>
              <Select value={paymentAccount} onValueChange={setPaymentAccount} disabled={billed}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_ACCOUNTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {billed ? (
            <div className="border rounded p-3 text-sm space-y-1 bg-muted">
              <p className="text-muted-foreground text-xs">
                This job was billed on Mark Done -- amount/GST/account are locked to what was charged then.
              </p>
              <p>Before GST: ₹{job.sales!.sale_base_price.toFixed(2)}</p>
              <p>GST: ₹{job.sales!.sale_gst.toFixed(2)}</p>
              <p className="font-bold text-base">After GST (Total): ₹{job.sales!.sale_total.toFixed(2)}</p>
            </div>
          ) : gstApplies ? (
            <div className="border rounded p-3 space-y-2 bg-muted">
              <div>
                <Label>GST %</Label>
                <Input type="number" value={gstPercent} onChange={(e) => setGstPercent(Number(e.target.value))} className="w-24 text-right" />
              </div>
              <div className="text-sm text-right space-y-1">
                <p>Before GST: ₹{(Number(amountCharged) || 0).toFixed(2)}</p>
                <p>GST: ₹{gstAmount.toFixed(2)}</p>
                <p className="font-bold text-base">After GST (Total): ₹{totalAfterGst.toFixed(2)}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No GST applies -- only Digitalbluez is GST-registered; Cash/Techtenth issue a Bill of Supply.
            </p>
          )}

          {!billed && (
            <div className="grid grid-cols-2 gap-3">
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
                <Label>Amount Paid (₹)</Label>
                <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="text-right" />
              </div>
            </div>
          )}

          {billed && (
            <div className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Invoice</Label>
                {job.sales!.finalized ? (
                  <span className="text-success text-sm">✓ {job.sales!.invoice_number}</span>
                ) : job.sales!.invoice_mode === "external" ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowZohoDialog(true)}>
                    Record Zoho Invoice #
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => generateInvoice()} disabled={generating}>
                    {generating && <Loader2 className="size-3 animate-spin mr-1" />}
                    Generate Invoice
                  </Button>
                )}
              </div>
              {!job.sales!.finalized && (
                <p className="text-xs text-muted-foreground">
                  Can also be combined with other sales for this customer into one invoice from the Sales Ledger.
                </p>
              )}
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="text-sm">Payment: further installments are recorded on the linked sale now.</div>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowAddPayment(true)}>
                  Add Payment
                </Button>
              </div>
            </div>
          )}

          {job.status !== "done" && (
            <div className="border-t pt-3 flex justify-between items-center">
              <p className="text-xs text-muted-foreground">Marking done bills this job into the Sales Ledger.</p>
              <Button type="button" variant="outline" onClick={() => markDone()} disabled={marking}>
                {marking && <Loader2 className="size-3 animate-spin mr-1" />}
                Mark Done
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving} loading={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>

      {showZohoDialog && job.sales && (
        <RecordZohoInvoiceDialog saleIds={[job.sales.id]} onClose={() => setShowZohoDialog(false)} onRecorded={onSaved} />
      )}
      {showAddPayment && job.sales && (
        <AddPaymentDialog
          saleId={job.sales.id}
          balanceDue={job.sales.sale_total - job.sales.amount_paid}
          onClose={() => setShowAddPayment(false)}
          onSaved={() => { setShowAddPayment(false); onSaved(); }}
        />
      )}
    </Dialog>
  );
}
