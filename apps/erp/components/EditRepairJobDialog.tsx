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
import { AddPaymentDialog } from "@/components/AddPaymentDialog";
import { RecordZohoInvoiceDialog } from "@/components/RecordZohoInvoiceDialog";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];
const PART_CATEGORIES = ["RAM", "SSD", "CPU", "GPU", "KBD", "MOUSE", "ACC", "ADP"];

interface SaleLine {
  id: string;
  accessory_id: string | null;
  finalized: boolean;
  invoice_id: string | null;
  invoice_number: string | null;
  sale_total: number;
  sale_gst: number;
  sale_base_price: number;
  amount_paid: number;
  payment_status: string;
  payment_account: string;
  kind: "labor" | "part";
  label: string;
  invoice_mode: "erp" | "external";
}

interface PartInstalled {
  id: string;
  sku_id: string;
  label: string;
  quantity: number;
  unit_price: number | null;
  sale_id: string | null;
  payment_status: string | null;
  finalized: boolean | null;
}

// Kept minimal -- this is what the Repair Jobs LIST route returns (lightweight
// aggregates only, see app/api/repair-jobs/route.ts). The dialog fetches the full
// itemized detail (sale_lines/parts_installed) itself on open, from
// GET /api/repair-jobs/[id], rather than the list row carrying that weight for
// every row all the time.
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
  sale_count?: number;
  total_charged?: number;
  total_paid?: number;
  aggregate_payment_status?: string;
  all_finalized?: boolean;
  invoice_mode?: "erp" | "external";
}

interface PartOption {
  id: string;
  label: string;
  price: number;
}

// Repair charges become real `sales` rows the moment they exist: the labor charge on
// Mark Done (see POST /api/repair-jobs/[id]/finalize), each part the moment it's added
// (intake or here, see POST /api/repair-jobs/[id]/parts) -- once any of that has
// happened, this job's own amount_charged/gst_percentage/payment_account are a frozen
// snapshot of what was charged then, not a live editable value, so those fields lock
// and further payments/invoicing happen against the linked sale(s) instead (see
// CLAUDE.md). repair_jobs.payment_status/amount_paid are similarly stale once billed --
// the itemized sale_lines fetched below are the real source of truth.
export function EditRepairJobDialog({
  job,
  onClose,
  onSaved,
}: {
  job: RepairJobDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [partsInstalled, setPartsInstalled] = useState<PartInstalled[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/repair-jobs/${job.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setSaleLines(Array.isArray(data.sale_lines) ? data.sale_lines : []);
        setPartsInstalled(Array.isArray(data.parts_installed) ? data.parts_installed : []);
        setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  // Before the detail fetch resolves, go by the list row's own aggregate (sale_count)
  // so a job that's already billed doesn't briefly flash the unbilled edit form.
  const billed = loadingDetail ? (job.sale_count || 0) > 0 : saleLines.length > 0;

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
  const [payingSale, setPayingSale] = useState<SaleLine | null>(null);
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

  const unfinalizedLines = saleLines.filter((s) => !s.finalized);
  const isExternal = unfinalizedLines[0]?.invoice_mode === "external";

  const { run: generateInvoice, pending: generating } = useAsyncAction(async () => {
    if (unfinalizedLines.length === 0) return;
    const res = unfinalizedLines.length === 1
      ? await apiFetch(`/api/sales/${unfinalizedLines[0].id}/finalize`, { method: "POST", body: "{}" })
      : await apiFetch(`/api/sales/finalize-batch`, { method: "POST", body: JSON.stringify({ sale_ids: unfinalizedLines.map((s) => s.id) }) });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error || "Failed to generate invoice.");
      return;
    }
    onSaved();
  });

  // ---------- Add Part ----------
  const [showAddPart, setShowAddPart] = useState(false);
  const [partSearch, setPartSearch] = useState("");
  const [partOptions, setPartOptions] = useState<PartOption[]>([]);
  const [newPart, setNewPart] = useState<{ sku_id: string; label: string; quantity: number; unit_price: number } | null>(null);

  useEffect(() => {
    if (!partSearch.trim()) {
      setPartOptions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${PART_CATEGORIES.join(",")}&search=${encodeURIComponent(partSearch)}`);
      const data = await res.json();
      setPartOptions(
        Array.isArray(data)
          ? data.map((s: any) => ({ id: s.id, label: s.sku_description || s.full_sku_code, price: Number(s.selling_price_default) || 0 }))
          : []
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [partSearch]);

  const { run: addPart, pending: addingPart } = useAsyncAction(async () => {
    if (!newPart) return;
    setErr("");
    const res = await apiFetch(`/api/repair-jobs/${job.id}/parts`, {
      method: "POST",
      body: JSON.stringify({ sku_id: newPart.sku_id, quantity: newPart.quantity, unit_price: newPart.unit_price }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      setErr(e.error || "Failed to add part.");
      return;
    }
    setNewPart(null);
    setPartSearch("");
    setPartOptions([]);
    setShowAddPart(false);
    // Refresh this dialog's own detail (parts + a new sale line) without closing it.
    setLoadingDetail(true);
    const detail = await (await apiFetch(`/api/repair-jobs/${job.id}`)).json();
    setSaleLines(Array.isArray(detail.sale_lines) ? detail.sale_lines : []);
    setPartsInstalled(Array.isArray(detail.parts_installed) ? detail.parts_installed : []);
    setLoadingDetail(false);
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
              <Label>{gstApplies ? "Labor Charge (₹, pre-GST)" : "Labor Charge (₹)"}</Label>
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

          {!billed && gstApplies && (
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
          )}
          {!billed && !gstApplies && (
            <p className="text-xs text-muted-foreground">
              No GST applies — only Digitalbluez is GST-registered; Cash/Techtenth issue a Bill of Supply.
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

          {/* ---------- Parts Installed ---------- */}
          <div className="border rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>Parts Installed</Label>
              {!showAddPart && (
                <Button type="button" size="sm" variant="outline" onClick={() => setShowAddPart(true)}>
                  + Add Part
                </Button>
              )}
            </div>
            {loadingDetail ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : partsInstalled.length === 0 ? (
              <p className="text-xs text-muted-foreground">No parts recorded.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {partsInstalled.map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span>{p.label} x{p.quantity}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {p.unit_price != null ? `₹${p.unit_price.toFixed(2)} each` : "—"}
                      {p.payment_status && <span className="ml-2">({p.payment_status})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {showAddPart && (
              <div className="border-t pt-2 space-y-2">
                {!newPart ? (
                  <>
                    <Input
                      value={partSearch}
                      onChange={(e) => setPartSearch(e.target.value)}
                      placeholder="Search a part to add..."
                    />
                    {partOptions.length > 0 && (
                      <ul className="border rounded max-h-40 overflow-y-auto">
                        {partOptions.map((p) => (
                          <li
                            key={p.id}
                            onClick={() => { setNewPart({ sku_id: p.id, label: p.label, quantity: 1, unit_price: p.price }); setPartSearch(""); setPartOptions([]); }}
                            className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0 text-sm"
                          >
                            {p.label}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddPart(false)}>Cancel</Button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-sm bg-muted border rounded p-2">
                    <span className="flex-1">{newPart.label}</span>
                    <Input
                      type="number"
                      min={1}
                      value={newPart.quantity}
                      onChange={(e) => setNewPart({ ...newPart, quantity: Number(e.target.value) })}
                      className="w-16 text-center"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={newPart.unit_price}
                      onChange={(e) => setNewPart({ ...newPart, unit_price: Number(e.target.value) })}
                      className="w-24 text-center"
                    />
                    <Button type="button" size="sm" onClick={() => addPart()} disabled={addingPart}>
                      {addingPart && <Loader2 className="size-3 animate-spin mr-1" />}Add
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setNewPart(null); setShowAddPart(false); }}>✕</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---------- Charges (billed sales) ---------- */}
          {billed && (
            <div className="border rounded p-3 space-y-2">
              <Label>Charges</Label>
              {loadingDetail ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : (
                <ul className="space-y-2">
                  {saleLines.map((line) => (
                    <li key={line.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0 last:pb-0">
                      <div>
                        <div>{line.label}</div>
                        <div className="text-xs text-muted-foreground">
                          ₹{line.sale_total.toFixed(2)} · {line.payment_status} (₹{line.amount_paid.toFixed(2)} paid)
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {line.finalized ? (
                          <span className="text-success text-xs">✓ {line.invoice_number}</span>
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={() => setPayingSale(line)}>
                            Add Payment
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!loadingDetail && (
                <div className="flex items-center justify-between pt-2 border-t font-medium text-sm">
                  <span>
                    Total ₹{saleLines.reduce((s, l) => s + l.sale_total, 0).toFixed(2)} · Paid ₹{saleLines.reduce((s, l) => s + l.amount_paid, 0).toFixed(2)}
                  </span>
                  {unfinalizedLines.length > 0 && (
                    isExternal ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowZohoDialog(true)}>
                        Record Zoho Invoice #
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" onClick={() => generateInvoice()} disabled={generating}>
                        {generating && <Loader2 className="size-3 animate-spin mr-1" />}Generate Invoice
                      </Button>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {job.status !== "done" && (
            <div className="border-t pt-3 flex justify-between items-center">
              <p className="text-xs text-muted-foreground">Marking done bills the labor charge into the Sales Ledger.</p>
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

      {showZohoDialog && unfinalizedLines.length > 0 && (
        <RecordZohoInvoiceDialog saleIds={unfinalizedLines.map((s) => s.id)} onClose={() => setShowZohoDialog(false)} onRecorded={onSaved} />
      )}
      {payingSale && (
        <AddPaymentDialog
          saleId={payingSale.id}
          balanceDue={payingSale.sale_total - payingSale.amount_paid}
          onClose={() => setPayingSale(null)}
          onSaved={() => { setPayingSale(null); onSaved(); }}
        />
      )}
    </Dialog>
  );
}
