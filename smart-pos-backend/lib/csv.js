/**
 * Shared CSV parsing and emission.
 *
 * Extracted so the product and inventory importers read files identically —
 * two hand-rolled parsers would drift, and the quoting rules are exactly the
 * kind of thing that gets subtly wrong in the second copy.
 */

/**
 * Minimal RFC4180-ish parser: quoted fields, escaped quotes ("" inside a
 * quoted field), embedded commas and newlines, and CRLF or LF line endings.
 * Small enough to own outright rather than take a dependency for one feature.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const src = String(text ?? '').replace(/^﻿/, ''); // strip BOM from Excel exports

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  // Trailing field/row when the file doesn't end in a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop blank lines — trailing newlines are near-universal in exported files.
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/**
 * Parse into per-row records keyed by lowercased header, validating that the
 * required columns are present. Each record carries __line: the spreadsheet
 * row number, so a reported error matches what the user sees in Excel.
 */
function toRecords(text, requiredHeaders = []) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    const err = new Error('The file is empty');
    err.status = 400;
    throw err;
  }

  const headers = rows[0].map((h) => String(h).trim());
  const normalised = headers.map((h) => h.toLowerCase());

  const missing = requiredHeaders.filter((h) => !normalised.includes(h));
  if (missing.length) {
    const err = new Error(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
      `Found: ${headers.join(', ') || '(none)'}`
    );
    err.status = 400;
    throw err;
  }

  return rows.slice(1).map((cells, index) => {
    const record = {};
    normalised.forEach((header, i) => {
      record[header] = cells[i] === undefined ? '' : String(cells[i]).trim();
    });
    // +2: one for the header row, one to make it 1-based like a spreadsheet.
    record.__line = index + 2;
    return record;
  });
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

module.exports = { parseCsv, toRecords, csvCell, toCsv };
