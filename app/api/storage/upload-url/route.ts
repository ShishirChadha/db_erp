import { createClient } from '@/lib/supabase/server';
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

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { fileName, contentType, assetNumber, folder, fileType } = await req.json();
  const timestamp = Date.now();
  const ext = fileName.split('.').pop();
  // `folder` is the generic form (e.g. "purchase-invoices/PO-2026-001"); `assetNumber`
  // is kept for backward compatibility with the existing purchases-module uploader.
  const prefix = folder ? sanitizePath(folder) : `purchases/${sanitizeSegment(assetNumber)}`;
  const key = `${prefix}/${sanitizeSegment(fileType)}-${timestamp}.${ext}`;

  // Generate signed URL for direct client upload
  const { data, error } = await supabase.storage
    .from('purchase-files')
    .createSignedUploadUrl(key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ uploadUrl: data.signedUrl, key });
}