import { z } from 'zod';

export const invoiceItemSchema = z.object({
  id: z.string().optional(),
  item_type: z.enum(['asset', 'accessory', 'custom']),
  asset_id: z.string().nullable().optional(),
  accessory_id: z.string().nullable().optional(),
  description: z.string().min(1, 'Description is required'),
  hsn_code: z.string().optional(),
  quantity: z.number().min(0.01, 'Quantity must be greater than 0'),
  rate: z.number().min(0, 'Rate must be greater than or equal to 0'),
  gst_rate: z.number().min(0).max(100),
  gst_type: z.enum(['IGST', 'CGST_SGST']),
  amount: z.number(),
  cgst_amount: z.number().optional(),
  sgst_amount: z.number().optional(),
  igst_amount: z.number().optional(),
});

export const invoiceSchema = z.object({
  id: z.string().optional(),
  invoice_number: z.string().min(1, 'Invoice number is required'),
  invoice_date: z.date(),
  place_of_supply: z.string().optional(),
  customer_id: z.string().nullable().optional(),
  customer_name: z.string().min(1, 'Customer name is required'),
  customer_gst: z.string().optional(),
  customer_address: z.string().optional(),
  customer_phone: z.string().optional(),
  customer_email: z.string().email().optional(),
  shipping_address: z.string().optional(),
  subject: z.string().optional(),   // ✅ changed from z.string() to optional
  notes: z.string().optional(),
  bank_details: z.string().optional(),
  terms_conditions: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1, 'At least one item is required'),
  subtotal: z.number(),
  total_gst: z.number(),
  grand_total: z.number(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'paid']),
});

export type InvoiceFormData = z.infer<typeof invoiceSchema>;
export type InvoiceItemFormData = z.infer<typeof invoiceItemSchema>;