/**
 * Minimal RFC 4180 CSV reader/writer for the labelling sheet (quotes, doubled quotes, CRLF/LF, commas and newlines inside quotes).
 * The sheet is edited in a spreadsheet, so a real parser is needed; no dependency is added for roughly forty lines.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // spreadsheets add a BOM
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/** Header-keyed records from CSV text; missing trailing cells become empty strings. */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
