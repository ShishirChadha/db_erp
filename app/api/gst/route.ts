import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const gst = request.nextUrl.searchParams.get('gst');
  if (!gst) {
    return NextResponse.json({ error: 'GST number required' }, { status: 400 });
  }

  try {
    // Use a free GST verification API
    const response = await fetch(`https://gstin.herokuapp.com/api/v1/verify/${gst}`);
    const data = await response.json();
    
    if (data && data.data) {
      // Return the company name
      return NextResponse.json({
        company_name: data.data.tradeNam || data.data.legalName || '',
      });
    } else {
      return NextResponse.json({ error: 'Invalid GST number' }, { status: 404 });
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to verify GST' }, { status: 500 });
  }
}