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

interface InvoiceFormProps {
  initialData?: InvoiceFormData;
  onSubmit: (data: InvoiceFormData) => Promise<void>;
  invoiceNumber?: string;
  isSubmitting?: boolean;
}

export function InvoiceForm({ initialData, onSubmit, invoiceNumber, isSubmitting }: InvoiceFormProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

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

  const updateItemGST = (index: number) => {
    const item = watchedItems[index];
    if (!item) return;
    const quantity = item.quantity || 0;
    const rate = item.rate || 0;
    const amount = quantity * rate;
    const gstResult = calculateGST(
      amount,
      item.gst_rate || 18,
      watchedPlaceOfSupply || "",
      watchedCustomerGst || null
    );
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
    const gstResult = calculateGST(
      amount,
      item.gst_rate || 18,
      watchedPlaceOfSupply || "",
      watchedCustomerGst || null
    );
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
        <div>
          <Label htmlFor="invoice_number">Invoice Number *</Label>
          <Input id="invoice_number" {...register("invoice_number")} placeholder="e.g., DBIN/2026-27/0001" />
          {errors.invoice_number && <p className="text-sm text-red-500">{errors.invoice_number.message}</p>}
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
          <Input id="place_of_supply" {...register("place_of_supply")} onChange={(e) => {
            setValue("place_of_supply", e.target.value);
            watchedItems?.forEach((_, idx) => updateItemGST(idx));
          }} />
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
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>GST%</TableHead>
                <TableHead>Tax Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field, index) => (
                <TableRow key={field.id}>
                  <TableCell>
                    <Input {...register(`items.${index}.description`)} />
                  </TableCell>
                  <TableCell>
                    <Input {...register(`items.${index}.hsn_code`)} />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                      onChange={() => updateItemGST(index)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      {...register(`items.${index}.rate`, { valueAsNumber: true })}
                      onChange={() => updateItemGST(index)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      {...register(`items.${index}.gst_rate`, { valueAsNumber: true })}
                      onChange={() => updateItemGST(index)}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={watch(`items.${index}.gst_type`)}
                      onValueChange={() => updateItemGST(index)}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IGST">IGST</SelectItem>
                        <SelectItem value="CGST_SGST">CGST+SGST</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">₹{watch(`items.${index}.amount`)?.toFixed(2) || 0}</TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
        <Button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            console.log("🔵 Save Draft button clicked, calling handleSubmit");
            handleSubmit(onSubmit)();
          }}
        >
          {isSubmitting ? "Saving..." : "Save Draft"}
        </Button>
        <Button
          type="button"
          variant="default"
          disabled={isSubmitting}
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