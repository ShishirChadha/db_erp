import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/service';
import { getCookieSessionUser, isOwner } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_BUCKETS = ['purchase-files', 'documents'] as const;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key, expiresIn = 60, bucket = 'purchase-files' } = await req.json(); // expires in seconds (default 60s = 1 min, you can increase)
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }

  // documents holds recon source material (vendor invoices, bank statements) --
  // cost/vendor-bearing, owner-only, same posture as Purchase Orders/Vendors. It
  // has no storage.objects RLS read policy at all, so the signed URL is minted via
  // the service-role client after this app-level check.
  if (bucket === 'documents') {
    const sessionUser = await getCookieSessionUser();
    if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const storageClient = bucket === 'documents' ? supabaseAdmin.storage : supabase.storage;
  const { data, error } = await storageClient
    .from(bucket)
    .createSignedUrl(key, expiresIn);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}