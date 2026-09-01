import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/service';
import { getCookieSessionUser, canEditPage } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';

// bucket defaults to 'purchase-files' for backward compatibility with every
// existing caller, which never sent one.
const ALLOWED_BUCKETS = ['purchase-files', 'expense-receipts'] as const;

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { key, bucket = 'purchase-files' } = await req.json();
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }

  if (bucket === 'expense-receipts') {
    const sessionUser = await getCookieSessionUser();
    if (!canEditPage(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const storageClient = bucket === 'expense-receipts' ? supabaseAdmin.storage : supabase.storage;
  const { error } = await storageClient.from(bucket).remove([key]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
