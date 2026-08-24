import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session';
import { logAuditEvent } from '@/lib/audit-log';
import { redactManyForRole } from '@/lib/auth/redact';
import { supabaseAdmin } from '@/lib/supabase/service';

// Full vendor records (GST, contact info) are owner-only, and even the company-name-level
// list is scoped: accessories/new_entry roles only ever see vendors tagged
// supplies_accessories=true (a laptop-only vendor is never returned to them at all, not
// merely redacted) -- see docs/decisions.md, 2026-08-24. redactManyForRole strips the
// contact/GST fields for non-owner roles via the 'vendors' redaction_rules on top of that.
// Switched from the cookie-based session helper to the Bearer-token one used by every
// other API route in the app (getCookieSessionUser is for server components) -- this
// route is called via apiFetch like any other, and only the Bearer token is guaranteed
// to be present on that path.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req);
  const ownerCaller = isOwner(sessionUser);
  if (!ownerCaller && !hasPageAccess(sessionUser, ['accessories', 'new_entry'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let query = supabaseAdmin
    .from('vendors')
    .select('*')          // ← fixed: asterisk inside quotes
    .eq('is_deleted', false)
    .order('company_name');
  if (!ownerCaller) query = query.eq('supplies_accessories', true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const redacted = await redactManyForRole(data || [], 'vendors', sessionUser!.role);
  return NextResponse.json(redacted);
}

// A non-owner (accessories/new_entry access) may only create a vendor to use for an
// accessory receipt -- always forced supplies_accessories=true regardless of what's sent,
// resolved-by-name against any existing vendor first (same dedup idiom as
// resolveOrCreateSku/custom_options) rather than risking a near-duplicate company record.
// No approval gate -- matches this app's "stock-in is immediately real" principle. Editing
// or deleting a vendor, or tagging/untagging an existing one, stays exclusively on the
// owner-only Vendors page. The owner's own POST path (full fields, no forced tag, no
// dedup) is unchanged from before.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req);
  const ownerCaller = isOwner(sessionUser);
  if (!ownerCaller && !hasPageAccess(sessionUser, ['accessories', 'new_entry'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  if (!ownerCaller) {
    if (!body?.company_name?.trim()) {
      return NextResponse.json({ error: 'Company Name is required.' }, { status: 400 });
    }

    const trimmedName = body.company_name.trim();
    const { data: existing } = await supabaseAdmin
      .from('vendors')
      .select('*')
      .eq('is_deleted', false);
    const match = (existing || []).find(
      (v: any) => v.company_name.trim().toLowerCase() === trimmedName.toLowerCase()
    );

    if (match) {
      let resolved = match;
      if (!match.supplies_accessories) {
        const { data: updated, error: updateErr } = await supabaseAdmin
          .from('vendors')
          .update({ supplies_accessories: true })
          .eq('id', match.id)
          .select()
          .single();
        if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
        resolved = updated;
      }
      const redacted = await redactManyForRole([resolved], 'vendors', sessionUser!.role);
      return NextResponse.json(redacted[0], { status: 200 });
    }

    const { data, error } = await supabaseAdmin
      .from('vendors')
      .insert({ ...body, supplies_accessories: true })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAuditEvent({
      actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
      actionType: 'create',
      module: 'vendors',
      tableName: 'vendors',
      recordId: data?.id ?? null,
      recordLabel: data?.company_name ?? null,
    });

    const redacted = await redactManyForRole([data], 'vendors', sessionUser!.role);
    return NextResponse.json(redacted[0], { status: 201 });
  }

  const { data, error } = await supabaseAdmin.from('vendors').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'vendors',
    tableName: 'vendors',
    recordId: data?.id ?? null,
    recordLabel: data?.company_name ?? body?.company_name ?? null,
  });

  return NextResponse.json(data, { status: 201 });
}