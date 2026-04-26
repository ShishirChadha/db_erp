import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { header, items } = body;

  // Validate
  if (!header.vendor_id) return NextResponse.json({ error: 'Vendor required' }, { status: 400 });
  if (!header.po_date) return NextResponse.json({ error: 'PO date required' }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: 'At least one line item' }, { status: 400 });

  // Calculate totals
  let subtotal = 0;
  const lineItemsForInsert = items.map((item: any) => {
    const lineTotal = item.quantity * item.unit_cost * (1 - (item.discount_percent || 0) / 100);
    subtotal += lineTotal;
    return {
      sku_variant_id: item.sku_variant_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      discount_percent: item.discount_percent || 0,
      serial_numbers: item.serial_numbers,
      asset_description: item.asset_description,
      notes: item.notes,
    };
  });
  const taxPercent = header.tax_percent ?? 18;
  const taxAmount = subtotal * (taxPercent / 100);
  const totalCost = subtotal + taxAmount;

  // Insert header
  const { data: po, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      vendor_id: header.vendor_id,
      po_date: header.po_date,
      purchased_by_user_id: user.id,
      purchased_by_type: header.purchased_by_type,
      purchased_by_other: header.purchased_by_type === 'Other' ? header.purchased_by_other : null,
      status: header.status || 'draft',
      supplier_invoice_number: header.supplier_invoice_number,
      eway_bill_no: header.eway_bill_no,
      has_expense: header.has_expense || false,
      expense_amount: header.expense_amount,
      expense_description: header.expense_description,
      remarks: header.remarks,
      public_photo_url: header.public_photo_url,
      subtotal,
      tax_percent: taxPercent,
      tax_amount: taxAmount,
      total_cost: totalCost,
    })
    .select()
    .single();

  if (poError) return NextResponse.json({ error: poError.message }, { status: 500 });

  // Insert line items
  const itemsWithPoId = lineItemsForInsert.map((item: any) => ({ ...item, po_id: po.id }));
  const { error: itemsError } = await supabase.from('purchase_line_items').insert(itemsWithPoId);
  if (itemsError) {
    await supabase.from('purchase_orders').delete().eq('id', po.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, poId: po.id });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      *,
      vendors (company_name, vendor_code),
      purchase_line_items (
        *,
        sku_variants (
          *,
          sku_base (sku_base, product_name)
        )
      )
    `)
    .eq('is_deleted', false)
    .order('po_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}