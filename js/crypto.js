// Client-side encryption. Your passphrase never leaves the device and is never stored.
// Key derivation: PBKDF2-SHA256 (600k iterations) -> AES-GCM 256-bit key (non-extractable).

const ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Returns a plain object safe to store/export: nothing in it is readable without the passphrase.
export async function encryptJSON(key, salt, iterations, data) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

// Throws if the passphrase is wrong or the data was tampered with (AES-GCM authenticates).
export async function decryptJSON(key, blob) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.data));
  return JSON.parse(dec.decode(pt));
}

export function saltOf(blob) {
  return unb64(blob.salt);
}

export { ITERATIONS };
