// macOS reports a Model Identifier ("MacBookAir10,1"), never the A-number
// printed on the bottom case ("A2337") that this business names Mac SKUs by.
// This table maps one to the other, plus the facts a script can't read.
//
// An identifier that's missing here is not an error: the model falls back to
// the family name ("MacBook Pro"), is flagged "new" on the review screen, and
// the engineer types the A-number from the bottom case. Add the row then.
//
// Where one identifier was sold over two years (MacBookAir7,2 = 2015 and
// 2017), `year` is the one this shop sees most; the engineer can change it.

export interface MacModel {
  family: 'MacBook' | 'MacBook Air' | 'MacBook Pro' | 'iMac' | 'Mac mini'
  a: string            // "A2337"
  year: number
  inches?: number      // screen, as SKUs record it
  touchId?: boolean
  touchBar?: boolean
}

const m = (family: MacModel['family'], a: string, year: number, inches?: number, touchId = false, touchBar = false): MacModel =>
  ({ family, a, year, inches, touchId, touchBar })

export const MAC_MODELS: Record<string, MacModel> = {
  // ---- MacBook Air ----
  'MacBookAir7,1': m('MacBook Air', 'A1465', 2015, 11.6),
  'MacBookAir7,2': m('MacBook Air', 'A1466', 2017, 13.3),
  'MacBookAir8,1': m('MacBook Air', 'A1932', 2018, 13.3, true),
  'MacBookAir8,2': m('MacBook Air', 'A1932', 2019, 13.3, true),
  'MacBookAir9,1': m('MacBook Air', 'A2179', 2020, 13.3, true),
  'MacBookAir10,1': m('MacBook Air', 'A2337', 2020, 13.3, true),
  'Mac14,2': m('MacBook Air', 'A2681', 2022, 13.6, true),
  'Mac14,15': m('MacBook Air', 'A2941', 2023, 15.3, true),
  'Mac15,12': m('MacBook Air', 'A3113', 2024, 13.6, true),
  'Mac15,13': m('MacBook Air', 'A3114', 2024, 15.3, true),
  'Mac16,12': m('MacBook Air', 'A3240', 2025, 13.6, true),
  'Mac16,13': m('MacBook Air', 'A3241', 2025, 15.3, true),

  // ---- MacBook (12-inch) ----
  'MacBook8,1': m('MacBook', 'A1534', 2015, 12),
  'MacBook9,1': m('MacBook', 'A1534', 2016, 12),
  'MacBook10,1': m('MacBook', 'A1534', 2017, 12),

  // ---- MacBook Pro, Intel ----
  'MacBookPro11,1': m('MacBook Pro', 'A1502', 2014, 13.3),
  'MacBookPro11,2': m('MacBook Pro', 'A1398', 2014, 15.4),
  'MacBookPro11,3': m('MacBook Pro', 'A1398', 2014, 15.4),
  'MacBookPro11,4': m('MacBook Pro', 'A1398', 2015, 15.4),
  'MacBookPro11,5': m('MacBook Pro', 'A1398', 2015, 15.4),
  'MacBookPro12,1': m('MacBook Pro', 'A1502', 2015, 13.3),
  'MacBookPro13,1': m('MacBook Pro', 'A1708', 2016, 13.3),
  'MacBookPro13,2': m('MacBook Pro', 'A1706', 2016, 13.3, true, true),
  'MacBookPro13,3': m('MacBook Pro', 'A1707', 2016, 15.4, true, true),
  'MacBookPro14,1': m('MacBook Pro', 'A1708', 2017, 13.3),
  'MacBookPro14,2': m('MacBook Pro', 'A1706', 2017, 13.3, true, true),
  'MacBookPro14,3': m('MacBook Pro', 'A1707', 2017, 15.4, true, true),
  'MacBookPro15,1': m('MacBook Pro', 'A1990', 2018, 15.4, true, true),
  'MacBookPro15,2': m('MacBook Pro', 'A1989', 2018, 13.3, true, true),
  'MacBookPro15,3': m('MacBook Pro', 'A1990', 2019, 15.4, true, true),
  'MacBookPro15,4': m('MacBook Pro', 'A2159', 2019, 13.3, true, true),
  'MacBookPro16,1': m('MacBook Pro', 'A2141', 2019, 16, true, true),
  'MacBookPro16,4': m('MacBook Pro', 'A2141', 2019, 16, true, true),
  'MacBookPro16,2': m('MacBook Pro', 'A2251', 2020, 13.3, true, true),
  'MacBookPro16,3': m('MacBook Pro', 'A2289', 2020, 13.3, true, true),

  // ---- MacBook Pro, Apple Silicon ----
  'MacBookPro17,1': m('MacBook Pro', 'A2338', 2020, 13.3, true, true),
  'MacBookPro18,1': m('MacBook Pro', 'A2485', 2021, 16, true),
  'MacBookPro18,2': m('MacBook Pro', 'A2485', 2021, 16, true),
  'MacBookPro18,3': m('MacBook Pro', 'A2442', 2021, 14, true),
  'MacBookPro18,4': m('MacBook Pro', 'A2442', 2021, 14, true),
  'Mac14,7': m('MacBook Pro', 'A2338', 2022, 13.3, true, true),
  'Mac14,5': m('MacBook Pro', 'A2779', 2023, 14, true),
  'Mac14,9': m('MacBook Pro', 'A2779', 2023, 14, true),
  'Mac14,6': m('MacBook Pro', 'A2780', 2023, 16, true),
  'Mac14,10': m('MacBook Pro', 'A2780', 2023, 16, true),
  'Mac15,3': m('MacBook Pro', 'A2918', 2023, 14, true),
  'Mac15,6': m('MacBook Pro', 'A2992', 2023, 14, true),
  'Mac15,8': m('MacBook Pro', 'A2992', 2023, 14, true),
  'Mac15,10': m('MacBook Pro', 'A2992', 2023, 14, true),
  'Mac15,7': m('MacBook Pro', 'A2991', 2023, 16, true),
  'Mac15,9': m('MacBook Pro', 'A2991', 2023, 16, true),
  'Mac15,11': m('MacBook Pro', 'A2991', 2023, 16, true),

  // ---- iMac / Mac mini (desktops) ----
  'iMac18,1': m('iMac', 'A1418', 2017, 21.5),
  'iMac18,2': m('iMac', 'A1418', 2017, 21.5),
  'iMac18,3': m('iMac', 'A1419', 2017, 27),
  'iMac19,1': m('iMac', 'A2115', 2019, 27),
  'iMac19,2': m('iMac', 'A2116', 2019, 21.5),
  'iMac20,1': m('iMac', 'A2115', 2020, 27),
  'iMac20,2': m('iMac', 'A2115', 2020, 27),
  'iMac21,1': m('iMac', 'A2438', 2021, 24),
  'iMac21,2': m('iMac', 'A2439', 2021, 24),
  'Macmini7,1': m('Mac mini', 'A1347', 2014),
  'Macmini8,1': m('Mac mini', 'A1993', 2018),
  'Macmini9,1': m('Mac mini', 'A2348', 2020),
  'Mac14,3': m('Mac mini', 'A2686', 2023),
  'Mac14,12': m('Mac mini', 'A2816', 2023),
}

export function macModel(identifier: string | undefined | null): MacModel | null {
  return (identifier && MAC_MODELS[identifier.trim()]) || null
}

/** The 4-digit A-number in a model name: "Macbook Pro 2485" and "MacBook Air A2337" both work. */
export function aNumber(model: string | undefined | null): string | null {
  const hit = String(model || '').match(/\bA?([123]\d{3})\b/i)
  return hit ? hit[1] : null
}

/** macOS major version -> name, for the OS field ("macOS Sonoma 14.5"). */
export const MACOS_NAMES: Record<number, string> = {
  11: 'Big Sur', 12: 'Monterey', 13: 'Ventura', 14: 'Sonoma', 15: 'Sequoia', 26: 'Tahoe',
}
