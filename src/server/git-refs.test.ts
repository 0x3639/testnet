import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUploadPackAdvertisement, MAX_ADVERTISEMENT_BYTES, parseUploadPackRefs, pickRef, resolveGitRef, uploadPackRefsUrl } from "./git-refs.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

function pkt(line: string): string {
  return `${(line.length + 4).toString(16).padStart(4, "0")}${line}`;
}

const advertisement =
  pkt("# service=git-upload-pack\n") +
  "0000" +
  pkt(`${A} HEAD\0multi_ack symref=HEAD:refs/heads/master agent=git/2.x\n`) +
  pkt(`${A} refs/heads/master\n`) +
  pkt(`${B} refs/heads/release/v0.0.9\n`) +
  pkt(`${C} refs/tags/v1.0\n`) +
  pkt(`${B} refs/tags/v1.0^{}\n`) +
  "0000";

describe("git smart HTTP ref resolution", () => {
  it("parses pkt-line ref advertisements", () => {
    const refs = parseUploadPackRefs(advertisement);
    assert.equal(refs.get("refs/heads/master"), A);
    assert.equal(refs.get("refs/heads/release/v0.0.9"), B);
    assert.equal(refs.get("refs/tags/v1.0^{}"), B);
    assert.equal(refs.get("HEAD"), A);
  });

  it("prefers branches, then peeled tags", () => {
    const refs = parseUploadPackRefs(advertisement);
    assert.equal(pickRef(refs, "master"), A);
    assert.equal(pickRef(refs, "release/v0.0.9"), B);
    assert.equal(pickRef(refs, "v1.0"), B);
    assert.equal(pickRef(refs, "missing"), undefined);
  });

  it("builds the info/refs URL with and without .git", () => {
    assert.equal(uploadPackRefsUrl("https://github.com/a/b.git"), "https://github.com/a/b.git/info/refs?service=git-upload-pack");
    assert.equal(uploadPackRefsUrl("https://github.com/a/b/"), "https://github.com/a/b.git/info/refs?service=git-upload-pack");
  });

  it("rejects truncated packets, bad lengths, and trailing bytes", () => {
    const truncated = pkt("# service=git-upload-pack\n") + "0000" + `0031${A} refs/heads/master\n`.slice(0, 20);
    assert.throws(() => parseUploadPackRefs(truncated), /truncated/);
    assert.throws(() => parseUploadPackRefs(`0005${A} refs/heads/x\n`), /truncated|Malformed/);
    assert.throws(() => parseUploadPackRefs("0002"), /Unsupported/);
    assert.throws(() => parseUploadPackRefs("zzzz"), /Malformed pkt-line length/);
    assert.throws(() => parseUploadPackRefs(advertisement + "ab"), /trailing|terminal flush/);
    assert.throws(() => parseUploadPackRefs(""), /missing terminal flush/);
  });

  it("requires a terminal flush and rejects packets after it", () => {
    const noFinalFlush = pkt("# service=git-upload-pack\n") + "0000" + pkt(`${A} refs/heads/master\n`);
    assert.throws(() => parseUploadPackRefs(noFinalFlush), /missing terminal flush/);
    const afterFlush = advertisement + pkt(`${C} refs/heads/master\n`) + "0000";
    assert.throws(() => parseUploadPackRefs(afterFlush), /after the terminal flush/);
    // Servers that omit the service header are still parsed.
    assert.equal(parseUploadPackRefs(pkt(`${A} refs/heads/master\n`) + "0000").get("refs/heads/master"), A);
  });

  it("matches the media type exactly, ignoring case and parameters", () => {
    assert.equal(isUploadPackAdvertisement("application/x-git-upload-pack-advertisement"), true);
    assert.equal(isUploadPackAdvertisement("Application/X-Git-Upload-Pack-Advertisement; charset=utf-8"), true);
    assert.equal(isUploadPackAdvertisement("application/x-git-upload-pack-advertisementevil"), false);
    assert.equal(isUploadPackAdvertisement("text/html"), false);
    assert.equal(isUploadPackAdvertisement(null), false);
  });

  it("does not let a tag shadow a branch and handles lightweight tags", () => {
    const refs = parseUploadPackRefs(pkt(`${A} refs/heads/v1.0\n`) + pkt(`${C} refs/tags/v1.0\n`) + pkt(`${B} refs/tags/v1.0^{}\n`) + pkt(`${C} refs/tags/light\n`) + "0000");
    assert.equal(pickRef(refs, "v1.0"), A);
    assert.equal(pickRef(refs, "light"), C);
  });

  it("resolves through fetch and fails on missing refs, errors, wrong content type, or oversized bodies", async () => {
    const headers = { "content-type": "application/x-git-upload-pack-advertisement" };
    const fake = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.redirect, "error");
      return new Response(advertisement, { status: 200, headers });
    }) as typeof fetch;
    assert.equal(await resolveGitRef("https://github.com/a/b.git", "master", fake), A);
    await assert.rejects(resolveGitRef("https://github.com/a/b.git", "nope", fake), /not found/);
    const failing = (async () => new Response("", { status: 404, headers })) as typeof fetch;
    await assert.rejects(resolveGitRef("https://github.com/a/b.git", "master", failing), /HTTP 404/);
    const html = (async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    await assert.rejects(resolveGitRef("https://github.com/a/b.git", "master", html), /content type/);
    const huge = (async () => new Response("x".repeat(MAX_ADVERTISEMENT_BYTES + 1), { status: 200, headers })) as typeof fetch;
    await assert.rejects(resolveGitRef("https://github.com/a/b.git", "master", huge), /too large/);
  });
});
