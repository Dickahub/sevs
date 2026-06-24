// Server-only cryptography for SEVS.
//
// Implements REQ-VOTE-08 hybrid encryption (AES-256-GCM session key wrapped
// with the election's RSA-2048 public key) plus RSA-SHA256 ballot signatures
// and the server signing key used for tamper-evident report signatures.
//
// This file is *.server.ts and is stripped from client bundles.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Buffer.from(bytes).toString("base64");
}

function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function pemToDer(pem: string, label: string): Uint8Array {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s+/g, "");
  return fromB64(body);
}

function derToPem(buf: ArrayBuffer, label: string): string {
  const wrapped = b64(buf).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

// ---- Hybrid encryption ------------------------------------------------------

export interface EncryptedBallot {
  ciphertext: string; // AES-256-GCM ciphertext (base64)
  iv: string; // AES-GCM IV (base64)
  encryptedKey: string; // AES key wrapped with RSA-OAEP public key (base64)
}

async function importRsaPublic(publicPem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    pemToDer(publicPem, "PUBLIC KEY"),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

// Encrypt the plaintext ballot with a fresh AES-256 session key, then wrap that
// session key with the election's RSA public key (hybrid encryption).
export async function hybridEncrypt(plaintext: string, publicPem: string): Promise<EncryptedBallot> {
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(plaintext));
  const rawAes = await crypto.subtle.exportKey("raw", aesKey);
  const pub = await importRsaPublic(publicPem);
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, rawAes);
  return { ciphertext: b64(ct), iv: b64(iv), encryptedKey: b64(wrapped) };
}

// Recover the AES session key with the election private key, then decrypt the
// ballot content. Used only during tallying after the election closes.
export async function hybridDecrypt(record: EncryptedBallot, privateKey: CryptoKey): Promise<string> {
  const rawAes = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    fromB64(record.encryptedKey),
  );
  const aesKey = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(record.iv) },
    aesKey,
    fromB64(record.ciphertext),
  );
  return dec.decode(pt);
}

// Decrypt the election's encrypted private key envelope using the administrator
// passphrase (PBKDF2 + AES-GCM). Throws if the passphrase is wrong.
export async function unlockElectionPrivateKey(
  envelopeJson: string,
  passphrase: string,
): Promise<CryptoKey> {
  const env = JSON.parse(envelopeJson) as {
    iterations: number;
    salt: string;
    iv: string;
    ciphertext: string;
  };
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(env.salt), iterations: env.iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const pkcs8 = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(env.iv) },
    aesKey,
    fromB64(env.ciphertext),
  );
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

// ---- Signing (RSA-SHA256) ---------------------------------------------------

let cachedKeys: { publicPem: string; privatePem: string } | null = null;

// Fetch the singleton server signing key pair, generating it on first use.
export async function getSigningKeys(): Promise<{ publicPem: string; privatePem: string }> {
  if (cachedKeys) return cachedKeys;

  const { data: existing } = await supabaseAdmin
    .from("system_keys")
    .select("signing_public_key, signing_private_key")
    .eq("id", true)
    .maybeSingle();

  if (existing) {
    cachedKeys = { publicPem: existing.signing_public_key, privatePem: existing.signing_private_key };
    return cachedKeys;
  }

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
  const publicPem = derToPem(await crypto.subtle.exportKey("spki", kp.publicKey), "PUBLIC KEY");
  const privatePem = derToPem(await crypto.subtle.exportKey("pkcs8", kp.privateKey), "PRIVATE KEY");

  await supabaseAdmin
    .from("system_keys")
    .upsert({ id: true, signing_public_key: publicPem, signing_private_key: privatePem });

  cachedKeys = { publicPem, privatePem };
  return cachedKeys;
}

export async function signData(data: string): Promise<string> {
  const { privatePem } = await getSigningKeys();
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privatePem, "PRIVATE KEY"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, enc.encode(data));
  return b64(sig);
}

export async function verifyData(data: string, signatureB64: string): Promise<boolean> {
  const { publicPem } = await getSigningKeys();
  const key = await crypto.subtle.importKey(
    "spki",
    pemToDer(publicPem, "PUBLIC KEY"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  try {
    return await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      fromB64(signatureB64),
      enc.encode(data),
    );
  } catch {
    return false;
  }
}
