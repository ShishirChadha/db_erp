import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: bases, error } = await supabase
    .from('sku_base')
    .select(`
      id,
      sku_base,
      product_name,
      brand,
      category,
      sku_variants (
        id,
        variant_code,
        variant_name,
        specs,
        unit_cost,
        selling_price,
        current_stock
      )
    `)
    .order('sku_base');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(bases);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { type, ...data } = body;

    if (type === 'base') {
      // Insert into sku_base
      const { error } = await supabase.from('sku_base').insert({
        sku_base: data.sku_base,
        product_name: data.product_name,
        brand: data.brand || null,
        category: data.category || null,
      });
      if (error) {
        console.error('Error inserting base:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    } 
    else if (type === 'variant') {
      // Insert into sku_variants with specs as JSONB
      const { error } = await supabase.from('sku_variants').insert({
        sku_base_id: data.sku_base_id,
        variant_code: data.variant_code,
        variant_name: data.variant_name || null,
        specs: data.specs || {},
        unit_cost: data.unit_cost || null,
        selling_price: data.selling_price || null,
        warranty_months: data.warranty_months || null,
      });
      if (error) {
        console.error('Error inserting variant:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }
    else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}