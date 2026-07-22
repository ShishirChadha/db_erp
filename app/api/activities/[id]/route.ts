import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { getCookieSessionUser, hasPageAccess } from '@/lib/auth/session';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;  // ✅ await the Promise
  const sessionUser = await getCookieSessionUser();
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPageAccess(sessionUser, 'activities')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const supabase = await createClient();
  const user = { id: sessionUser.id };

  const body = await req.json();
  const { error } = await supabase
    .from('activities')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('Update error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sessionUser = await getCookieSessionUser();
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPageAccess(sessionUser, 'activities')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const supabase = await createClient();
  const user = { id: sessionUser.id };

  const { error } = await supabase
    .from('activities')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('Delete error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}