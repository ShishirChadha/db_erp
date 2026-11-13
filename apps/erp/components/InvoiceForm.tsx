"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon, Plus, X, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchableCustomerSelect } from "./SearchableCustomerSelect";
import { SearchableItemSelect } from "./SearchableItemSelect";
import { calculateGST } from "@/lib/gstCalculation";
import { invoiceSchema, InvoiceFormData, InvoiceItemFormData } from "@/lib/schemas/invoiceSchema";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface BusinessProfileOption {
  key: string;
  legal_name: string;
  state_code: string | null;
  is_gst_registered: boolean;
  default_notes: string | null;
  default_terms: string | null;
}

interface InvoiceFormProps {
  initialData?: InvoiceFormData;
  onSubmit: (data: InvoiceFormData) => Promise<void>;
  isSubmitting?: boolean;
  /**
   * Which business entity is issuing. Controlled by the parent page because the
   * page is what mints the entity's own number series -- the form must never be
   * able to drift from the series the number came out of.
   */
  entityKey?: string;
  onEntityKeyChange?: (key: string) => void;
  /** Locked on edit: an issued invoice's entity is a historical fact. */
  lockEntity?: boolean;
  /**
   * New invoice prefilled from another one (Clone). Its number is still only a
   * preview minted on save, and its own Notes/T&C are kept rather than replaced
   * by the entity defaults.
   */
  isClone?: boolean;
}

// 'exclusive' = rates are typed before GST (what invoice_items.rate stores);
// 'inclusive' = rates are typed GST-included and reduced to their pre-GST base on
// save -- same Before GST / After GST choice as the Sell page and Quotations/PI.
type PriceMode = "exclusive" | "inclusive";

const GST_RATE_OPTIONS = [0, 5, 18, 40];

const round2 = (n: number) => Math.round(n * 100) / 100;
const toExclusive = (rate: number, gstRate: number) => round2(rate / (1 + gstRate / 100));
const toInclusive = (rate: number, gstRate: number) => round2(rate * (1 + gstRate / 100));
const money = (n: number) => `₹${n.toFixed(2)}`;

// Zoho-style item table columns (Item Details / Qty / Rate / Tax / Amount /
// remove), applied only once the form itself is wide enough (@2xl container
// query) -- narrower, each line stacks so the table never scrolls sideways.
const GRID_WITH_TAX = "@2xl:grid-cols-[minmax(0,1fr)_5rem_7.5rem_6.5rem_7rem_2rem]";
const GRID_NO_TAX = "@2xl:grid-cols-[minmax(0,1fr)_5rem_7.5rem_7rem_2rem]";

export function InvoiceForm({
  initialData,
  onSubmit,
  isSubmitting,
  entityKey = "digitalbluez",
  onEntityKeyChange,
  lockEntity,
  isClone,
}: InvoiceFormProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [entities, setEntities] = useState<BusinessProfileOption[]>([]);
  const [priceMode, setPriceMode] = useState<PriceMode>("exclusive");
  const [showErrors, setShowErrors] = useState(false);
  const [zohoMode, setZohoMode] = useState(false);
  const isNew = !initialData?.id;

  useEffect(() => {
    apiFetch("/api/business-profiles")
      .then((res) => res.json())
      .then((data) => setEntities(Array.isArray(data) ? data : []))
      .catch(() => setEntities([]));
  }, []);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
  } = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: initialData || {
      invoice_number: "",
      invoice_date: new Date(),
      status: "draft",
      items: [],
      subtotal: 0,
      total_gst: 0,
      grand_total: 0,
      subject: "", // ✅ added to avoid validation error
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const watchedItems = watch("items") || [];
  const watchedCustomerGst = watch("customer_gst");
  const watchedPlaceOfSupply = watch("place_of_supply");

  // A new invoice starts with the issuing entity's default Notes/T&C (Settings ->
  // Business Profiles), same as a new Quotation/Proforma. Switching entity swaps
  // them only while the field is empty or still holds the previous entity's
  // default, so typed text is never clobbered. Editing an existing invoice never
  // touches them, and a clone keeps its own copied text unless it was empty.
  const prevEntityDefaultsRef = useRef<BusinessProfileOption | null>(null);
  useEffect(() => {
    if (!isNew) return;
    const entity = entities.find((e) => e.key === entityKey);
    if (!entity) return;
    const prev = prevEntityDefaultsRef.current;
    const curNotes = watch("notes") || "";
    const curTerms = watch("terms_conditions") || "";
    if (curNotes === "" || (prev && curNotes === (prev.default_notes || ""))) setValue("notes", entity.default_notes || "");
    if (curTerms === "" || (prev && curTerms === (prev.default_terms || ""))) setValue("terms_conditions", entity.default_terms || "");
    prevEntityDefaultsRef.current = entity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, entityKey, isNew]);

  // The number shown under Issuing Entity on a new invoice is a read-only peek
  // (GET /api/invoices/next-number) -- nothing is reserved, so a cancelled form
  // burns no number. The parent page mints the real one atomically on save.
  // Held in the form field too, since the schema requires a number to validate.
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    setValue("invoice_number", "");
    apiFetch(`/api/invoices/next-number?entity_key=${encodeURIComponent(entityKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled) return;
        setZohoMode(d?.invoicing_mode === "external");
        setValue("invoice_number", d?.next_number || "Assigned on save");
      });
    return () => { cancelled = true; };
  }, [entityKey, isNew, setValue]);

  // The issuing entity drives both the tax split and whether tax applies at
  // all -- resolved from business_profiles rather than hardcoded, so a
  // non-UP customer gets IGST and a non-GST entity (Techtenth/Cash) gets a
  // Bill of Supply. Until the profiles load we fall back to the entity's key
  // being unresolvable, which yields no tax rather than a wrong tax.
  const selectedEntity = entities.find((e) => e.key === entityKey);
  const entityStateCode = selectedEntity?.state_code || "";
  const isGstRegistered = selectedEntity?.is_gst_registered ?? false;
  // Inclusive pricing means nothing for a non-GST entity -- its rate is simply
  // what the customer pays.
  const inclusive = isGstRegistered && priceMode === "inclusive";

  /**
   * Place-of-supply precedence, deliberately identical to classifyGst() in
   * lib/invoice-finalize.ts so a manually-built invoice and a finalized sale
   * can never disagree about the same customer:
   *   explicit Place of Supply field -> customer GSTIN prefix -> entity's own state.
   */
  const resolvePlaceOfSupply = () => {
    const explicit = watchedPlaceOfSupply?.trim();
    if (explicit) return explicit.slice(0, 2);
    const fromGstin = watchedCustomerGst?.trim();
    if (fromGstin) return fromGstin.slice(0, 2);
    return entityStateCode;
  };
  const placeOfSupply = resolvePlaceOfSupply();
  const isIntraState = !!entityStateCode && entityStateCode === placeOfSupply;

  // One line's pre-GST rate/base, tax split and total -- computed live for display
  // and again on save, so what each line shows is exactly what gets stored.
  // invoice_items.amount is the GST-inclusive line total, the same convention the
  // sale-to-invoice path (lib/invoice-finalize.ts) and "+ Add Charge" use.
  const lineBreakdown = (it: Partial<InvoiceItemFormData>) => {
    const quantity = Number(it.quantity) || 0;
    const gstRate = Number(it.gst_rate ?? 0);
    const rate = inclusive ? toExclusive(Number(it.rate) || 0, gstRate) : Number(it.rate) || 0;
    const base = round2(quantity * rate);
    const gst = isGstRegistered
      ? calculateGST(base, gstRate, placeOfSupply, entityStateCode)
      : { gstType: null, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalGst: 0 };
    const cgst = round2(gst.cgstAmount), sgst = round2(gst.sgstAmount), igst = round2(gst.igstAmount);
    return { rate, base, gstType: gst.gstType, cgst, sgst, igst, total: round2(base + cgst + sgst + igst) };
  };

  const lines = watchedItems.map(lineBreakdown);
  const totals = lines.reduce(
    (acc, l) => ({ base: acc.base + l.base, cgst: acc.cgst + l.cgst, sgst: acc.sgst + l.sgst, igst: acc.igst + l.igst, total: acc.total + l.total }),
    { base: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
  );

  // Switching modes converts every line's rate so what the customer pays stays the
  // same -- never just relabels a stale number under the new meaning (Sell page rule).
  const changePriceMode = (mode: PriceMode) => {
    if (mode === priceMode) return;
    watchedItems.forEach((it, idx) => {
      const r = Number(it.rate) || 0;
      setValue(`items.${idx}.rate`, mode === "inclusive" ? toInclusive(r, it.gst_rate ?? 0) : toExclusive(r, it.gst_rate ?? 0));
    });
    setPriceMode(mode);
  };

  const emptyTax = { gst_type: null, cgst_amount: 0, sgst_amount: 0, igst_amount: 0 } as const;

  const addItem = (item: any) => {
    if (!item) return;
    const gstRate = item.gst_rate ?? 18;
    const newItem: InvoiceItemFormData = {
      item_type: item.type,
      asset_id: item.type === "asset" ? item.id : null,
      accessory_id: item.type === "accessory" ? item.id : null,
      description: `${item.identifier} - ${item.description}`,
      hsn_code: item.hsn_code || "",
      quantity: 1,
      rate: inclusive ? toInclusive(item.price, gstRate) : item.price,
      gst_rate: gstRate,
      amount: 0,
      ...emptyTax,
    };
    append(newItem);
    toast.success(`Added ${item.identifier} to invoice`);
  };

  // A manual charge with no SKU/asset of its own -- shipping, packing,
  // installation, a one-off adjustment, etc. GST defaults to 18%; pick "No GST"
  // in the Tax column for a pure reimbursement charge.
  const addCustomLine = () => {
    append({
      item_type: "custom",
      asset_id: null,
      accessory_id: null,
      description: "",
      hsn_code: "",
      quantity: 1,
      rate: 0,
      gst_rate: isGstRegistered ? 18 : 0,
      amount: 0,
      ...emptyTax,
    });
  };

  // Turns the form's as-entered lines into what's stored: pre-GST rate, derived
  // tax split, GST-inclusive amount, and header totals. HSN is mandatory on every
  // line for a GST-registered entity (it prints on the tax invoice and feeds
  // GSTR-1's HSN summary); a Bill of Supply has no HSN column.
  const submitWith = (status?: InvoiceFormData["status"]) =>
    handleSubmit(
      async (data) => {
        setShowErrors(true);
        if (isGstRegistered && data.items.some((it) => !String(it.hsn_code || "").trim())) {
          toast.error(`HSN code is required on every line for ${selectedEntity?.legal_name || entityKey}.`);
          return;
        }
        const items = data.items.map((it) => {
          const b = lineBreakdown(it);
          return {
            ...it,
            hsn_code: String(it.hsn_code || "").trim(),
            rate: b.rate,
            gst_rate: isGstRegistered ? it.gst_rate : 0,
            gst_type: b.gstType,
            cgst_amount: b.cgst,
            sgst_amount: b.sgst,
            igst_amount: b.igst,
            amount: b.total,
          };
        });
        const subtotal = round2(items.reduce((s, it, i) => s + lines[i].base, 0));
        const totalGst = round2(items.reduce((s, it) => s + it.cgst_amount + it.sgst_amount + it.igst_amount, 0));
        await onSubmit({ ...data, ...(status ? { status } : {}), items, subtotal, total_gst: totalGst, grand_total: round2(subtotal + totalGst) });
      },
      (errs) => {
        setShowErrors(true);
        const first = errs.items
          ? "Every line needs a description and a quantity above 0."
          : Object.values(errs)[0]?.message;
        toast.error(String(first || "Please fix the highlighted fields."));
      },
    )();

  const formData = watch();
  const gridCols = isGstRegistered ? GRID_WITH_TAX : GRID_NO_TAX;

  return (
    <div className="space-y-6">
      {/* Hidden subject field to satisfy validation */}
      <input type="hidden" {...register("subject")} />

      {isClone && (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          This is a new invoice prefilled from another one. Its lines are standalone charges —
          they are not linked to any sale and won&apos;t move stock. For goods actually sold,
          invoice the sale from Sales Ledger instead.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="entity_key">Issuing Entity</Label>
          <Select
            value={entityKey}
            onValueChange={(key) => onEntityKeyChange?.(key)}
            disabled={lockEntity || entities.length === 0}
          >
            <SelectTrigger id="entity_key">
              <SelectValue placeholder="Loading entities…" />
            </SelectTrigger>
            <SelectContent>
              {entities.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  {e.legal_name}
                  {e.is_gst_registered
                    ? ` — GST ${e.state_code ?? "?"}`
                    : " — not GST registered"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isNew && zohoMode && (
            <p className="text-xs text-destructive mt-1">
              This entity&apos;s invoices are still generated in Zoho (transition mode, Settings → Business
              Profiles) — the ERP can&apos;t issue one for it. Record the Zoho invoice number on the sale instead.
            </p>
          )}
          {lockEntity && (
            <p className="text-xs text-muted-foreground mt-1">
              The issuing entity of an already-numbered invoice can&apos;t be changed.
            </p>
          )}
          {!isGstRegistered && entities.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              This entity isn&apos;t GST registered — the document is a Bill of Supply and carries no tax.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="invoice_number">Invoice Number</Label>
          {/* Never client-editable, per this project's numbering rules. */}
          <Input
            id="invoice_number"
            readOnly
            disabled
            className="bg-muted text-muted-foreground font-mono"
            value={watch("invoice_number") || "…"}
          />
          <input type="hidden" {...register("invoice_number")} />
          {isNew && !zohoMode && <p className="text-xs text-muted-foreground mt-1">Assigned on save — nothing is reserved until then.</p>}
        </div>
        <div>
          <Label>Invoice Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {watch("invoice_date") ? format(watch("invoice_date"), "dd/MM/yyyy") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <Calendar mode="single" selected={watch("invoice_date")} onSelect={(date) => date && setValue("invoice_date", date)} />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label htmlFor="place_of_supply">Place of Supply</Label>
          <Input
            id="place_of_supply"
            placeholder={entityStateCode ? `Defaults to ${entityStateCode}` : "2-digit state code"}
            {...register("place_of_supply")}
          />
          <p className="text-xs text-muted-foreground mt-1">
            2-digit state code. Leave blank to take it from the customer&apos;s GSTIN, else the entity&apos;s own state.
          </p>
        </div>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-semibold">Bill To</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Customer</Label>
            <SearchableCustomerSelect
              value={watch("customer_id") || null}
              onChange={(id) => setValue("customer_id", id)}
              onCustomerData={(customer) => {
                setValue("customer_name", customer?.customer_name || "");
                setValue("customer_gst", customer?.gst_number || "");
                setValue("customer_address", customer?.address || "");
                setValue("shipping_address", customer?.shipping_address || "");
                setValue("customer_phone", customer?.phone || "");
                setValue("customer_email", customer?.email || "");
              }}
            />
          </div>
          <div>
            <Label htmlFor="customer_name">Customer Name</Label>
            <Input id="customer_name" {...register("customer_name")} />
          </div>
          <div>
            <Label htmlFor="customer_gst">GST Number</Label>
            <Input id="customer_gst" {...register("customer_gst")} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="customer_address">Billing Address</Label>
            <Input id="customer_address" {...register("customer_address")} />
          </div>
          <div>
            <Label htmlFor="customer_phone">Phone</Label>
            <Input id="customer_phone" {...register("customer_phone")} />
          </div>
          <div>
            <Label htmlFor="customer_email">Email</Label>
            <Input id="customer_email" type="email" {...register("customer_email")} />
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-4">
        <Label htmlFor="shipping_address">Ship To</Label>
        <Textarea id="shipping_address" placeholder="Shipping address (if different from billing address)" {...register("shipping_address")} />
      </div>

      {/* ---------- Item table (Zoho layout) ---------- */}
      <div className="@container border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h3 className="font-semibold">Item Table</h3>
          {isGstRegistered && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Amounts are
              <select value={priceMode} onChange={(e) => changePriceMode(e.target.value as PriceMode)} className="border p-1 rounded text-xs text-foreground bg-background">
                <option value="exclusive">Tax Exclusive (before GST)</option>
                <option value="inclusive">Tax Inclusive (after GST)</option>
              </select>
            </label>
          )}
        </div>

        <div className="rounded-md border">
          <div className={cn("hidden @2xl:grid gap-2 px-3 py-2 bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b", gridCols)}>
            <span>Item Details</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Rate{isGstRegistered && (inclusive ? " (incl.)" : " (excl.)")}</span>
            {isGstRegistered && <span>Tax</span>}
            <span className="text-right">Amount{isGstRegistered && " (incl.)"}</span>
            <span />
          </div>

          {fields.map((field, index) => {
            const it = watchedItems[index] || {};
            const line = lines[index];
            const hsnMissing = showErrors && isGstRegistered && !String(it.hsn_code || "").trim();
            const descMissing = showErrors && !String(it.description || "").trim();
            const gstRate = Number(it.gst_rate ?? 0);
            return (
              <div key={field.id} className={cn("grid grid-cols-2 gap-2 px-3 py-2 border-b items-start", gridCols)}>
                <div className="col-span-2 @2xl:col-span-1 space-y-1.5">
                  <div className="flex items-start gap-2">
                    {/* rows=2 by default, auto-growing with content. */}
                    <Textarea
                      {...register(`items.${index}.description`)}
                      rows={2}
                      placeholder="Item name / description"
                      className={cn("resize-y min-h-0", descMissing && "border-destructive")}
                      onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }}
                    />
                    <button type="button" onClick={() => remove(index)} className="@2xl:hidden text-destructive p-1 shrink-0" title="Remove line">
                      <X className="size-4" />
                    </button>
                  </div>
                  {isGstRegistered && (
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">HSN/SAC<span className="text-destructive">*</span></span>
                      <input
                        {...register(`items.${index}.hsn_code`)}
                        className={cn("border px-1.5 py-1 rounded w-28 font-mono bg-background", hsnMissing && "border-destructive")}
                        placeholder="e.g. 8471"
                      />
                    </label>
                  )}
                </div>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground @2xl:hidden">Quantity</span>
                  <Input type="number" step="0.01" className="text-right tabular-nums" {...register(`items.${index}.quantity`, { valueAsNumber: true })} />
                </label>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground @2xl:hidden">Rate{isGstRegistered && (inclusive ? " (incl. GST)" : " (excl. GST)")}</span>
                  <Input type="number" step="0.01" className="text-right tabular-nums" {...register(`items.${index}.rate`, { valueAsNumber: true })} />
                </label>
                {isGstRegistered && (
                  <label className="flex flex-col gap-0.5 text-xs">
                    <span className="text-muted-foreground @2xl:hidden">Tax</span>
                    <select
                      value={gstRate}
                      onChange={(e) => setValue(`items.${index}.gst_rate`, Number(e.target.value))}
                      className="h-8 border rounded-md px-1.5 text-sm bg-background"
                    >
                      {[...new Set([...GST_RATE_OPTIONS, gstRate])].sort((a, b) => a - b).map((r) => (
                        <option key={r} value={r}>{r === 0 ? "No GST" : `GST ${r}%`}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-col gap-0.5 text-xs text-right">
                  <span className="text-muted-foreground @2xl:hidden">Amount{isGstRegistered && " (incl. GST)"}</span>
                  <span className="text-sm font-medium tabular-nums py-1.5">{money(line?.total ?? 0)}</span>
                </div>
                <button type="button" onClick={() => remove(index)} className="hidden @2xl:block text-destructive py-1.5" title="Remove line">
                  <X className="size-4" />
                </button>
                {/* Per-line split, shown in both Tax Exclusive and Inclusive modes. */}
                {isGstRegistered && line && (
                  <div className="col-span-2 @2xl:col-span-full flex flex-wrap justify-end gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                    <span>Base <span className="text-foreground">{money(line.base)}</span></span>
                    {isIntraState ? (
                      <>
                        <span>CGST {gstRate / 2}% <span className="text-foreground">{money(line.cgst)}</span></span>
                        <span>SGST {gstRate / 2}% <span className="text-foreground">{money(line.sgst)}</span></span>
                      </>
                    ) : (
                      <span>IGST {gstRate}% <span className="text-foreground">{money(line.igst)}</span></span>
                    )}
                    <span>Total <span className="font-medium text-foreground">{money(line.total)}</span></span>
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2 p-2">
            <SearchableItemSelect onSelect={addItem} />
            <Button type="button" variant="outline" size="sm" onClick={addCustomLine}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add New Row
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm rounded-md bg-muted/40 p-3">
            <div className="flex justify-between"><span className="text-muted-foreground">Sub Total{isGstRegistered && " (before GST)"}</span><span className="tabular-nums">{money(totals.base)}</span></div>
            {isGstRegistered && (isIntraState ? (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{money(totals.cgst)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{money(totals.sgst)}</span></div>
              </>
            ) : (
              <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="tabular-nums">{money(totals.igst)}</span></div>
            ))}
            <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total (₹)</span><span className="tabular-nums">{money(totals.total)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" {...register("notes")} />
        </div>
        <div>
          <Label htmlFor="terms_conditions">Terms & Conditions</Label>
          <Textarea id="terms_conditions" {...register("terms_conditions")} />
        </div>
      </div>
      <div>
        <Label htmlFor="bank_details">Bank Details</Label>
        <Textarea id="bank_details" {...register("bank_details")} />
      </div>

      <div className="flex justify-end space-x-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
          <Eye className="mr-2 h-4 w-4" /> Preview
        </Button>
        <Button type="button" loading={isSubmitting} disabled={isNew && zohoMode} onClick={() => submitWith()}>
          Save Draft
        </Button>
        <Button type="button" variant="default" loading={isSubmitting} disabled={isNew && zohoMode} onClick={() => submitWith("pending_approval")}>
          Submit for Approval
        </Button>
      </div>

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice Preview</DialogTitle>
            <DialogDescription className="sr-only">
              Preview of invoice details before saving
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-between">
              <div><h3 className="font-bold">{selectedEntity?.legal_name || "—"}</h3></div>
              <div className="text-right"><p className="font-bold">{isGstRegistered ? "TAX INVOICE" : "BILL OF SUPPLY"}</p><p>#{formData.invoice_number}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p><strong>Invoice Date:</strong> {formData.invoice_date ? format(new Date(formData.invoice_date), "dd/MM/yyyy") : "-"}</p>
                <p><strong>Place of Supply:</strong> {placeOfSupply || "-"}</p>
              </div>
              <div>
                <p><strong>Customer:</strong> {formData.customer_name}</p>
                <p><strong>GST:</strong> {formData.customer_gst || "-"}</p>
                <p>{formData.customer_address}</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    {isGstRegistered && <TableHead className="text-right">{isIntraState ? "CGST + SGST" : "IGST"}</TableHead>}
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formData.items?.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(lines[idx]?.base ?? 0)}</TableCell>
                      {isGstRegistered && (
                        <TableCell className="text-right tabular-nums">
                          {money((lines[idx]?.cgst ?? 0) + (lines[idx]?.sgst ?? 0) + (lines[idx]?.igst ?? 0))}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">{money(lines[idx]?.total ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col items-end">
              <div className="w-64">
                <div className="flex justify-between"><span>Subtotal:</span><span>{money(totals.base)}</span></div>
                <div className="flex justify-between"><span>Total GST:</span><span>{money(totals.cgst + totals.sgst + totals.igst)}</span></div>
                <div className="flex justify-between font-bold"><span>Grand Total:</span><span>{money(totals.total)}</span></div>
              </div>
            </div>
            {formData.notes && <div><strong>Notes:</strong><p className="text-sm whitespace-pre-line">{formData.notes}</p></div>}
            {formData.terms_conditions && <div><strong>Terms:</strong><p className="text-sm whitespace-pre-line">{formData.terms_conditions}</p></div>}
          </div>
          <div className="flex justify-end"><Button onClick={() => setPreviewOpen(false)}>Close</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
