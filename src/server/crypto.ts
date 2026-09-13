import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const DEV_SECRET = "dev-secret-change-me";
const MIN_SECRET_LENGTH = 16;

function resolveSecret(): string {
  const configured = process.env.APP_SECRET;
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      configured
        ? `APP_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -hex 32`
        : "APP_SECRET is not set. Refusing to start in production with the development secret. Generate one with: openssl rand -hex 32"
    );
  }

  if (configured) return configured;
  console.warn("APP_SECRET is not set; using the development secret. Set APP_SECRET before using this outside local testing.");
  return DEV_SECRET;
}

const SECRET = resolveSecret();

function keyFromSecret(): Buffer {
  return createHash("sha256").update(SECRET).digest();
}

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export function randomPassword(): string {
  return randomBytes(18).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = encoded.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function encryptText(text: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(), nonce);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${nonce.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptText(payload: string): string {
  const [nonceHex, tagHex, encryptedHex] = payload.split(":");
  if (!nonceHex || !tagHex || !encryptedHex) {
    throw new Error("Invalid encrypted payload");
  }

  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(), Buffer.from(nonceHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}

export function stableHashHex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
