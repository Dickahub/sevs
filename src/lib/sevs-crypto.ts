// Shared cryptographic helpers for SEVS.
//
// These are pure functions that never read secrets from the environment — the
// caller (a server-function handler) reads `process.env.SEVS_SERVER_SECRET` and
// passes it in. They use Node's `crypto` for hashing/HMAC and WebCrypto
// (`crypto.subtle`) for RSA/AES so they run on the Cloudflare Worker runtime.

import { createHash, createHmac, randomBytes } from "crypto";

export const GENESIS = "0".repeat(64);

const enc = new TextEncoder();
const dec = new TextDecoder();

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

// --- audit hash chain --------------------------------------------------------

// Canonical content hash for an audit entry. `details` is part of the hashed
// content so the chain commits to the full record.
export function auditHash(
  prevHash: string,
  ts: string,
  actor: string,
  action: string,
  electionId: string | null,
  details: string,
): string {
  return sha256Hex(`${prevHash}|${ts}|${actor}|${action}|${electionId ?? ""}|${details ?? ""}`);
}

// --- ballot session token (HMAC, time-limited) -------------------------------

// Issued when a ballot is delivered. Bound to the election + voter and stamped
// with the delivery time so the server can enforce the 20-minute window.
export function issueBallotSession(electionId: string, voterId: string, secret: string): string {
  const issuedAt = Date.now();
  const sig = createHmac("sha256", secret)
    .update(`${electionId}.${voterId}.${issuedAt}`)
    .digest("base64url");
  return `${issuedAt}.${sig}`;
}

export function verifyBallotSession(
  token: string,
  electionId: string,
  voterId: string,
  secret: string,
  maxAgeMs: number,
): { ok: true } | { ok: false; reason: "invalid" | "expired" } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const issuedAt = Number(parts[0]);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return { ok: false, reason: "invalid" };
  const expected = createHmac("sha256", secret)
    .update(`${electionId}.${voterId}.${issuedAt}`)
    .digest("base64url");
  if (parts[1] !== expected) return { ok: false, reason: "invalid" };
  if (Date.now() - issuedAt > maxAgeMs) return { ok: false, reason: "expired" };
  return { ok: true };
}

// --- base64 / PEM helpers ----------------------------------------------------

function bufToB64(buf: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(buf)).toString("base64");
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function toPem(label: string, buf: ArrayBuffer): string {
  const b64 = bufToB64(buf).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return b64ToBytes(body);
}

// --- private-key wrapping (PBKDF2 + AES-GCM) ---------------------------------

interface KeyEnvelope {
  v: number;
  kdf: string;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

async function deriveWrapKey(secret: string, salt: Uint8Array, usages: KeyUsage[]) {
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function wrapPkcs8(pkcs8: ArrayBuffer, secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveWrapKey(secret, salt, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, pkcs8);
  const envelope: KeyEnvelope = {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 150000,
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    ciphertext: bufToB64(ct),
  };
  return JSON.stringify(envelope);
}

async function unwrapPkcs8(envelopeJson: string, secret: string): Promise<ArrayBuffer> {
  const envelope = JSON.parse(envelopeJson) as KeyEnvelope;
  const salt = b64ToBytes(envelope.salt);
  const iv = b64ToBytes(envelope.iv);
  const aesKey = await deriveWrapKey(secret, salt, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, b64ToBytes(envelope.ciphertext));
}

// --- election encryption keys (RSA-OAEP) -------------------------------------

// Generate a per-election RSA-2048 key pair. The private key is wrapped with the
// one-time passphrase (which is shown once and never stored).
export async function generateElectionKeys(passphrase: string) {
  const kp = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  return {
    publicKeyPem: toPem("PUBLIC KEY", spki),
    encryptedPrivateKey: await wrapPkcs8(pkcs8, passphrase),
  };
}

async function importEncryptPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    pemToBytes(pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

export async function importElectionPrivateKey(
  envelopeJson: string,
  passphrase: string,
): Promise<CryptoKey> {
  const pkcs8 = await unwrapPkcs8(envelopeJson, passphrase);
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

// --- hybrid ballot encryption ------------------------------------------------

export interface EncryptedBallot {
  ciphertext: string;
  iv: string;
  encryptedKey: string;
}

// Encrypt plaintext with a fresh AES-256-GCM session key, then encrypt that
// session key with the election RSA public key (hybrid encryption).
export async function encryptBallot(publicKeyPem: string, plaintext: string): Promise<EncryptedBallot> {
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(plaintext));
  const rawAes = await crypto.subtle.exportKey("raw", aesKey);
  const pub = await importEncryptPublicKey(publicKeyPem);
  const encKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, rawAes);
  return { ciphertext: bufToB64(ct), iv: bufToB64(iv.buffer), encryptedKey: bufToB64(encKey) };
}

export async function decryptBallot(
  privateKey: CryptoKey,
  ballot: { ciphertext: string; iv: string; encryptedKey: string },
): Promise<string> {
  const rawAes = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    b64ToBytes(ballot.encryptedKey),
  );
  const aesKey = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(ballot.iv) },
    aesKey,
    b64ToBytes(ballot.ciphertext),
  );
  return dec.decode(pt);
}

// --- system signing key (RSASSA-PKCS1-v1_5, SHA-256) -------------------------

// App-wide signing key used to sign ballot hashes and exported reports. The
// private key is wrapped with the server secret; the public key is published so
// recipients can verify authenticity.
export async function generateSigningKey(secret: string) {
  const kp = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  return {
    publicKeyPem: toPem("PUBLIC KEY", spki),
    wrappedPrivateKey: await wrapPkcs8(pkcs8, secret),
  };
}

export async function importSigningPrivateKey(
  envelopeJson: string,
  secret: string,
): Promise<CryptoKey> {
  const pkcs8 = await unwrapPkcs8(envelopeJson, secret);
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function importSigningPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    pemToBytes(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function signMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, enc.encode(message));
  return bufToB64(sig);
}

export async function verifyMessage(
  publicKeyPem: string,
  message: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const pub = await importSigningPublicKey(publicKeyPem);
    return await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      pub,
      b64ToBytes(signatureB64),
      enc.encode(message),
    );
  } catch {
    return false;
  }
}
