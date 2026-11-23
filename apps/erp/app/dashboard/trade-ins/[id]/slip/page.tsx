"use client";

import { use, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

// The buyback slip for one trade-in: what we bought from the customer, for how
// much, against which sale, and their signed declaration that the laptop is
// theirs to sell. Printed and signed at the counter; it is the purchase record
// when buying from an individual. Only the ID's type and last 4 characters are
// ever stored -- the rest is written by hand if needed.

const rupees = (n: number) => `₹${(Math.round(Number(n) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`; }
function threeDigits(n: number) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}
// Indian grouping: crore, lakh, thousand, hundred.
function inWords(amount: number) {
  let n = Math.floor(amount);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
}

export default function TradeInSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [t, setT] = useState<any | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch(`/api/trade-ins/${id}`).then(async (res) => {
      if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not load the trade-in.");
      else setT(await res.json());
    });
  }, [id]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!t) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const c = t.customers || {};
  const e = t.entity || {};
  const contact = e.contact || {};
  const address = [c.address_line1, c.address_line2, c.city, c.state, c.pincode].filter(Boolean).join(", ");
  const unit = t.asset?.sku_master?.sku_description || "Laptop";
  const saleTotal = Number(t.sale?.sale_total) || 0;
  const balance = Math.max(saleTotal - Number(t.value), 0);

  return (
    <div>
      {/* Print only the slip, not the ERP around it. */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #trade-in-slip, #trade-in-slip * { visibility: visible !important; }
        #trade-in-slip { position: absolute; left: 0; top: 0; width: 100%; border: none !important; }
        @page { size: A4; margin: 14mm; }
      }`}</style>
      <div className="flex justify-between items-center mb-3 max-w-3xl print:hidden">
        <p className="text-sm text-muted-foreground">Print two copies: one for the customer, one signed copy for our file.</p>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      {t.voided_at && (
        <p className="max-w-3xl mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive print:hidden">
          This trade-in was undone ({t.void_reason}). Don&apos;t use this slip.
        </p>
      )}

      <div id="trade-in-slip" className="max-w-3xl bg-white text-black border rounded-md p-8 text-[13px] leading-relaxed">
        <div className="flex justify-between gap-4 border-b border-black/20 pb-3">
          <div>
            <div className="text-lg font-bold">{e.legal_name || t.payment_account}</div>
            {e.address && <div className="whitespace-pre-line">{e.address}</div>}
            {e.gstin && <div>GSTIN: {e.gstin}</div>}
            {(contact.phone || contact.email) && <div>{[contact.phone, contact.email].filter(Boolean).join(" · ")}</div>}
          </div>
          <div className="text-right">
            <div className="text-base font-bold">BUYBACK / TRADE-IN SLIP</div>
            <div>No. {t.trade_in_number}</div>
            <div>Date: {t.trade_in_date}</div>
          </div>
        </div>

        <h2 className="font-semibold mt-4 mb-1">Sold by (customer)</h2>
        <table className="w-full"><tbody>
          <tr><td className="w-40 align-top">Name</td><td>{c.customer_name || "________________________"}</td></tr>
          <tr><td className="align-top">Phone</td><td>{c.phone || "________________________"}</td></tr>
          <tr><td className="align-top">Address</td><td>{address || "______________________________________________"}</td></tr>
          <tr><td className="align-top">ID proof</td><td>{t.id_proof_type ? `${t.id_proof_type} ending ${t.id_proof_last4 || "____"}` : "________________ ending ____"}</td></tr>
        </tbody></table>

        <h2 className="font-semibold mt-4 mb-1">Device bought back</h2>
        <table className="w-full"><tbody>
          <tr><td className="w-40 align-top">Model</td><td>{unit}</td></tr>
          <tr><td className="align-top">Serial number</td><td className="font-mono">{t.asset?.serial_number}</td></tr>
          <tr><td className="align-top">Condition</td><td>{t.condition_notes || "As inspected at the counter"}</td></tr>
          <tr><td className="align-top">Came with</td><td>{t.accessories_included || "—"}</td></tr>
          {t.previous_sale && <tr><td className="align-top">Originally bought from us</td><td>{t.previous_sale.sale_date}</td></tr>}
        </tbody></table>

        <h2 className="font-semibold mt-4 mb-1">Amount</h2>
        <table className="w-full"><tbody>
          <tr><td className="w-40 align-top">Buyback value</td><td className="font-semibold">{rupees(t.value)} <span className="font-normal">(Rupees {inWords(Number(t.value))} only)</span></td></tr>
          <tr>
            <td className="align-top">Settled against</td>
            <td>
              Purchase of {t.sale?.unit ? `${t.sale.unit.description || "a unit"} (serial ${t.sale.unit.serial_number})` : "items"} for {rupees(saleTotal)}
              {balance > 0 ? `; balance ${rupees(balance)} payable by the customer.` : "."}
            </td>
          </tr>
        </tbody></table>

        <h2 className="font-semibold mt-4 mb-1">Customer&apos;s declaration</h2>
        <p>
          I confirm that I am the lawful owner of the device described above; that it is not stolen and is free of any
          loan, lease, lien or dispute; and that I am selling it to {e.legal_name || t.payment_account} for {rupees(t.value)},
          adjusted against my purchase as stated above. I have removed or consent to the erasure of all my personal data on
          it, and I will be responsible for any claim arising from its ownership before today.
        </p>

        <div className="grid grid-cols-2 gap-10 mt-14">
          <div className="border-t border-black/40 pt-1">Customer&apos;s signature<br /><span className="text-black/60">{c.customer_name}</span></div>
          <div className="border-t border-black/40 pt-1 text-right">For {e.legal_name || t.payment_account}<br /><span className="text-black/60">Authorised signatory{t.entered?.full_name ? ` (${t.entered.full_name})` : ""}</span></div>
        </div>
      </div>
    </div>
  );
}
