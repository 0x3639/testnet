/**
 * Release repository policy. Operator nodes clone and execute whatever repositories the admin
 * publishes, as root, so the set of acceptable repositories is pinned by deployment configuration
 * rather than left to the admin session alone.
 *
 *   ALLOWED_REPO_HOSTS  comma-separated hostnames (default: github.com)
 *   ALLOWED_REPOS       comma-separated repository URLs (default: the configured default go-zenon
 *                       and deployment repositories); "*" disables the repository list and leaves
 *                       only the host check
 */
export interface RepoPolicy {
  allowedHosts: string[];
  /** Normalized repository URLs, or undefined when any repository on an allowed host is accepted. */
  allowedRepos?: string[];
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Canonical form for comparing repository URLs: lower-cased host, trailing slashes and ".git"
 * removed. The path keeps its case because Git hosts may treat paths case-sensitively.
 */
export function normalizeRepoUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${pathname}`;
}

/**
 * Strips embedded credentials from a URL so it can be logged or published safely. A value that is
 * not a parseable URL is withheld entirely: it cannot be redacted reliably, so it is never echoed.
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function loadRepoPolicy(env: NodeJS.ProcessEnv, defaultRepos: string[]): RepoPolicy {
  const allowedHosts = splitList(env.ALLOWED_REPO_HOSTS).map((host) => host.toLowerCase());
  const repoSetting = env.ALLOWED_REPOS?.trim();
  const repoList = repoSetting === "*" ? undefined : splitList(repoSetting).length ? splitList(repoSetting) : defaultRepos;
  const allowedRepos = repoList?.map((repo) => {
    const normalized = normalizeRepoUrl(repo);
    if (!normalized) throw new Error(`ALLOWED_REPOS contains an invalid URL: ${redactUrl(repo)}`);
    return normalized;
  });
  return {
    allowedHosts: allowedHosts.length ? allowedHosts : ["github.com"],
    allowedRepos
  };
}

export interface RepoCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Validates a repository URL against the policy. Requires https, rejects embedded credentials
 * (they would be published in public manifests), and enforces the host and repository lists.
 */
export function checkRepoUrl(value: string, policy: RepoPolicy): RepoCheck {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: "Repository must be a valid URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Repository must use https://" };
  if (url.username || url.password) return { ok: false, reason: "Repository URL must not contain credentials" };
  if (!url.hostname) return { ok: false, reason: "Repository URL must include a host" };
  if (url.search || url.hash) return { ok: false, reason: "Repository URL must not contain a query string or fragment" };
  if (!/^\/[A-Za-z0-9._~%/-]+$/.test(url.pathname) || url.pathname.includes("..")) {
    return { ok: false, reason: "Repository path may only contain letters, numbers, dots, underscores, hyphens, and slashes" };
  }
  if (!policy.allowedHosts.includes(url.hostname.toLowerCase())) {
    return { ok: false, reason: `Repository host must be one of: ${policy.allowedHosts.join(", ")}` };
  }
  if (policy.allowedRepos) {
    const normalized = normalizeRepoUrl(value);
    if (!normalized || !policy.allowedRepos.includes(normalized)) {
      return { ok: false, reason: `Repository must be one of: ${policy.allowedRepos.join(", ")}` };
    }
  }
  return { ok: true };
}

// Characters git forbids anywhere in a ref name, plus anything outside printable ASCII so the
// value is safe to interpolate into generated shell (it is always quoted there as well).
const REF_FORBIDDEN_CHARS = /[^\x21-\x7e]|[~^:?*[\\]/;

/**
 * Mirrors `git check-ref-format --branch` for a ref passed to `git clone --branch`, so a published
 * ref cannot be one that every node would fail to clone, and can never start with "-".
 */
export function checkGitRef(value: string): RepoCheck {
  const ref = value.trim();
  if (!ref) return { ok: false, reason: "Git ref is required" };
  if (ref.length > 160) return { ok: false, reason: "Git ref is too long" };
  if (ref.startsWith("-")) return { ok: false, reason: "Git ref must not start with '-'" };
  if (ref === "@" || ref === "HEAD") return { ok: false, reason: `'${ref}' is not a valid branch or tag name` };
  if (REF_FORBIDDEN_CHARS.test(ref)) {
    return { ok: false, reason: "Git ref contains a character git does not allow (space, control, ~ ^ : ? * [ \\ or non-ASCII)" };
  }
  if (ref.includes("..") || ref.includes("@{")) return { ok: false, reason: "Git ref must not contain '..' or '@{'" };
  if (ref.endsWith(".") || ref.endsWith("/")) return { ok: false, reason: "Git ref must not end with '.' or '/'" };
  for (const component of ref.split("/")) {
    if (!component) return { ok: false, reason: "Git ref must not contain empty path components" };
    if (component.startsWith(".")) return { ok: false, reason: "Git ref components must not start with '.'" };
    if (component.endsWith(".lock")) return { ok: false, reason: "Git ref components must not end with '.lock'" };
  }
  return { ok: true };
}

/** A commit pin must be a full 40-character SHA-1 so the node can compare it exactly. */
export function checkCommit(value: string): RepoCheck {
  return /^[0-9a-f]{40}$/.test(value.trim().toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "Commit pin must be a full 40-character hex commit hash" };
}

export interface ReleaseSettingsLike {
  goZenonRepo: string;
  goZenonRef: string;
  goZenonCommit?: string;
  deploymentRepo: string;
  deploymentRef: string;
  deploymentCommit?: string;
}

/**
 * Every reason the release settings would be refused by the policy; empty when they pass.
 * With `requirePins`, both commit pins must be present (published plans always carry them).
 */
export function releasePolicyErrors(settings: ReleaseSettingsLike, policy: RepoPolicy, options: { requirePins?: boolean } = {}): string[] {
  const errors: string[] = [];
  const note = (label: string, check: RepoCheck) => {
    if (!check.ok) errors.push(`${label}: ${check.reason}`);
  };
  const pin = (label: string, value: string | undefined) => {
    if (value) note(label, checkCommit(value));
    else if (options.requirePins) errors.push(`${label}: a commit pin is required`);
  };
  note("go-zenon repository", checkRepoUrl(settings.goZenonRepo, policy));
  note("go-zenon ref", checkGitRef(settings.goZenonRef));
  pin("go-zenon commit", settings.goZenonCommit);
  note("deployment repository", checkRepoUrl(settings.deploymentRepo, policy));
  note("deployment ref", checkGitRef(settings.deploymentRef));
  pin("deployment commit", settings.deploymentCommit);
  return errors;
}
