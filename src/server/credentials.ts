import { decryptText, encryptText, randomId, sha256 } from "./crypto.js";
import type { PillarRecord, SeedNodeRecord } from "../shared/types.js";

const ENROLLMENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECRET_DOWNLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;

export type NodeCredentialRecord = PillarRecord | SeedNodeRecord;

export function createStatusTokenFields(): { statusTokenHash: string; statusTokenCipher: string } {
  const token = randomId(32);
  return {
    statusTokenHash: sha256(token),
    statusTokenCipher: encryptText(token)
  };
}

export function createEnrollmentTokenFields(now = new Date()) {
  const token = randomId(32);
  return {
    enrollmentTokenHash: sha256(token),
    enrollmentTokenCipher: encryptText(token),
    enrollmentTokenExpiresAt: new Date(now.getTime() + ENROLLMENT_TOKEN_TTL_MS).toISOString(),
    enrollmentTokenUsedAt: undefined
  };
}

export function createNodeCredentialFields(now = new Date()) {
  return {
    ...createStatusTokenFields(),
    ...createEnrollmentTokenFields(now)
  };
}

export function ensureNodeCredentialFields(record: NodeCredentialRecord): void {
  if (!record.statusTokenHash || !record.statusTokenCipher) {
    Object.assign(record, createStatusTokenFields());
  }
  if (!record.enrollmentTokenUsedAt && (!record.enrollmentTokenHash || !record.enrollmentTokenCipher || !record.enrollmentTokenExpiresAt)) {
    Object.assign(record, createEnrollmentTokenFields());
  }
}

export function statusToken(record: Pick<NodeCredentialRecord, "statusTokenCipher">): string {
  return record.statusTokenCipher ? decryptText(record.statusTokenCipher) : "";
}

export function activeEnrollment(record: NodeCredentialRecord, now = new Date()): { token: string; expiresAt: string } | undefined {
  if (
    !record.enrollmentTokenHash ||
    !record.enrollmentTokenCipher ||
    !record.enrollmentTokenExpiresAt ||
    record.enrollmentTokenUsedAt ||
    new Date(record.enrollmentTokenExpiresAt) <= now
  ) {
    return undefined;
  }
  return {
    token: decryptText(record.enrollmentTokenCipher),
    expiresAt: record.enrollmentTokenExpiresAt
  };
}

export function activeEnrollmentMatches(record: NodeCredentialRecord, tokenHash: string, now = new Date()): boolean {
  return Boolean(
    record.enrollmentTokenHash === tokenHash &&
      !record.enrollmentTokenUsedAt &&
      record.enrollmentTokenExpiresAt &&
      new Date(record.enrollmentTokenExpiresAt) > now
  );
}

export function secretDownloadMatches(record: NodeCredentialRecord, tokenHash: string, now = new Date()): boolean {
  return Boolean(
    record.secretDownloadTokenHash === tokenHash &&
      record.secretDownloadTokenExpiresAt &&
      new Date(record.secretDownloadTokenExpiresAt) > now
  );
}

export function rotateNodeCredentials(record: NodeCredentialRecord): { token: string; expiresAt: string } {
  Object.assign(record, createNodeCredentialFields());
  clearSecretDownloadToken(record);
  const enrollment = activeEnrollment(record);
  if (!enrollment) throw new Error("Failed to rotate node enrollment credentials");
  return enrollment;
}

export function consumeEnrollment(record: NodeCredentialRecord, token: string, now = new Date()) {
  if (!activeEnrollmentMatches(record, sha256(token), now)) {
    throw new Error("Invalid, expired, or already used enrollment token");
  }

  ensureNodeCredentialFields(record);
  const secretToken = randomId(32);
  const secretTokenExpiresAt = new Date(now.getTime() + SECRET_DOWNLOAD_TOKEN_TTL_MS).toISOString();
  record.enrollmentTokenUsedAt = now.toISOString();
  record.enrollmentTokenHash = undefined;
  record.enrollmentTokenCipher = undefined;
  record.secretDownloadTokenHash = sha256(secretToken);
  record.secretDownloadTokenExpiresAt = secretTokenExpiresAt;

  return {
    statusToken: statusToken(record),
    secretToken,
    secretTokenExpiresAt
  };
}

export function clearSecretDownloadToken(record: NodeCredentialRecord): void {
  record.secretDownloadTokenHash = undefined;
  record.secretDownloadTokenExpiresAt = undefined;
}
