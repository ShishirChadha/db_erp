"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { SimpleModal } from "@/components/SimpleModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Take a customer's old laptop as part-payment on a sale (the "upgrade" case):
// the old sale stays as it is, the laptop comes back to QC pending with the
// trade-in value as its cost, and the value is recorded on this sale as a
// "Trade-in" payment. See lib/trade-ins.ts. Opened from the Sales Ledger and
// straight after a sale on the Sell form.

export interface TradeInSale {
  id: string;
  customer_name: string | null;
  sale_total: number | null;
  amount_paid: number | null;
  payment_account: string | null;
}

const ID_TYPES = ["Aadhaar", "PAN", "Driving licence", "Voter ID", "Passport", "Other"];
const UNIT_CATEGORIES = "LAP,DES,MON,TAB";
const rupees = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;

type Lookup =
  | { kind: "ours"; asset: { id: string; serial_number: string; description: string | null }; previous_sale: { sale_date: string; customer_name: string | null; sale_total: number; payment_account: string | null } | null }
  | { kind: "new" }
  | { kind: "blocked"; reason: string };

export function TradeInDialog({ sale, onClose, onSaved }: { sale: TradeInSale; onClose: () => void; onSaved: () => void }) {
  const [serial, setSerial] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelResults, setModelResults] = useState<any[]>([]);
  const [model, setModel] = useState<{ id: string; label: string } | null>(null);
  const [value, setValue] = useState("");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [condition, setCondition] = useState("");
  const [cameWith, setCameWith] = useState("");
  const [idType, setIdType] = useState("");
  const [idLast4, setIdLast4] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ id: string; number: string } | null>(null);

  const total = Number(sale.sale_total) || 0;
  const paid = Number(sale.amount_paid) || 0;
  const amount = Number(value) || 0;

  const check = async (s = serial) => {
    const clean = s.trim();
    if (!clean) { setLookup(null); return; }
    setChecking(true);
    try {
      const res = await apiFetch(`/api/trade-ins/lookup?serial=${encodeURIComponent(clean)}`);
      setLookup(res.ok ? await res.json() : { kind: "blocked", reason: "Could not check this serial." });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (lookup?.kind !== "new" || model || !modelSearch.trim()) { setModelResults([]); return; }
    const t = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${UNIT_CATEGORIES}&search=${encodeURIComponent(modelSearch)}`);
      const data = await res.json().catch(() => []);
      setModelResults(Array.isArray(data) ? data.slice(0, 8) : []);
    }, 300);
    return () => clearTimeout(t);
  }, [modelSearch, lookup, model]);

  const submit = async (confirmOverpayment = false) => {
    setError("");
    if (!serial.trim()) { setError("Enter the old laptop's serial number."); return; }
    if (lookup?.kind === "blocked") { setError(lookup.reason); return; }
    if (lookup?.kind === "new" && !model) { setError("Pick the old laptop's model."); return; }
    if (!(amount > 0)) { setError("Enter the trade-in value."); return; }
    if (idLast4 && !/^[A-Za-z0-9]{4}$/.test(idLast4)) { setError("ID proof: only its last 4 letters/digits."); return; }
    const res = await apiFetch("/api/trade-ins", {
      method: "POST",
      body: JSON.stringify({
        sale_id: sale.id, serial_number: serial.trim(), sku_id: model?.id, value: amount, trade_in_date: date,
        condition_notes: condition || undefined, accessories_included: cameWith || undefined,
        id_proof_type: idType || undefined, id_proof_last4: idLast4 || undefined, notes: notes || undefined,
        confirm_overpayment: confirmOverpayment || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.error_code === "exceeds_sale_total" && !confirmOverpayment) {
      if (window.confirm(`${data.error}\n\nSave anyway?`)) return submit(true);
      return;
    }
    if (data.error_code === "model_required") setLookup({ kind: "new" });
    if (!res.ok) { setError(data.error || "Could not save the trade-in."); return; }
    setSaved({ id: data.id, number: data.trade_in_number });
    onSaved();
  };
  const { run, pending } = useAsyncAction(submit);

  if (saved) {
    return (
      <SimpleModal isOpen onClose={onClose} title="Trade-in saved">
        <p className="text-sm">
          <span className="font-medium">{saved.number}</span>: {rupees(amount)} is now recorded on this sale as a trade-in payment, and the old laptop is in stock as QC pending.
        </p>
        <p className="text-sm text-muted-foreground mt-2">Print the buyback slip and get it signed by the customer.</p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button asChild>
            <Link href={`/dashboard/trade-ins/${saved.id}/slip`} target="_blank">Print buyback slip</Link>
          </Button>
        </div>
      </SimpleModal>
    );
  }

  return (
    <SimpleModal isOpen onClose={onClose} title="Trade-in (customer gives an old laptop)" closeOnBackdropClick={false}>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          For an upgrade: we buy the old laptop back and the customer pays the rest of this sale. The old laptop&apos;s own sale is not touched. For a faulty unit under warranty, use a Replacement Job instead.
        </p>
        <div className="rounded-md border p-2 grid grid-cols-3 gap-2 tabular-nums">
          <div><div className="text-xs text-muted-foreground">This sale</div>{rupees(total)}</div>
          <div><div className="text-xs text-muted-foreground">Paid so far</div>{rupees(paid)}</div>
          <div><div className="text-xs text-muted-foreground">Still due after trade-in</div>{rupees(Math.max(total - paid - amount, 0))}</div>
        </div>

        <div>
          <label className="block font-medium mb-1">Old laptop&apos;s serial number</label>
          <div className="flex gap-2">
            <Input value={serial} onChange={(e) => { setSerial(e.target.value); setLookup(null); setModel(null); }} onBlur={() => check()} placeholder="e.g. 5CG1117D8K" className="uppercase" />
            <Button variant="outline" onClick={() => check()} disabled={checking || !serial.trim()} loading={checking}>Check</Button>
          </div>
          {lookup?.kind === "ours" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Ours: {lookup.asset.description || "unit"}
              {lookup.previous_sale
                ? `, sold ${lookup.previous_sale.sale_date} to ${lookup.previous_sale.customer_name || "a customer"} for ${rupees(lookup.previous_sale.sale_total)}${lookup.previous_sale.customer_name && sale.customer_name && lookup.previous_sale.customer_name !== sale.customer_name ? " (a different customer from this sale)" : ""}.`
                : "."}{" "}
              It comes back to QC pending; that sale stays as it is.
            </p>
          )}
          {lookup?.kind === "blocked" && <p className="mt-1 text-xs text-destructive">{lookup.reason}</p>}
        </div>

        {lookup?.kind === "new" && (
          <div>
            <label className="block font-medium mb-1">Not a laptop we sold. Its model</label>
            {model ? (
              <div className="flex items-center justify-between rounded-md border px-2 py-1.5">
                <span>{model.label}</span>
                <button type="button" className="text-xs underline" onClick={() => setModel(null)}>Change</button>
              </div>
            ) : (
              <>
                <Input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="Search the catalogue, e.g. latitude 5490" />
                {modelResults.length > 0 && (
                  <div className="mt-1 rounded-md border divide-y max-h-48 overflow-y-auto">
                    {modelResults.map((s) => (
                      <button key={s.id} type="button" className="block w-full text-left px-2 py-1.5 hover:bg-muted" onClick={() => { setModel({ id: s.id, label: s.sku_description || s.full_sku_code }); setModelSearch(""); }}>
                        {s.sku_description || s.full_sku_code}
                        <span className="text-xs text-muted-foreground"> · {s.full_sku_code}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-muted-foreground">Model not in the list? Add it in SKU Master first.</p>
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-medium mb-1">Trade-in value (₹)</label>
            <Input type="number" inputMode="decimal" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 26000" />
          </div>
          <div>
            <label className="block font-medium mb-1">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">What we give the customer for it. It becomes this laptop&apos;s cost when it is sold again.</p>

        <div>
          <label className="block font-medium mb-1">Condition</label>
          <Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. working, scratches on lid, battery weak" />
        </div>
        <div>
          <label className="block font-medium mb-1">Came with</label>
          <Input value={cameWith} onChange={(e) => setCameWith(e.target.value)} placeholder="e.g. charger, bag" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-medium mb-1">Customer ID proof</label>
            <Select value={idType} onValueChange={setIdType}>
              <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>{ID_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="block font-medium mb-1">Last 4 only</label>
            <Input value={idLast4} maxLength={4} onChange={(e) => setIdLast4(e.target.value.toUpperCase())} placeholder="1234" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">Never the full Aadhaar/PAN number. Just enough to identify it on the signed slip.</p>
        <div>
          <label className="block font-medium mb-1">Notes</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </div>

        {error && <p className="text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={() => run()} disabled={pending || checking} loading={pending}>Save trade-in</Button>
        </div>
      </div>
    </SimpleModal>
  );
}
