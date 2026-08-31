import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/service';
import { getCookieSessionUser, canEditPage, isOwner } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';

// Path segments here come from client input (assetNumber, folder, fileType) and are
// embedded directly into a Supabase Storage object key, so they're sanitized to prevent
// path traversal (e.g. "../other-context/secret").
function sanitizeSegment(value: string) {
  const cleaned = (value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  // A cleaned segment of "." or ".." would still enable path traversal when joined
  // back into a path, even though every individual character is "allowed".
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}
function sanitizePath(path: string) {
  return path.split('/').map(sanitizeSegment).filter(Boolean).join('/');
}

const ALLOWED_BUCKETS = ['purchase-files', 'product-images', 'documents'] as const;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { fileName, contentType, assetNumber, folder, fileType, bucket = 'purchase-files' } = await req.json();
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }

  // product-images is website-publishing content -- gated by the 'website' edit
  // grant (owner always passes canEditPage), same access level as the SKU
  // Website dialog's image-management endpoints.
  if (bucket === 'product-images') {
    const sessionUser = await getCookieSessionUser();
    if (!canEditPage(sessionUser, 'website')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // documents holds recon source material (vendor invoices, bank statements) --
  // cost/vendor-bearing, owner-only, same posture as Purchase Orders/Vendors.
  if (bucket === 'documents') {
    const sessionUser = await getCookieSessionUser();
    if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const timestamp = Date.now();
  const ext = fileName.split('.').pop();
  // `folder` is the generic form (e.g. "purchase-invoices/PO-2026-001"); `assetNumber`
  // is kept for backward compatibility with the existing purchases-module uploader.
  const prefix = folder ? sanitizePath(folder) : `purchases/${sanitizeSegment(assetNumber)}`;
  const key = `${prefix}/${sanitizeSegment(fileType)}-${timestamp}.${ext}`;

  // product-images and documents have no storage.objects RLS policy for writes --
  // the canEditPage/isOwner check above is the real gate, so the signed URL itself
  // is minted via the service-role client for those buckets. purchase-files keeps
  // using the cookie-session client unchanged (it has its own authenticated-role
  // RLS policy).
  const storageClient = bucket === 'product-images' || bucket === 'documents' ? supabaseAdmin.storage : supabase.storage;
  const { data, error } = await storageClient
    .from(bucket)
    .createSignedUploadUrl(key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ uploadUrl: data.signedUrl, key });
}