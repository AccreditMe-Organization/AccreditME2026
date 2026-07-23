// Shared AES-256-GCM encrypt/decrypt for tenant provider config (auth/storage/AI).
// Extracted so any provider implementation (e.g. AnthropicAiProvider) can decrypt
// a tenant's own config at call time without depending on TenantService directly —
// avoids a circular dependency back into TenantModule's own provider registrations.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;

export function getEncryptionKey(): Buffer {
  const key = Buffer.from(process.env['ENCRYPTION_KEY'] ?? '', 'hex');
  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars). ' +
        'Generate with: openssl rand -hex 32',
    );
  }
  return key;
}

export function encryptTenantConfig(
  data: Record<string, unknown>,
  encryptionKey: Buffer,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, encryptionKey, iv);
  const text = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptTenantConfig(
  encrypted: string,
  encryptionKey: Buffer,
): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted config format');
  const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(CIPHER, encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}
