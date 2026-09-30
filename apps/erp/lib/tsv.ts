// Tab-separated helpers for clipboard interop with Excel/Numbers/Google Sheets/
// LibreOffice Calc -- all of them read and write plain TSV on the system
// clipboard for a simple (unmerged, no embedded-newline) cell range, which is
// exactly what "select cells, Ctrl+C" / "click a cell, Ctrl+V" produces and
// expects. No CSV-style quoting is implemented -- a cell containing a literal
// tab or newline is sanitized to a space instead, since real task text never
// needs that and it keeps parsing trivial and robust.

export function sanitizeTsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

export function buildTsvTable(rows: string[][]): string {
  return rows.map(row => row.map(sanitizeTsvCell).join('\t')).join('\r\n');
}

// Splits pasted clipboard text into rows/cells. Handles \r\n, \r, and \n line
// endings (different spreadsheet apps/OSes vary) and trims a trailing blank
// row that a copy often includes.
export function parseTsvText(text: string): string[][] {
  const rows = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.split('\t'));
  while (rows.length > 0 && rows[rows.length - 1].every(cell => cell.trim() === '')) rows.pop();
  return rows;
}
