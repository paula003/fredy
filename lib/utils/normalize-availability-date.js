/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Sentinel timestamp used by some providers (e.g. HousingAnywhere's Algolia
// index) to mean "no concrete date / flexible": 0001-01-01T00:00:00Z in unix
// seconds. Anything mapping to year 0001 or 9999 is likewise treated as unknown.
const SENTINEL_SECONDS = -62135596800;

/**
 * Format a Date into an ISO 'YYYY-MM-DD' string using its UTC components, or
 * return null for an invalid date. UTC is used so the result does not drift
 * across timezones for a date-only value.
 *
 * @param {Date} date
 * @returns {string|null}
 */
const toIsoDate = (date) => {
  if (isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year <= 1 || year >= 9999) return null;
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Normalize a provider's raw availability value into an ISO 'YYYY-MM-DD' date
 * string, or null when no concrete date is known.
 *
 * Handles, in order:
 * - null/undefined/empty -> null
 * - unix-seconds timestamps (numbers or all-digit strings); the sentinel
 *   -62135596800 and implausible years -> null
 * - ISO datetime strings ('YYYY-MM-DD...'); sentinel years 0001/9999 -> null
 * - German 'DD.MM.YYYY' / 'D.M.YY' dates, also when embedded in free text
 *   (e.g. 'frei ab 01.06.2026'); 2-digit years are expanded
 * - 'sofort' / 'ab sofort' / 'sofort verfügbar' -> today (`now`)
 * - 'nach Vereinbarung' / 'auf Anfrage' / 'flexibel' -> null
 *
 * @param {string|number|null|undefined} input The raw availability value.
 * @param {Date} [now=new Date()] Injectable clock for deterministic tests.
 * @returns {string|null} ISO 'YYYY-MM-DD' or null.
 */
export const normalizeAvailabilityDate = (input, now = new Date()) => {
  if (input == null) return null;

  // Numbers (or all-digit strings) are unix-seconds timestamps.
  if (typeof input === 'number' || (typeof input === 'string' && /^-?\d+$/.test(input.trim()))) {
    const seconds = Number(input);
    if (!Number.isFinite(seconds) || seconds === SENTINEL_SECONDS) return null;
    return toIsoDate(new Date(seconds * 1000));
  }

  if (typeof input !== 'string') return null;

  const value = input.trim();
  if (value === '') return null;
  const lower = value.toLowerCase();

  // "available immediately" maps to today.
  if (lower.includes('sofort')) return toIsoDate(now);

  // "by arrangement" / "on request" / "flexible" carry no concrete date.
  if (
    lower.includes('nach vereinbarung') ||
    lower.includes('auf anfrage') ||
    lower.includes('auf nachfrage') ||
    lower.includes('flexib')
  ) {
    return null;
  }

  // ISO 'YYYY-MM-DD' (optionally followed by a time component).
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, year, month, day] = iso;
    if (year === '0001' || year === '9999') return null;
    return toIsoDate(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
  }

  // German 'DD.MM.YYYY' / 'D.M.YY', possibly embedded in free text.
  const german = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (german) {
    const day = Number(german[1]);
    const month = Number(german[2]);
    let year = Number(german[3]);
    if (german[3].length === 2) year = year < 70 ? 2000 + year : 1900 + year;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return toIsoDate(new Date(Date.UTC(year, month - 1, day)));
  }

  return null;
};

/**
 * Return the first of several raw availability candidates that normalizes to a
 * concrete date. Useful for providers that expose multiple candidate fields,
 * some of which carry "present but meaningless" sentinel values (e.g.
 * HousingAnywhere's '0001-01-01' booking-window start) that must be skipped
 * rather than coalesced over with `??`.
 *
 * @param {Array<string|number|null|undefined>} candidates Raw values, in priority order.
 * @param {Date} [now=new Date()] Injectable clock for deterministic tests.
 * @returns {string|null} ISO 'YYYY-MM-DD' of the first usable candidate, or null.
 */
export const firstAvailabilityDate = (candidates, now = new Date()) => {
  for (const candidate of candidates || []) {
    const normalized = normalizeAvailabilityDate(candidate, now);
    if (normalized != null) return normalized;
  }
  return null;
};
