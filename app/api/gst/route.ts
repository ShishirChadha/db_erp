import { NextRequest, NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';

export async function GET(request: NextRequest) {
  const gst = request.nextUrl.searchParams.get('gst');
  if (!gst) {
    return NextResponse.json({ error: 'GST number required' }, { status: 400 });
  }

  // Basic format validation
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/.test(gst)) {
    return NextResponse.json({ error: 'Invalid GST format' }, { status: 400 });
  }

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.error('APIFY_API_TOKEN is not set in environment variables');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    // Initialize the Apify client with your token
    const client = new ApifyClient({ token });

    // Prepare the input for the actor
    const input = { GSTIN: gst };

    // Run the actor (use the correct actor ID: 'mikolabs/gst') and wait for it to finish
    const run = await client.actor('mikolabs/gst').call(input);
    console.log(`Actor run completed with ID: ${run.id}`);

    // Fetch the results from the run's default dataset
    const dataset = await client.dataset(run.defaultDatasetId);
    const { items } = await dataset.listItems();
    console.log('Dataset items:', JSON.stringify(items, null, 2));

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No data found for this GST number' }, { status: 404 });
    }

    // Extract the taxpayer details from the first item
    const firstItem = items[0];
    // Some APIs return the data in a 'results' array, others directly
    const data = firstItem?.results?.[0] || firstItem;

    if (data?.status === 'success' && data?.taxpayerDetails) {
      return NextResponse.json({
        company_name: data.taxpayerDetails.tradeName || data.taxpayerDetails.legalName,
        status: data.taxpayerDetails.status,
        address: data.address?.fullAddress,
      });
    } else {
      console.error('Unexpected response structure:', data);
      return NextResponse.json({ error: 'Could not extract company name from GST data' }, { status: 404 });
    }
  } catch (error: any) {
    console.error('GST verification error:', error.message || error);
    return NextResponse.json({ error: 'Failed to verify GST' }, { status: 500 });
  }
}