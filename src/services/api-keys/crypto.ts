import crypto from 'crypto';

const PREFIX_LENGTH = 8;

export function generateApiKey() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashApiKey(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function keyPrefix(raw: string) {
  return raw.slice(0, PREFIX_LENGTH);
}
