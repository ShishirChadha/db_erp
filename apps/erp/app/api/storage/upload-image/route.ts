import { supabaseAdmin } from '@/lib/supabase/service';
import { getCookieSessionUser, canEditPage } from '@/lib/auth/session';
import { processUploadedImage } from '@/lib/image-process';
import { sanitizePath, sanitizeSegment } from '@/app/api/storage/upload-url/route';
import { NextRequest, NextResponse } from 'next/server';

// Processed (resized + re-encoded to webp) uploads for the two product-images
// bucket paths that actually get rendered at scale on the storefront -- SKU photos
// and homepage banners. Every other bucket/folder keeps using the raw
// signed-URL-PUT flow in /api/storage/upload-url; this route exists specifically so
// large phone-camera originals never land in storage unmodified (see
// lib/image-process.ts and apps/web/next.config.ts for why that matters).
const ALLOWED_FOLDER_PREFIXES = ['products/', 'banners'];

export async function POST(req: NextRequest) {
  const sessionUser = await getCookieSessionUser();
  if (!canEditPage(sessionUser, 'website')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const folder = String(form.get('folder') || '');
  const fileType = String(form.get('fileType') || 'photo');

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!ALLOWED_FOLDER_PREFIXES.some((p) => folder === p || folder.startsWith(p))) {
    return NextResponse.json({ error: 'Invalid folder' }, { status: 400 });
  }

  let processed;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    processed = await processUploadedImage(input);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Could not process image' }, { status: 400 });
  }

  const timestamp = Date.now();
  const prefix = sanitizePath(folder);
  const key = `${prefix}/${sanitizeSegment(fileType)}-${timestamp}.webp`;

  const { error } = await supabaseAdmin.storage
    .from('product-images')
    .upload(key, processed.buffer, {
      contentType: processed.contentType,
      cacheControl: '31536000, immutable',
      upsert: true,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key, width: processed.width, height: processed.height });
}
