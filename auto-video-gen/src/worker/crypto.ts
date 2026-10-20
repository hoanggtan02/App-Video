// AES-256-GCM token encryption. Must stay byte-compatible with
// App-Video/supabase/functions/_shared/crypto.ts (the Edge Function encrypts, the worker decrypts).
// Format: "v1:" + base64(iv[12] | ciphertext).

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Buffer.from(keyB64, "base64");
  if (raw.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = Buffer.from(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `v1:${Buffer.concat([Buffer.from(iv), ct]).toString("base64")}`;
}

export async function decryptToken(enc: string, keyB64: string): Promise<string> {
  if (!enc.startsWith("v1:")) throw new Error("Unknown token format");
  const data = Buffer.from(enc.slice(3), "base64");
  const key = await importKey(keyB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(0, 12) }, key, data.subarray(12));
  return new TextDecoder().decode(plain);
}
