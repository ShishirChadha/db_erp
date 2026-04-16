import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key, expiresIn = 60 } = await req.json(); // expires in seconds (default 60s = 1 min, you can increase)

  const { data, error } = await supabase.storage
    .from('purchase-files')
    .createSignedUrl(key, expiresIn);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}