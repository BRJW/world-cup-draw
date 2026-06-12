import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)

// Short, human-friendly join code, e.g. "K7QM4P"
export function joinCode(len = 6) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Opaque id / secret token
export function id(len = 16) {
  return randomBytes(len).toString('hex');
}
