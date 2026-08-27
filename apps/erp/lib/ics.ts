// Minimal hand-rolled RFC 5545 (iCalendar) builder -- no dependency needed for
// the handful of fields (SUMMARY/DESCRIPTION/DTSTART/VALARM) an Activity Hub
// task needs to show up correctly in Google Calendar/Outlook/Apple Calendar.

export function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// UTC, "basic" ICS format: YYYYMMDDTHHMMSSZ
export function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

export function buildVEvent({
  uid, title, description, start, reminderMinutesBefore, stamp,
}: {
  uid: string
  title: string
  description?: string | null
  start: Date
  reminderMinutesBefore?: number | null
  stamp?: Date
}): string {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatICSDate(stamp || new Date())}`,
    `DTSTART:${formatICSDate(start)}`,
    `SUMMARY:${escapeICSText(title)}`,
  ]
  if (description) lines.push(`DESCRIPTION:${escapeICSText(description)}`)
  if (typeof reminderMinutesBefore === 'number' && reminderMinutesBefore >= 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeICSText(title)}`,
      `TRIGGER:-PT${reminderMinutesBefore}M`,
      'END:VALARM'
    )
  }
  lines.push('END:VEVENT')
  return lines.join('\r\n')
}

export function buildVCalendar(events: string[], calName?: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//db_erp//Activity Hub//EN',
    'CALSCALE:GREGORIAN',
  ]
  if (calName) lines.push(`X-WR-CALNAME:${escapeICSText(calName)}`)
  lines.push(...events, 'END:VCALENDAR')
  return lines.join('\r\n')
}
