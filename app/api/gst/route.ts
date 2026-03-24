import { NextRequest, NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';

interface GSTResponse {
  status: string;
  taxpayerDetails: {
    tradeName?: string;
    legalName?: string;
    status?: string;
    gstin?: string;
  };
  address?: {
    fullAddress?: string;
  };
}

export async function GET(request: NextRequest) {
  const gst = request.nextUrl.searchParams.get('gst');
  if (!gst) {
    return NextResponse.json({ error: 'GST number required' }, { status: 400 });
  }

  // Format validation
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/.test(gst)) {
    return NextResponse.json({ error: 'Invalid GST format' }, { status: 400 });
  }

  try {
    const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
    const run = await client.actor('mikolabs/gstin').call({ GSTIN: gst });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'GST number not found' }, { status: 404 });
    }

    // Safe type conversion: first to unknown, then to our interface
    const data = items[0] as unknown as GSTResponse;

    if (data.status === 'success' && data.taxpayerDetails) {
      return NextResponse.json({
        company_name: data.taxpayerDetails.tradeName || data.taxpayerDetails.legalName,
        status: data.taxpayerDetails.status,
        address: data.address?.fullAddress,
      });
    } else {
      return NextResponse.json({ error: 'GST number not found or inactive' }, { status: 404 });
    }
  } catch (error) {
    console.error('GST verification error:', error);
    return NextResponse.json({ error: 'Failed to verify GST' }, { status: 500 });
  }
}