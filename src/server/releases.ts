import type { NetworkSettings, NetworkSettingsSnapshot } from "../shared/types.js";

const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function isPinnedGitCommit(value?: string): value is string {
  return Boolean(value && GIT_COMMIT_PATTERN.test(value));
}

export function requireReleasePins(settings: NetworkSettings | NetworkSettingsSnapshot): void {
  const missing: string[] = [];
  if (!isPinnedGitCommit(settings.goZenonCommit)) missing.push("go-zenon");
  if (!isPinnedGitCommit(settings.deploymentCommit)) missing.push("deployment");
  if (missing.length > 0) {
    throw new Error(`Publish requires full immutable commit pins for: ${missing.join(", ")}.`);
  }
}
