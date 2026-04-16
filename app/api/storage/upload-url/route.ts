import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { fileName, contentType, assetNumber, fileType } = await req.json();
  const timestamp = Date.now();
  const ext = fileName.split('.').pop();
  const key = `purchases/${assetNumber}/${fileType}-${timestamp}.${ext}`;

  // Generate signed URL for direct client upload
  const { data, error } = await supabase.storage
    .from('purchase-files')
    .createSignedUploadUrl(key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ uploadUrl: data.signedUrl, key });
}