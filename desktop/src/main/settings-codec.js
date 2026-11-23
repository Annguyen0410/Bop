'use strict';

/**
 * The on-disk shape of Bop's settings stores.
 *
 * Three rules, in order of how much they matter:
 *
 * 1. **A release build never writes plaintext settings.** The verification harness asked for raw JSON so
 *    it could read the file back from outside the app; that request is refused outright when `packaged`
 *    is true, whatever the caller passes. Measured before this module: `--bop-live-check` switched the
 *    settings store to plaintext and the flag worked in packaged builds.
 * 2. When the OS offers a key, the store is sealed with it (`safeStorage` on Windows and macOS).
 * 3. When it does not, the store is written with a `BOP0` label and the app tells the user their settings
 *    are unencrypted. Refusing to save at all would lose someone's spaces on a machine with no keyring;
 *    the documented choice is to say so instead of pretending.
 */

const PLAINTEXT_MAGIC = 'BOP0';

/**
 * Serialises and seals one store, or returns null instead of allocating past `limit` bytes.
 *
 * `encrypt` is the sealing function (or null when the OS offers no key). `plaintext` writes raw JSON for
 * a development harness and is ignored when `packaged` is true.
 */
function encodeSettings(value, { limit, encrypt = null, plaintext = false, packaged = false } = {}) {
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > limit) return null;
  if (plaintext === true && packaged !== true) return { payload: Buffer.from(json, 'utf8'), bytes, sealed: false };
  if (encrypt) return { payload: encrypt(json), bytes, sealed: true };
  return {
    payload: Buffer.concat([Buffer.from(PLAINTEXT_MAGIC, 'utf8'), Buffer.from(json, 'utf8')]),
    bytes,
    sealed: false,
  };
}

/**
 * Reads a store back. Returns null when the file cannot be read with the rules the build is allowed to
 * use: a release build never reads raw JSON either, so a plaintext file is only ever read by the harness
 * that asked for it.
 */
function decodeSettings(raw, { decrypt = null, plaintext = false, packaged = false } = {}) {
  if (raw.slice(0, 4).toString('utf8') === PLAINTEXT_MAGIC) return raw.slice(4).toString('utf8');
  if (plaintext === true && packaged !== true) return raw.toString('utf8');
  return decrypt ? decrypt(raw) : null;
}

module.exports = { encodeSettings, decodeSettings, PLAINTEXT_MAGIC };
