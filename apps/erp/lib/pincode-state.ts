import { STATE_CODE_TO_NAME } from '@db/shared'

/**
 * Best-effort PIN code -> GST state code, from India Post's public PIN
 * circle divisions (not an authoritative government dataset -- there isn't
 * one that maps 6-digit PINs to GST state codes). Used only as a *prefill*
 * for a human to confirm/correct, never written silently without a human
 * having seen it: several circles genuinely span more than one state (AP/
 * Telangana's old shared range, the north-eastern cluster, J&K/Ladakh,
 * Bihar/Jharkhand's border), and guessing wrong there is worse than leaving
 * the field blank, since it feeds straight into CGST+SGST vs IGST. Those
 * ranges deliberately return null.
 *
 * A handful of small enclaves share their state's 2-digit prefix with a
 * different state/UT (Goa inside Maharashtra's 40, Chandigarh inside
 * Punjab's 16, Puducherry inside Tamil Nadu's 60) -- checked by exact
 * 3-digit prefix first, ahead of the 2-digit table.
 */
const THREE_DIGIT_OVERRIDES: Record<string, string> = {
  '403': '30', // Goa, inside Maharashtra's 40x range
  '160': '04', // Chandigarh, inside Punjab's 16x range
  '605': '34', // Puducherry, inside Tamil Nadu's 60x range
}

const TWO_DIGIT_RANGES: Record<string, string> = {
  '11': '07', // Delhi
  '12': '06', '13': '06', // Haryana
  '14': '03', '15': '03', '16': '03', // Punjab (160 Chandigarh handled above)
  '17': '02', // Himachal Pradesh
  '18': '01', // Jammu & Kashmir
  // '19': ambiguous -- Kashmir valley and Ladakh share this range
  '20': '09', '21': '09', '22': '09', '23': '09', // Uttar Pradesh
  '24': '05', '25': '05', '26': '05', // Uttarakhand
  '27': '09', '28': '09', // Uttar Pradesh
  '30': '08', '31': '08', '32': '08', '33': '08', '34': '08', // Rajasthan
  '36': '24', '37': '24', '38': '24', '39': '24', // Gujarat
  '40': '27', '41': '27', '42': '27', '43': '27', '44': '27', // Maharashtra (403 Goa handled above)
  '45': '23', '46': '23', '47': '23', '48': '23', // Madhya Pradesh
  '49': '22', // Chhattisgarh
  // '50'-'53': ambiguous -- Andhra Pradesh/Telangana shared this range pre- and post-bifurcation
  '56': '29', '57': '29', '58': '29', '59': '29', // Karnataka
  // '60': ambiguous -- Tamil Nadu/Puducherry (605 handled above)
  '61': '33', '62': '33', '63': '33', '64': '33', '66': '33', // Tamil Nadu
  '67': '32', '68': '32', '69': '32', // Kerala
  '70': '19', '71': '19', '72': '19', '73': '19', // West Bengal
  // '74': ambiguous -- West Bengal/Andaman & Nicobar (744)
  '75': '21', '76': '21', '77': '21', // Odisha
  '78': '18', // Assam
  // '79': ambiguous -- north-eastern states cluster
  '80': '10', '81': '10', '82': '10', // Bihar
  '83': '20', '84': '20', '85': '20', // Jharkhand
  // '90'-'99': Army Postal Service, not a civilian state/address
}

/** Resolves a 6-digit Indian PIN to a GST state code, or null if the PIN's
 * circle spans more than one state/UT and guessing would risk a wrong
 * CGST+SGST/IGST classification. */
export function stateCodeFromPincode(pincode?: string | null): string | null {
  const pin = pincode?.trim()
  if (!pin || !/^\d{6}$/.test(pin)) return null
  return THREE_DIGIT_OVERRIDES[pin.slice(0, 3)] ?? TWO_DIGIT_RANGES[pin.slice(0, 2)] ?? null
}

export function stateNameFromPincode(pincode?: string | null): string | null {
  const code = stateCodeFromPincode(pincode)
  return code ? STATE_CODE_TO_NAME[code] ?? null : null
}
