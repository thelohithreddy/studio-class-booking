// tests/unit/csv.test.ts
//
// The CSV serializer, verified two ways: the exact serialized bytes (so quoting
// and CRLF are pinned) AND a ROUND TRIP through a real parser (csv-parse) that
// must reconstruct every intended cell — the check that catches column shifts,
// quote bugs and newline bugs a string-equality test would miss.
import { parse } from 'csv-parse/sync'
import { describe, expect, it } from 'vitest'

import { encodeCell, neutralizeFormula, quoteField, toCsv } from '@/server/reporting/csv'

/** Parse serializer output (no BOM at this layer) back into rows. */
function roundTrip(csv: string): string[][] {
  return parse(csv, { relaxColumnCount: false }) as string[][]
}

describe('encodeCell — RFC 4180 quoting', () => {
  it('leaves a plain value untouched', () => {
    expect(encodeCell('Ada Lovelace')).toBe('Ada Lovelace')
  })
  it('quotes a comma', () => {
    expect(encodeCell('Smith, John')).toBe('"Smith, John"')
  })
  it('doubles and quotes an embedded quote', () => {
    expect(encodeCell('John "JD" Smith')).toBe('"John ""JD"" Smith"')
  })
  it('quotes LF, CRLF and lone CR', () => {
    expect(encodeCell('a\nb')).toBe('"a\nb"')
    expect(encodeCell('a\r\nb')).toBe('"a\r\nb"')
    expect(encodeCell('a\rb')).toBe('"a\rb"')
  })
  it('quotes leading/trailing whitespace so it cannot be trimmed', () => {
    expect(encodeCell('  padded  ')).toBe('"  padded  "')
    expect(encodeCell('trailing ')).toBe('"trailing "')
  })
  it('passes an empty string through as an empty field', () => {
    expect(encodeCell('')).toBe('')
  })
  it('passes a backslash through unchanged (not a CSV metacharacter)', () => {
    expect(encodeCell('a\\b')).toBe('a\\b')
  })
  it('a lone double-quote becomes a quoted, doubled quote', () => {
    expect(encodeCell('"')).toBe('""""')
  })
})

describe('neutralizeFormula — CSV injection guard', () => {
  it('prefixes a leading formula trigger with an apostrophe', () => {
    for (const v of ['=1+1', '+1', '-10+20', '@SUM(A1)']) {
      expect(neutralizeFormula(v)).toBe(`'${v}`)
    }
  })
  it('catches a trigger hidden behind leading spaces/tabs (Excel trims them)', () => {
    expect(neutralizeFormula(' =1+1')).toBe("' =1+1")
    expect(neutralizeFormula('\t=cmd')).toBe("'\t=cmd")
  })
  it('catches a leading control char', () => {
    expect(neutralizeFormula('\r=x')).toBe("'\r=x")
  })
  it('catches a trigger behind NON-ASCII whitespace that LibreOffice/Sheets trim', () => {
    // NBSP, vertical tab, form feed, and an ASCII space then CR — all trimmed
    // before formula detection by some spreadsheets, so all must be neutralized.
    expect(neutralizeFormula('\u00A0=cmd')).toBe("'\u00A0=cmd") // NBSP
    expect(neutralizeFormula('\u000B=cmd')).toBe("'\u000B=cmd") // vertical tab
    expect(neutralizeFormula('\u000C=cmd')).toBe("'\u000C=cmd") // form feed
    expect(neutralizeFormula(' \r=cmd')).toBe("' \r=cmd") // space + CR
  })
  it('does NOT touch a trigger that is only mid-string', () => {
    expect(neutralizeFormula('foo=bar')).toBe('foo=bar')
    expect(neutralizeFormula('a-b')).toBe('a-b')
  })
  it('does not touch a plain value', () => {
    expect(neutralizeFormula('Ada')).toBe('Ada')
  })
})

describe('toCsv — structure and round-trip', () => {
  const header = ['Member Name', 'Member Email', 'Status'] as const

  it('emits the deterministic header in order, CRLF-terminated', () => {
    const csv = toCsv(header, [])
    expect(csv).toBe('Member Name,Member Email,Status\r\n')
  })

  it('uses CRLF between records and a trailing CRLF (no phantom row)', () => {
    const csv = toCsv(header, [
      ['Ada', 'ada@x.test', 'ATTENDED'],
      ['Grace', 'grace@x.test', 'NO_SHOW'],
    ])
    expect(csv.endsWith('\r\n')).toBe(true)
    const rows = roundTrip(csv)
    expect(rows).toHaveLength(3) // header + 2 data rows, no empty trailing record
    expect(rows[0]).toEqual(['Member Name', 'Member Email', 'Status'])
    expect(rows[1]).toEqual(['Ada', 'ada@x.test', 'ATTENDED'])
  })

  it('round-trips values with comma, quote, newline and CRLF intact', () => {
    const tricky = [
      ['Smith, John', 'a@x.test', 'BOOKED'],
      ['John "JD" Smith', 'b@x.test', 'WAITLISTED'],
      ['line1\nline2', 'c@x.test', 'CANCELLED'],
      ['cr\r\nlf', 'd@x.test', 'ATTENDED'],
      ['  spaced  ', 'e@x.test', 'NO_SHOW'],
      ['', 'f@x.test', 'BOOKED'], // empty name
    ]
    const rows = roundTrip(toCsv(header, tricky))
    expect(rows.slice(1)).toEqual(tricky) // every cell reconstructed exactly
  })

  it('preserves Unicode (Telugu, Hindi, accented Latin, emoji)', () => {
    const unicode = [
      ['లోహిత్ రెడ్డి', 'te@x.test', 'ATTENDED'], // Telugu
      ['नमस्ते जी', 'hi@x.test', 'BOOKED'], // Hindi
      ['José Peña', 'es@x.test', 'NO_SHOW'], // accented Latin
      ['Ada 🎧🔥', 'em@x.test', 'WAITLISTED'], // emoji (surrogate pairs)
    ]
    const rows = roundTrip(toCsv(header, unicode))
    expect(rows.slice(1)).toEqual(unicode)
  })

  it('neutralizes formula injection end to end, and still round-trips as text', () => {
    const hostile = [
      ['=HYPERLINK("http://evil","x")', 'a@x.test', 'BOOKED'],
      ['@SUM(1+1)*cmd', 'b@x.test', 'ATTENDED'],
      ['=1+1,2', 'c@x.test', 'NO_SHOW'], // trigger AND a comma → quoted too
    ]
    const csv = toCsv(header, hostile)
    // No data cell begins with a bare formula trigger.
    for (const line of csv.split('\r\n').slice(1).filter(Boolean)) {
      expect(/^(=|\+|-|@)/.test(line)).toBe(false)
    }
    const rows = roundTrip(csv)
    expect(rows[1]![0]).toBe('\'=HYPERLINK("http://evil","x")')
    expect(rows[2]![0]).toBe("'@SUM(1+1)*cmd")
    expect(rows[3]![0]).toBe("'=1+1,2") // the comma-bearing one reconstructs cleanly
  })
})

describe('quoteField unit rule', () => {
  it('does not quote an interior space', () => {
    expect(quoteField('Member Name')).toBe('Member Name')
  })
})
