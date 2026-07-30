import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

export async function GET(req: NextRequest) {
  const { data, error } = await supabaseAdmin.from('sku_category_templates').select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}