// Common GST state codes -- the first two digits of any Indian GSTIN encode
// the registration state (e.g. '09AAICD2790D1ZM' -> Uttar Pradesh). Not
// exhaustive; unknown codes fall back to displaying the raw code.
export const STATE_CODE_TO_NAME: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '36': 'Telangana', '37': 'Andhra Pradesh',
}

export function stateCodeFromGstin(gstin?: string | null): string | null {
  const trimmed = gstin?.trim()
  return trimmed && trimmed.length >= 2 ? trimmed.slice(0, 2) : null
}

export function stateNameFromCode(stateCode?: string | null): string | null {
  return stateCode ? STATE_CODE_TO_NAME[stateCode] || null : null
}
