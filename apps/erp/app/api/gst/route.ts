import { NextRequest, NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import { getSessionUser } from '@/lib/auth/session';
import { stateCodeFromGstin, stateNameFromCode } from '@/lib/gstStateCodes';

// Define the expected shape of the GST API response
interface GSTResponseItem {
  status?: string;
  taxpayerDetails?: {
    tradeName?: string;
    legalName?: string;
    status?: string;
    gstin?: string;
  };
  address?: {
    fullAddress?: string;
  };
  results?: GSTResponseItem[];
}

// Very small in-process cache -- a GSTIN's registered details rarely change,
// and this avoids paying for a repeat lookup (e.g. the user re-opening the
// same customer's edit dialog) within a single server process's lifetime.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const cache = new Map<string, { data: any; expiresAt: number }>();

export async function GET(request: NextRequest) {
  // Any authenticated, active user may look up a GSTIN -- customer creation
  // (lightweight fields) is open to both roles, and this lookup never
  // touches cost/vendor/margin data.
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gst = request.nextUrl.searchParams.get('gst');
  if (!gst) {
    return NextResponse.json({ error: 'GST number required' }, { status: 400 });
  }

  // Basic format validation
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/.test(gst)) {
    return NextResponse.json({ error: 'Invalid GST format' }, { status: 400 });
  }

  // The state code is encoded directly in the GSTIN itself (first two
  // digits) -- no need to trust the external lookup for this, and it's
  // available even if the lookup below fails.
  const stateCode = stateCodeFromGstin(gst);
  const state = stateNameFromCode(stateCode);

  const cached = cache.get(gst);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ ...cached.data, state, state_code: stateCode });
  }

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.error('APIFY_API_TOKEN is not set in environment variables');
    // Provider is down/unconfigured -- still return the state code we can
    // derive locally so the customer form isn't left completely empty.
    return NextResponse.json({ error: 'Server configuration error', state, state_code: stateCode }, { status: 500 });
  }

  try {
    const client = new ApifyClient({ token });

    // Run the actor and wait for it to finish
    const run = await client.actor('mikolabs/gst').call({ GSTIN: gst });

    // Fetch the results from the run's default dataset
    const dataset = await client.dataset(run.defaultDatasetId);
    const { items } = await dataset.listItems();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No data found for this GST number', state, state_code: stateCode }, { status: 404 });
    }

    // Type assertion to tell TypeScript the shape of the items
    const firstItem = items[0] as GSTResponseItem;
    const data = firstItem?.results?.[0] || firstItem;

    if (data?.status === 'success' && data?.taxpayerDetails) {
      const result = {
        company_name: data.taxpayerDetails.tradeName || data.taxpayerDetails.legalName,
        status: data.taxpayerDetails.status,
        address: data.address?.fullAddress,
      };
      cache.set(gst, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json({ ...result, state, state_code: stateCode });
    } else {
      console.error('Unexpected response structure:', data);
      return NextResponse.json({ error: 'Could not extract company name from GST data', state, state_code: stateCode }, { status: 404 });
    }
  } catch (error: any) {
    console.error('GST verification error:', error.message || error);
    return NextResponse.json({ error: 'Failed to verify GST', state, state_code: stateCode }, { status: 500 });
  }
}
