import type { PublicNetworkSettings, RepoPolicyInfo } from "../../shared/types";

export function download(path: string): void {
  window.location.assign(path);
}

export function shortAddress(value: string): string {
  if (!value) return "";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function copy(value: string): void {
  void navigator.clipboard.writeText(value);
}

export function loginUrl(): string {
  return new URL("/", window.location.href).toString();
}

export function publicUrl(path: string): string {
  return new URL(path, window.location.href).toString();
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function bootstrapCommand(token: string): string {
  const baseUrl = publicUrl("/").replace(/\/$/, "");
  return `curl -fsSL ${shellQuote(publicUrl("/api/bootstrap/install.sh"))} | sudo env ZNN_BOOTSTRAP_TOKEN=${shellQuote(
    token
  )} ZNN_TESTNET_URL=${shellQuote(baseUrl)} bash`;
}

export function toUtcDateTimeInput(seconds?: number): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 16);
}

export function fromUtcDateTimeInput(value: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(`${value}:00Z`);
  return Number.isNaN(timestamp) ? undefined : Math.floor(timestamp / 1000);
}

export function utcSecondsFromNow(minutes: number): number {
  return Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
}

export function formatUtc(value: string): string {
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function settingsKey(settings: PublicNetworkSettings): string {
  return JSON.stringify({
    chainIdentifier: settings.chainIdentifier,
    extraData: settings.extraData,
    expectedPillars: settings.expectedPillars,
    minPillars: settings.minPillars,
    genesisTimestampSec: settings.genesisTimestampSec,
    releaseApplyAtSec: settings.releaseApplyAtSec ?? null,
    goZenonRepo: settings.goZenonRepo,
    goZenonRef: settings.goZenonRef,
    goZenonCommit: settings.goZenonCommit || "",
    deploymentRepo: settings.deploymentRepo,
    deploymentRef: settings.deploymentRef,
    deploymentCommit: settings.deploymentCommit || "",
    wipeDataOnPublish: settings.wipeDataOnPublish,
    seeders: settings.seeders.filter(Boolean),
    bootstrapPeers: settings.bootstrapPeers.filter(Boolean),
    sporks: settings.sporks,
    genesisFunds: settings.genesisFunds
  });
}

export function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function repoShortName(repoUrl: string): string {
  return repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "") || repoUrl;
}

export function repoPolicyHint(policy: RepoPolicyInfo): string {
  return policy.allowedRepos
    ? `Allowed: ${policy.allowedRepos.join(", ")} (set ALLOWED_REPOS to change)`
    : `Any https repository on: ${policy.allowedHosts.join(", ")}`;
}
