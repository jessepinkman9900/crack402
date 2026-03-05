/**
 * SSH Key Generation Service
 * Generates Ed25519 SSH key pairs for EC2 instance access
 */

import { generateKeyPairSync } from 'crypto';
import { createHash } from 'crypto';

export interface SSHKeyPair {
  publicKey: string;   // OpenSSH format (ssh-ed25519 AAAA...)
  privateKey: string;  // PEM format (PKCS8)
  fingerprint: string; // SHA256 fingerprint (SHA256:...)
}

/**
 * Generate an Ed25519 SSH key pair
 * Ed25519 is modern, fast, and secure (preferred over RSA)
 */
export function generateSSHKeyPair(keyName: string): SSHKeyPair {
  // Generate Ed25519 key pair
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // Convert PEM public key to OpenSSH format
  const openSSHPublicKey = convertToOpenSSHFormat(publicKey, keyName);

  // Calculate SHA256 fingerprint
  const fingerprint = calculateFingerprint(publicKey);

  return {
    publicKey: openSSHPublicKey,
    privateKey,
    fingerprint
  };
}

/**
 * Convert PEM public key to OpenSSH format
 * Format: ssh-ed25519 AAAAC3Nza... user@hostname
 */
function convertToOpenSSHFormat(pemPublicKey: string, keyName: string): string {
  // Remove PEM headers and decode base64
  const base64Content = pemPublicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');

  const publicKeyBuffer = Buffer.from(base64Content, 'base64');

  // Ed25519 public key is the last 32 bytes of the SPKI structure
  // SPKI structure for Ed25519: 44 bytes total, last 32 bytes are the key
  const ed25519KeyData = publicKeyBuffer.slice(-32);

  // Build OpenSSH wire format
  // Format: [string "ssh-ed25519"][string ed25519_key_data]
  const algorithmName = 'ssh-ed25519';
  const algorithmBuffer = Buffer.from(algorithmName, 'utf8');

  // Create wire format: 4-byte length + data for each string
  const wireFormat = Buffer.concat([
    createLengthPrefixedBuffer(algorithmBuffer),
    createLengthPrefixedBuffer(ed25519KeyData)
  ]);

  // Base64 encode and format as OpenSSH public key
  const base64Key = wireFormat.toString('base64');
  return `${algorithmName} ${base64Key} ${keyName}`;
}

/**
 * Create a length-prefixed buffer (4-byte big-endian length + data)
 */
function createLengthPrefixedBuffer(data: Buffer): Buffer {
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  return Buffer.concat([lengthBuffer, data]);
}

/**
 * Calculate SHA256 fingerprint for public key
 * Format: SHA256:base64hash
 */
function calculateFingerprint(pemPublicKey: string): string {
  // Remove PEM headers and decode base64
  const base64Content = pemPublicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');

  const publicKeyBuffer = Buffer.from(base64Content, 'base64');

  // Extract Ed25519 key data (last 32 bytes)
  const ed25519KeyData = publicKeyBuffer.slice(-32);

  // Build OpenSSH wire format for fingerprinting
  const algorithmName = 'ssh-ed25519';
  const algorithmBuffer = Buffer.from(algorithmName, 'utf8');

  const wireFormat = Buffer.concat([
    createLengthPrefixedBuffer(algorithmBuffer),
    createLengthPrefixedBuffer(ed25519KeyData)
  ]);

  // Calculate SHA256 hash
  const hash = createHash('sha256').update(wireFormat).digest('base64');

  // Remove padding and format
  return `SHA256:${hash.replace(/=+$/, '')}`;
}

/**
 * Convert OpenSSH private key to PEM format for downloading
 * Adds OpenSSH private key header/footer for compatibility
 */
export function formatPrivateKeyForDownload(pemPrivateKey: string): string {
  // The key is already in PEM format (PKCS8)
  // For better compatibility with OpenSSH, we keep it as-is
  // Modern OpenSSH (7.8+) can read PKCS8 format directly
  return pemPrivateKey;
}

/**
 * Generate a unique filename for private key download
 */
export function generatePrivateKeyFilename(keyName: string): string {
  const safeName = keyName.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
  return `zeroclaw_${safeName}_id_ed25519`;
}
