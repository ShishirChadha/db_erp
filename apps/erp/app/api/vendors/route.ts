import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getCookieSessionUser, isOwner } from '@/lib/auth/session';
import { logAuditEvent } from '@/lib/audit-log';

// Vendor details are explicitly owner-only data -- employees never see them.
export async function GET() {
  const sessionUser = await getCookieSessionUser();
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendors')
    .select('*')          // ← fixed: asterisk inside quotes
    .eq('is_deleted', false)
    .order('company_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const sessionUser = await getCookieSessionUser();
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const supabase = await createClient();
  const body = await req.json();
  const { data, error } = await supabase.from('vendors').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'vendors',
    tableName: 'vendors',
    recordId: data?.id ?? null,
    recordLabel: data?.company_name ?? body?.company_name ?? null,
  });

  return NextResponse.json({ success: true });
}