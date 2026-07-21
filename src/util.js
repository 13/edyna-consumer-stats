/**
 * Pure helpers shared by scraper and db layers. No I/O — unit-testable.
 */

/**
 * Parse a portal number string (de-AT locale: "." thousands, "," decimal).
 * "1.234,56" -> 1234.56. Returns null for empty / "-" / "N/A" / garbage.
 */
export function normalizeNumber(str) {
  if (!str || str === '' || str === '-' || str === 'N/A') return null;
  const normalized = str
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const num = normalized ? parseFloat(normalized) : null;
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse a portal date cell into { year, month, day } (month 1-based).
 * Accepts "dd.mm.yyyy", "dd/mm/yyyy", "yyyy-mm-dd", and "dd.mm" / "dd/mm"
 * (year taken from fallbackYear). Returns null if unparseable.
 */
export function parseDayDate(dateStr, fallbackYear = null) {
  if (!dateStr) return null;
  const s = dateStr.trim();

  let m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) };

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };

  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.]?$/);
  if (m && fallbackYear) return { year: fallbackYear, month: Number(m[2]), day: Number(m[1]) };

  return null;
}

const HOUR_MS = 3_600_000;

/**
 * Timestamps for the hourly columns of one portal day.
 * Column h is treated as the h-th consecutive hour after local midnight,
 * not as wall-clock "h:00" — this keeps DST days correct: on the 25-hour
 * October day both occurrences of 02:00 get distinct timestamps, and on the
 * 23-hour March day no phantom 02:00 is produced.
 * Local midnight comes from the process TZ (config.js pins process.env.TZ).
 */
export function hourTimestamps({ year, month, day }, count) {
  const midnight = new Date(year, month - 1, day).getTime();
  return Array.from({ length: count }, (_, h) => new Date(midnight + h * HOUR_MS));
}
