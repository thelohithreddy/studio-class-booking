// src/server/reporting/csv.ts
//
// A tiny, dependency-free RFC 4180 CSV serializer with an OWASP CSV-injection
// (formula-injection) guard. Deliberately internal: the whole export surface is
// one staff-only attendance file, so a heavyweight CSV library is not warranted;
// the round-trip tests parse the output with a real parser (csv-parse) as an
// independent oracle rather than trusting this code against itself.

// A cell is treated as a formula by spreadsheet apps when, after any leading
// whitespace the app trims before evaluating, it begins with one of = + - @.
// The trimmed run must be Unicode-aware: Excel trims ASCII space/tab, and
// LibreOffice Calc / Google Sheets also trim other whitespace (non-breaking
// space, vertical tab, form feed, an ASCII space then CR/LF). JS `\s` matches
// exactly that set — every ASCII AND Unicode whitespace character — so a trigger
// hidden behind any of them is caught. `foo=bar` (a trigger only mid-string) is
// NOT a formula.
const LEADING_WHITESPACE = /^\s+/
const FORMULA_TRIGGER = /^[=+\-@]/

/**
 * Neutralizes CSV/formula injection: prefixes a single apostrophe when the value
 * — ignoring any leading whitespace a spreadsheet would trim — begins with a
 * formula trigger, so the app treats the whole cell as text. This deliberately
 * alters a hostile leading value (e.g. a member literally named `=HYPERLINK(...)`
 * exports as `'=HYPERLINK(...)`), which is the point — the data is preserved as
 * text, the formula never executes. Round-trip tests assert the apostrophe form.
 */
export function neutralizeFormula(value: string): string {
  const trimmed = value.replace(LEADING_WHITESPACE, '')
  return FORMULA_TRIGGER.test(trimmed) ? `'${value}` : value
}

/**
 * RFC 4180 field quoting, applied AFTER formula neutralization: wrap in double
 * quotes and double any embedded quote when the field contains a comma, double
 * quote, CR or LF, or has leading/trailing whitespace (so no parser can trim it
 * away). Everything else is emitted verbatim.
 */
export function quoteField(value: string): string {
  const needsQuoting =
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\r') ||
    value.includes('\n') ||
    /^\s|\s$/.test(value)
  return needsQuoting ? `"${value.replace(/"/g, '""')}"` : value
}

/** One fully-encoded CSV cell: neutralize formula triggers, then RFC-quote. */
export function encodeCell(value: string): string {
  return quoteField(neutralizeFormula(value))
}

const CRLF = '\r\n'

/**
 * Serializes a header row plus data rows to an RFC 4180 CSV string: CRLF record
 * separators, a trailing CRLF, every cell through encodeCell. Returns the body
 * WITHOUT a byte-order mark — a caller that wants Excel's UTF-8 detection adds
 * the BOM at the response layer, keeping this function a pure, testable
 * string→string transform.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((cells) => cells.map(encodeCell).join(',')).join(CRLF) + CRLF
}
