/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { normalizeAvailabilityDate } from '../../lib/utils/normalize-availability-date.js';

// Fixed clock so 'sofort' style inputs are deterministic.
const NOW = new Date(Date.UTC(2026, 5, 27)); // 2026-06-27

describe('normalizeAvailabilityDate', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(normalizeAvailabilityDate(null)).toBe(null);
    expect(normalizeAvailabilityDate(undefined)).toBe(null);
    expect(normalizeAvailabilityDate('')).toBe(null);
    expect(normalizeAvailabilityDate('   ')).toBe(null);
  });

  it('parses unix-seconds timestamps (number and all-digit string)', () => {
    // 1788134400 = 2026-08-31T00:00:00Z
    expect(normalizeAvailabilityDate(1788134400)).toBe('2026-08-31');
    expect(normalizeAvailabilityDate('1788134400')).toBe('2026-08-31');
  });

  it('treats the sentinel timestamp and out-of-range years as unknown', () => {
    expect(normalizeAvailabilityDate(-62135596800)).toBe(null);
    expect(normalizeAvailabilityDate('-62135596800')).toBe(null);
  });

  it('parses ISO datetime strings down to the date', () => {
    expect(normalizeAvailabilityDate('2025-01-27T00:00:00.000Z')).toBe('2025-01-27');
    expect(normalizeAvailabilityDate('2026-09-01')).toBe('2026-09-01');
  });

  it('treats sentinel ISO years 0001/9999 as unknown', () => {
    expect(normalizeAvailabilityDate('0001-01-01T00:00:00Z')).toBe(null);
    expect(normalizeAvailabilityDate('9999-12-31')).toBe(null);
  });

  it('parses German DD.MM.YYYY and D.M.YY dates', () => {
    expect(normalizeAvailabilityDate('01.05.2026')).toBe('2026-05-01');
    expect(normalizeAvailabilityDate('1.6.26')).toBe('2026-06-01');
  });

  it('extracts a German date embedded in free text', () => {
    expect(normalizeAvailabilityDate('frei ab 01.06.2026')).toBe('2026-06-01');
    expect(normalizeAvailabilityDate('6 Zimmer · 155,7 m² · 965 m² Grundstück · frei ab 01.05.2026')).toBe(
      '2026-05-01',
    );
  });

  it('maps "sofort" style availability to the provided clock', () => {
    expect(normalizeAvailabilityDate('Sofort verfügbar', NOW)).toBe('2026-06-27');
    expect(normalizeAvailabilityDate('ab sofort', NOW)).toBe('2026-06-27');
  });

  it('maps "by arrangement" / "on request" / "flexible" to null', () => {
    expect(normalizeAvailabilityDate('nach Vereinbarung')).toBe(null);
    expect(normalizeAvailabilityDate('auf Anfrage')).toBe(null);
    expect(normalizeAvailabilityDate('flexibel')).toBe(null);
  });

  it('returns null for an invalid German date', () => {
    expect(normalizeAvailabilityDate('32.13.2026')).toBe(null);
  });
});
