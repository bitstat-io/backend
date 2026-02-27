import crypto from 'crypto';

import { env } from '../../config/env';

const PREFIX_LENGTH = 8;

const encryptionKey = env.API_KEY_ENCRYPTION_SECRET
  ? crypto.createHash('sha256').update(env.API_KEY_ENCRYPTION_SECRET).digest()
  : null;

export function generateApiKey() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashApiKey(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function keyPrefix(raw: string) {
  return raw.slice(0, PREFIX_LENGTH);
}

export function encryptApiKey(raw: string) {
  if (!encryptionKey) throw new Error('ENCRYPTION_SECRET_MISSING');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptApiKey(encoded: string) {
  if (!encryptionKey) throw new Error('ENCRYPTION_SECRET_MISSING');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length < 28) throw new Error('INVALID_CIPHERTEXT');
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
