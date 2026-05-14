import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { file: base64File, filename } = body

    if (!base64File || !filename) {
      return NextResponse.json({ error: 'Missing file data or filename' }, { status: 400 })
    }

    // Decode base64 to a Buffer
    const buffer = Buffer.from(base64File, 'base64')

    // Upload to Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from('purchase-invoices')
      .upload(`invoices/${Date.now()}_${filename}`, buffer, {
        contentType: filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('purchase-invoices')
      .getPublicUrl(data.path)

    return NextResponse.json({ url: urlData.publicUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}