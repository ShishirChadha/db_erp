"use client";

import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2, Eye } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { useRememberedDefault } from "@/lib/useRememberedDefault";
import { apiFetch } from "@/lib/api-client";

interface BusinessProfileOption {
  key: string;
  legal_name: string;
  state_code: string | null;
  is_gst_registered: boolean;
}

interface InvoiceFormProps {
  initialData?: InvoiceFormData;
  onSubmit: (data: InvoiceFormData) => Promise<void>;
  invoiceNumber?: string;
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
}

export function InvoiceForm({
  initialData,
  onSubmit,
  invoiceNumber,
  isSubmitting,
  entityKey = "digitalbluez",
  onEntityKeyChange,
  lockEntity,
}: InvoiceFormProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [entities, setEntities] = useState<BusinessProfileOption[]>([]);

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
    formState: { errors },
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

  console.log("Form errors:", errors); // debug

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const watchedItems = watch("items");
  const watchedCustomerGst = watch("customer_gst");
  const watchedPlaceOfSupply = watch("place_of_supply");
  // Keyed by entity for parity with the Quotation/Proforma form -- invoices are
  // Digitalbluez-only today (no entity picker on this form yet), so this
  // currently resolves to a single default, but is already scoped correctly
  // for whenever Techtenth/Cash invoicing ships.
  const notesDefault = useRememberedDefault("invoice-notes-default-digitalbluez", watch("notes") || "", (v) => setValue("notes", v));
  const termsDefault = useRememberedDefault("invoice-terms-default-digitalbluez", watch("terms_conditions") || "", (v) => setValue("terms_conditions", v));

  useEffect(() => {
    if (invoiceNumber && !initialData?.invoice_number) {
      setValue("invoice_number", invoiceNumber);
    }
  }, [invoiceNumber, setValue, initialData]);

  useEffect(() => {
    const subscription = watch((value, { name }) => {
      if (name?.startsWith("items.")) {
        const currentItems = value.items || [];
        let subtotal = 0;
        let totalGst = 0;
        currentItems.forEach((item: any) => {
          const qty = item.quantity || 0;
          const rate = item.rate || 0;
          const amount = qty * rate;
          subtotal += amount;
          const gstAmount = (item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0);
          totalGst += gstAmount;
        });
        setValue("subtotal", subtotal);
        setValue("total_gst", totalGst);
        setValue("grand_total", subtotal + totalGst);
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, setValue]);

  // The issuing entity drives both the tax split and whether tax applies at
  // all -- resolved from business_profiles rather than hardcoded, so a
  // non-UP customer gets IGST and a non-GST entity (Techtenth/Cash) gets a
  // Bill of Supply. Until the profiles load we fall back to the entity's key
  // being unresolvable, which yields no tax rather than a wrong tax.
  const selectedEntity = entities.find((e) => e.key === entityKey);
  const entityStateCode = selectedEntity?.state_code || "";
  const isGstRegistered = selectedEntity?.is_gst_registered ?? false;

  /**
   * Place-of-supply precedence, deliberately identical to classifyGst() in
   * lib/invoice-finalize.ts so a manually-built invoice and a finalized sale
   * can never disagree about the same customer:
   *   explicit Place of Supply field -> customer GSTIN prefix -> entity's own state.
   *
   * The explicit field used to be collected and then ignored, which silently
   * produced the wrong CGST/SGST-vs-IGST split whenever someone set it.
   */
  const resolvePlaceOfSupply = () => {
    const explicit = watchedPlaceOfSupply?.trim();
    if (explicit) return explicit.slice(0, 2);
    const fromGstin = watchedCustomerGst?.trim();
    if (fromGstin) return fromGstin.slice(0, 2);
    return entityStateCode;
  };

  const updateItemGST = (index: number) => {
    const item = watchedItems[index];
    if (!item) return;
    const quantity = item.quantity || 0;
    const rate = item.rate || 0;
    const amount = quantity * rate;
    const gstResult = isGstRegistered
      ? calculateGST(amount, item.gst_rate || 18, resolvePlaceOfSupply(), entityStateCode)
      : { gstType: null, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalGst: 0 };
    setValue(`items.${index}.gst_type`, gstResult.gstType);
    setValue(`items.${index}.cgst_amount`, gstResult.cgstAmount);
    setValue(`items.${index}.sgst_amount`, gstResult.sgstAmount);
    setValue(`items.${index}.igst_amount`, gstResult.igstAmount);
    setValue(`items.${index}.amount`, amount);
  };

  const addItem = (item: any) => {
    if (!item) return;
    const quantity = 1;
    const amount = quantity * item.price;
    const gstResult = isGstRegistered
      ? calculateGST(amount, item.gst_rate || 18, resolvePlaceOfSupply(), entityStateCode)
      : { gstType: null, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalGst: 0 };
    const newItem: InvoiceItemFormData = {
      item_type: item.type,
      asset_id: item.type === "asset" ? item.id : null,
      accessory_id: item.type === "accessory" ? item.id : null,
      description: `${item.identifier} - ${item.description}`,
      hsn_code: item.hsn_code || "",
      quantity: quantity,
      rate: item.price,
      gst_rate: item.gst_rate || 18,
      gst_type: gstResult.gstType,
      amount: amount,
      cgst_amount: gstResult.cgstAmount,
      sgst_amount: gstResult.sgstAmount,
      igst_amount: gstResult.igstAmount,
    };
    append(newItem);
    toast.success(`Added ${item.identifier} to invoice`);
  };

  const formData = watch();

  return (
    <div className="space-y-6">
      {/* Hidden subject field to satisfy validation */}
      <input type="hidden" {...register("subject")} />

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="entity_key">Issuing Entity</Label>
          <Select
            value={entityKey}
            onValueChange={(key) => {
              onEntityKeyChange?.(key);
              // The tax split depends on the entity's own state and whether it
              // is GST-registered, so every existing line has to be recomputed.
              watchedItems?.forEach((_, idx) => updateItemGST(idx));
            }}
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
          {/* Server-assigned via next_document_number() at save time -- never
              client-editable, per this project's numbering rules. */}
          <Input
            id="invoice_number"
            readOnly
            disabled
            className="bg-muted text-muted-foreground"
            value={watch("invoice_number") || "Assigned on save"}
          />
          <input type="hidden" {...register("invoice_number")} />
          {errors.invoice_number && <p className="text-sm text-destructive">{errors.invoice_number.message}</p>}
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
            onChange={(e) => {
              setValue("place_of_supply", e.target.value);
              watchedItems?.forEach((_, idx) => updateItemGST(idx));
            }}
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
                setSelectedCustomer(customer);
                setValue("customer_name", customer?.customer_name || "");
                setValue("customer_gst", customer?.gst_number || "");
                setValue("customer_address", customer?.address || "");
                setValue("customer_phone", customer?.phone || "");
                setValue("customer_email", customer?.email || "");
                if (customer?.place_of_supply) setValue("place_of_supply", customer.place_of_supply);
                watchedItems?.forEach((_, idx) => updateItemGST(idx));
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
            <Label htmlFor="customer_address">Address</Label>
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

      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold">Line Items</h3>
          <SearchableItemSelect onSelect={addItem} />
        </div>
        {/* Stacked cards instead of an 8-column table -- Description/HSN/Qty/Rate/
            GST%/Tax Type/Amount/remove never fit without a horizontal scrollbar on
            a laptop screen, let alone mobile. Each line now wraps naturally. */}
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  {/* rows=3 by default, auto-growing with content -- a single-line
                      input was too cramped for anything beyond a short SKU name. */}
                  <Textarea
                    {...register(`items.${index}.description`)}
                    rows={3}
                    className="resize-y"
                    onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }}
                  />
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="mt-5 shrink-0">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-28">
                  <Label className="text-xs text-muted-foreground">HSN</Label>
                  <Input {...register(`items.${index}.hsn_code`)} />
                </div>
                <div className="w-20">
                  <Label className="text-xs text-muted-foreground">Qty</Label>
                  <Input
                    type="number"
                    step="0.01"
                    {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                    onChange={() => updateItemGST(index)}
                  />
                </div>
                <div className="w-24">
                  <Label className="text-xs text-muted-foreground">Rate</Label>
                  <Input
                    type="number"
                    step="0.01"
                    {...register(`items.${index}.rate`, { valueAsNumber: true })}
                    onChange={() => updateItemGST(index)}
                  />
                </div>
                <div className="w-20">
                  <Label className="text-xs text-muted-foreground">GST%</Label>
                  <Input
                    type="number"
                    step="0.01"
                    {...register(`items.${index}.gst_rate`, { valueAsNumber: true })}
                    onChange={() => updateItemGST(index)}
                  />
                </div>
                <div className="w-36">
                  <Label className="text-xs text-muted-foreground">Tax Type</Label>
                  {/* Derived, never chosen: intra-state supply is CGST+SGST and
                      inter-state is IGST, decided by place of supply against the
                      entity's own state. This was previously a dropdown whose
                      onValueChange discarded the selection, so it looked
                      editable while always recomputing -- shown read-only now. */}
                  <Input
                    readOnly
                    disabled
                    className="bg-muted text-muted-foreground"
                    value={
                      watch(`items.${index}.gst_type`) === "CGST_SGST"
                        ? "CGST + SGST"
                        : watch(`items.${index}.gst_type`) === "IGST"
                          ? "IGST"
                          : "No tax"
                    }
                  />
                </div>
                <div className="ml-auto text-right">
                  <Label className="text-xs text-muted-foreground block">Amount</Label>
                  <span className="font-medium tabular-nums">₹{watch(`items.${index}.amount`)?.toFixed(2) || 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-end space-y-2">
          <div className="w-64 space-y-1">
            <div className="flex justify-between"><span>Subtotal:</span><span>₹{watch("subtotal").toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Total GST:</span><span>₹{watch("total_gst").toFixed(2)}</span></div>
            <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total:</span><span>₹{watch("grand_total").toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" {...register("notes")} />
          <div className="flex items-center gap-1.5 mt-1">
            <Checkbox id="notes-remember" checked={notesDefault.remember} onCheckedChange={(v) => notesDefault.toggle(!!v)} />
            <Label htmlFor="notes-remember" className="text-xs text-muted-foreground font-normal cursor-pointer">Use this as the default next time</Label>
          </div>
        </div>
        <div>
          <Label htmlFor="terms_conditions">Terms & Conditions</Label>
          <Textarea id="terms_conditions" {...register("terms_conditions")} />
          <div className="flex items-center gap-1.5 mt-1">
            <Checkbox id="terms-remember" checked={termsDefault.remember} onCheckedChange={(v) => termsDefault.toggle(!!v)} />
            <Label htmlFor="terms-remember" className="text-xs text-muted-foreground font-normal cursor-pointer">Use this as the default next time</Label>
          </div>
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
        <Button
          type="button"
          loading={isSubmitting}
          onClick={() => {
            console.log("🔵 Save Draft button clicked, calling handleSubmit");
            handleSubmit(onSubmit)();
          }}
        >
          Save Draft
        </Button>
        <Button
          type="button"
          variant="default"
          loading={isSubmitting}
          onClick={() => {
            console.log("🔵 Submit for Approval clicked");
            handleSubmit(async (data) => {
              data.status = "pending_approval";
              await onSubmit(data);
            })();
          }}
        >
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
              <div><h3 className="font-bold">Digital Bluez ERP</h3><p className="text-sm">Your Business Address</p></div>
              <div className="text-right"><p className="font-bold">INVOICE</p><p>#{formData.invoice_number}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p><strong>Invoice Date:</strong> {formData.invoice_date ? format(new Date(formData.invoice_date), "dd/MM/yyyy") : "-"}</p>
                <p><strong>Place of Supply:</strong> {formData.place_of_supply || "-"}</p>
              </div>
              <div>
                <p><strong>Customer:</strong> {formData.customer_name}</p>
                <p><strong>GST:</strong> {formData.customer_gst || "-"}</p>
                <p>{formData.customer_address}</p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>GST%</TableHead>
                  <TableHead>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formData.items?.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>₹{item.rate.toFixed(2)}</TableCell>
                    <TableCell>{item.gst_rate}%</TableCell>
                    <TableCell>₹{item.amount.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex flex-col items-end">
              <div className="w-64">
                <div className="flex justify-between"><span>Subtotal:</span><span>₹{formData.subtotal?.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Total GST:</span><span>₹{formData.total_gst?.toFixed(2)}</span></div>
                <div className="flex justify-between font-bold"><span>Grand Total:</span><span>₹{formData.grand_total?.toFixed(2)}</span></div>
              </div>
            </div>
            {formData.notes && <div><strong>Notes:</strong><p className="text-sm">{formData.notes}</p></div>}
            {formData.terms_conditions && <div><strong>Terms:</strong><p className="text-sm">{formData.terms_conditions}</p></div>}
          </div>
          <div className="flex justify-end"><Button onClick={() => setPreviewOpen(false)}>Close</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}