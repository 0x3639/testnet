/**
 * Resolves a branch or tag to a commit hash by reading the repository's advertised refs over the
 * git smart HTTP protocol (GET <repo>/info/refs?service=git-upload-pack). This needs no git binary
 * and works with GitHub, GitLab, Gitea, and plain git-http-backend hosts.
 */
const SHA_PATTERN = /^[0-9a-f]{40}$/;
/** Upper bound on an advertisement we are willing to parse (go-zenon's is a few KB). */
export const MAX_ADVERTISEMENT_BYTES = 8 * 1024 * 1024;

/**
 * Strict pkt-line parser for a v0 ref advertisement: every packet must be fully present, special
 * lengths other than the flush packet (0000) are rejected, the ref list must end with a terminal
 * flush, and nothing may follow it. Smart HTTP servers send a "# service=git-upload-pack" line and
 * a flush first; both are accepted but not required, so servers that omit them are still parsed.
 */
export function parseUploadPackRefs(text: string): Map<string, string> {
  const refs = new Map<string, string>();
  let offset = 0;
  let phase: "header" | "refs" = "header";
  let terminated = false;
  while (offset < text.length) {
    if (offset + 4 > text.length) throw new Error("Malformed pkt-line response: trailing bytes");
    const header = text.slice(offset, offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(header)) throw new Error("Malformed pkt-line length");
    const length = Number.parseInt(header, 16);
    if (length === 0) {
      offset += 4;
      if (phase === "header") {
        phase = "refs"; // flush that ends the service header
        continue;
      }
      terminated = true;
      if (offset !== text.length) throw new Error("Malformed pkt-line response: data after the terminal flush");
      break;
    }
    if (length < 4) throw new Error(`Unsupported pkt-line length ${header}`);
    if (offset + length > text.length) throw new Error("Malformed pkt-line response: truncated packet");
    const line = text.slice(offset + 4, offset + length);
    offset += length;
    if (phase === "header") {
      if (line.startsWith("#")) continue; // "# service=git-upload-pack"
      phase = "refs"; // servers that omit the service header go straight to refs
    }
    const payload = line.split("\0")[0].replace(/\n$/, "");
    const space = payload.indexOf(" ");
    if (space !== 40) continue;
    const sha = payload.slice(0, 40).toLowerCase();
    const name = payload.slice(41);
    if (!SHA_PATTERN.test(sha) || !name) continue;
    refs.set(name, sha);
  }
  if (!terminated) throw new Error("Malformed pkt-line response: missing terminal flush");
  return refs;
}

/** Exact media-type comparison, ignoring case and parameters such as charset. */
export function isUploadPackAdvertisement(contentType: string | null): boolean {
  const essence = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return essence === "application/x-git-upload-pack-advertisement";
}

/** Mirrors `git clone --branch`: a branch wins over a tag of the same name; tags are peeled. */
export function pickRef(refs: Map<string, string>, ref: string): string | undefined {
  return refs.get(`refs/heads/${ref}`) ?? refs.get(`refs/tags/${ref}^{}`) ?? refs.get(`refs/tags/${ref}`);
}

export function uploadPackRefsUrl(repoUrl: string): string {
  const base = repoUrl.trim().replace(/\/+$/, "");
  return `${base}${base.endsWith(".git") ? "" : ".git"}/info/refs?service=git-upload-pack`;
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) throw new Error("Ref advertisement is too large");
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Ref advertisement is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function resolveGitRef(repoUrl: string, ref: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = uploadPackRefsUrl(repoUrl);
  const response = await fetchImpl(url, {
    redirect: "error",
    headers: { "User-Agent": "zenon-testnet-builder", Accept: "*/*" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  const contentType = response.headers.get("content-type");
  if (!isUploadPackAdvertisement(contentType)) {
    throw new Error(`Unexpected content type '${contentType ?? ""}' from ${url}; not a git smart HTTP endpoint`);
  }
  const refs = parseUploadPackRefs((await readBounded(response, MAX_ADVERTISEMENT_BYTES)).toString("latin1"));
  const sha = pickRef(refs, ref);
  if (!sha) throw new Error(`Ref '${ref}' was not found in ${repoUrl}`);
  return sha;
}
