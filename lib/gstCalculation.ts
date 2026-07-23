export interface GSTResult {
  gstType: 'IGST' | 'CGST_SGST';
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalGst: number;
}

/**
 * Calculate GST by comparing state codes: the seller entity's home state code
 * (from business_profiles.state_code, e.g. '09' for Digitalbluez/UP) against
 * the place of supply's state code. Same state -> CGST+SGST; different -> IGST.
 * A GSTIN's first two digits are its state code (e.g. '09AAICD...' -> '09'),
 * so a customer's placeOfSupplyStateCode can be derived from their GSTIN when
 * no explicit customer state is on file.
 * @param amount - The taxable amount
 * @param gstRate - GST rate in percentage (e.g., 18 for 18%)
 * @param placeOfSupplyStateCode - Two-digit GST state code of the place of supply
 * @param entityStateCode - The selling entity's home state code (e.g. '09')
 * @returns GSTResult with split details
 */
export function calculateGST(
  amount: number,
  gstRate: number,
  placeOfSupplyStateCode: string = '',
  entityStateCode: string = ''
): GSTResult {
  const totalGst = (amount * gstRate) / 100;
  const halfGst = totalGst / 2;

  const isIntraState =
    !!entityStateCode && !!placeOfSupplyStateCode && entityStateCode === placeOfSupplyStateCode;

  if (isIntraState) {
    return {
      gstType: 'CGST_SGST',
      cgstAmount: halfGst,
      sgstAmount: halfGst,
      igstAmount: 0,
      totalGst: totalGst,
    };
  } else {
    return {
      gstType: 'IGST',
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: totalGst,
      totalGst: totalGst,
    };
  }
}

/**
 * Format GST for display
 */
export function formatGSTBreakdown(gstResult: GSTResult): string {
  if (gstResult.gstType === 'IGST') {
    return `IGST: ₹${gstResult.igstAmount.toFixed(2)}`;
  } else {
    return `CGST: ₹${gstResult.cgstAmount.toFixed(2)} | SGST: ₹${gstResult.sgstAmount.toFixed(2)}`;
  }
}