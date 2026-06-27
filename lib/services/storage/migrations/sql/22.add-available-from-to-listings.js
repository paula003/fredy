/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Stores a listing's move-in / availability date as ISO 'YYYY-MM-DD' TEXT.
// TEXT/ISO is chosen on purpose: it is the same representation used in memory
// and in JS, sorts lexicographically the same way it compares chronologically
// (zero-padded ISO dates), and avoids any timezone handling for a date-only
// value. Existing rows default to NULL (treated as "unknown" → kept by filters).
export function up(db) {
  db.exec(`
    ALTER TABLE listings ADD COLUMN available_from TEXT;
  `);
}
