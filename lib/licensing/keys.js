import 'server-only';

/**
 * lib/licensing/keys.js
 *
 * ── A genuine gap in the masterplan, flagged not guessed ──────────────────
 * ADMIN_PANEL_MASTERPLAN.md's background section says plainly that license
 * keys are, today, hand-inserted via SQL — that's exactly what this app
 * replaces — but nowhere does the masterplan (or LicenseService.cs's own
 * comment, or shell_REGISTRY_CONTRACT.md) specify a key *format*. The only
 * concrete example anywhere in this repo is the stripped test seed
 * `TEST-LIC-0001-VALID` (see supabase/provisioning/target_project_schema.sql's
 * own top comment) — not a generation algorithm, just one hand-picked
 * string. `licenses.license_key` is `text primary key` with no format
 * constraint in 0002's migration, so any unique, URL-safe string is
 * schema-valid.
 *
 * Chose: `LIC-XXXX-XXXX-XXXX`, four uppercase groups from a 32-symbol
 * alphabet that excludes visually-ambiguous characters (0/O, 1/I/L) —
 * a Crockford-Base32-style choice, since this key gets read aloud and
 * retyped by non-technical clients, not just pasted. ~20 bits of entropy
 * per group, ~60 bits total, comfortably collision-resistant for a
 * single-operator client base; createClientAction still handles a
 * primary-key conflict with a retry rather than assuming uniqueness.
 * This is a reversible decision, not a load-bearing one — revisit if it
 * ever needs to change, nothing downstream parses the key's structure.
 */

import { randomInt } from 'crypto';

const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const KEY_GROUP_LEN = 4;
const KEY_GROUP_COUNT = 3;

function randomGroup(length, alphabet) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/**
 * @returns {string} e.g. "LIC-7F3K-9QXZ-2MPD"
 */
export function generateLicenseKey() {
  const groups = Array.from({ length: KEY_GROUP_COUNT }, () =>
    randomGroup(KEY_GROUP_LEN, KEY_ALPHABET)
  );
  return `LIC-${groups.join('-')}`;
}

const PASSWORD_ALPHABET =
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
const PASSWORD_LENGTH = 20;

/**
 * A generated-for-you password, shown once — same spirit as a password
 * manager's own "we generated this" flow (per the masterplan's own
 * phrasing). Long enough that entropy matters more than memorability,
 * since this is meant to be copied once and stored by the client, not
 * typed by hand repeatedly.
 *
 * @returns {string}
 */
export function generatePassword() {
  return randomGroup(PASSWORD_LENGTH, PASSWORD_ALPHABET);
}
