import { NextRequest, NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';

export async function GET(request: NextRequest) {
  const gst = request.nextUrl.searchParams.get('gst');
  if (!gst) return NextResponse.json({ error: 'GST required' }, { status: 400 });

  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

  try {
    const run = await client.actor('mikolabs/gstin').call({ GSTIN: gst });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const data = items[0];

    if (data.status === 'success') {
      return NextResponse.json({
        company_name: data.taxpayerDetails.tradeName || data.taxpayerDetails.legalName,
        status: data.taxpayerDetails.status,
        address: data.address.fullAddress,
      });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}