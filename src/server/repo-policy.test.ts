import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { checkCommit, checkGitRef, checkRepoUrl, DEFAULT_ALLOWED_REPOS, loadRepoPolicy, normalizeRepoUrl, redactUrl, releasePolicyErrors } from "./repo-policy.js";

const defaults = ["https://github.com/zenon-network/go-zenon.git", "https://github.com/hypercore-one/deployment.git"];
const policy = loadRepoPolicy({}, defaults);

describe("repository policy", () => {
  it("accepts the default repositories with equivalent spellings", () => {
    for (const url of [
      "https://github.com/zenon-network/go-zenon.git",
      "https://github.com/zenon-network/go-zenon",
      "https://GITHUB.com/zenon-network/go-zenon/"
    ]) {
      assert.equal(checkRepoUrl(url, policy).ok, true, url);
    }
  });

  it("keeps repository path case", () => {
    assert.equal(checkRepoUrl("https://github.com/Zenon-Network/go-zenon", policy).ok, false);
    assert.equal(normalizeRepoUrl("https://GitHub.com/Foo/Bar.git"), "https://github.com/Foo/Bar");
  });

  it("rejects credentials, http, query strings, other hosts, and other repositories", () => {
    const rejected = [
      "https://user:token@github.com/zenon-network/go-zenon.git",
      "https://user@github.com/zenon-network/go-zenon.git",
      "http://github.com/zenon-network/go-zenon.git",
      "https://github.com/zenon-network/go-zenon.git?x=1",
      "https://github.com/zenon-network/go-zenon.git#frag",
      "https://gitlab.com/zenon-network/go-zenon.git",
      "https://github.com/evil/go-zenon.git",
      "https://github.com/zenon-network/../evil.git",
      "https://:bad",
      "javascript:alert(1)",
      "ssh://git@github.com/zenon-network/go-zenon.git"
    ];
    for (const url of rejected) assert.equal(checkRepoUrl(url, policy).ok, false, url);
  });

  it("preapproves the go-zenon forks and the deployment repo by default, plus configured defaults", () => {
    assert.deepEqual(DEFAULT_ALLOWED_REPOS, [
      "https://github.com/zenon-network/go-zenon.git",
      "https://github.com/digitalSloth/go-zenon.git",
      "https://github.com/0x3639/go-zenon.git",
      "https://github.com/hypercore-one/deployment.git"
    ]);
    for (const url of DEFAULT_ALLOWED_REPOS) assert.equal(checkRepoUrl(url, policy).ok, true, url);
    assert.equal(checkRepoUrl("https://github.com/someone-else/go-zenon.git", policy).ok, false);
    // A custom configured default (GO_ZENON_REPO / DEPLOYMENT_REPO) is always allowed too.
    const withCustom = loadRepoPolicy({}, ["https://github.com/example/go-zenon.git"]);
    assert.equal(checkRepoUrl("https://github.com/example/go-zenon", withCustom).ok, true);
    assert.equal(checkRepoUrl("https://github.com/digitalSloth/go-zenon", withCustom).ok, true);
    assert.equal(withCustom.allowedRepos?.length, DEFAULT_ALLOWED_REPOS.length + 1);
  });

  it("admits a configured default on another host when both allowlists are implicit", () => {
    const implicit = loadRepoPolicy({}, ["https://git.example.org/zenon/go-zenon.git"]);
    assert.deepEqual(implicit.allowedHosts, ["github.com", "git.example.org"]);
    assert.equal(checkRepoUrl("https://git.example.org/zenon/go-zenon", implicit).ok, true);
    assert.equal(checkRepoUrl("https://git.example.org/zenon/other", implicit).ok, false);
    // An explicit host list is preserved as given, and explicit ALLOWED_REPOS drops the configured defaults.
    const explicitHosts = loadRepoPolicy({ ALLOWED_REPO_HOSTS: "github.com" }, ["https://git.example.org/zenon/go-zenon.git"]);
    assert.deepEqual(explicitHosts.allowedHosts, ["github.com"]);
    const explicitRepos = loadRepoPolicy({ ALLOWED_REPOS: "https://github.com/someone/fork.git" }, ["https://git.example.org/zenon/go-zenon.git"]);
    assert.deepEqual(explicitRepos.allowedHosts, ["github.com"]);
    assert.equal(checkRepoUrl("https://git.example.org/zenon/go-zenon", explicitRepos).ok, false);
  });

  it("allows any repository on an allowed host when ALLOWED_REPOS=*", () => {
    const open = loadRepoPolicy({ ALLOWED_REPOS: "*", ALLOWED_REPO_HOSTS: "github.com, example.org" }, defaults);
    assert.equal(checkRepoUrl("https://github.com/someone/fork.git", open).ok, true);
    assert.equal(checkRepoUrl("https://Example.org/x/y", open).ok, true);
    assert.equal(checkRepoUrl("https://gitlab.com/someone/fork.git", open).ok, false);
  });

  it("uses explicit ALLOWED_REPOS when set", () => {
    const custom = loadRepoPolicy({ ALLOWED_REPOS: "https://github.com/someone/fork.git" }, defaults);
    assert.equal(checkRepoUrl("https://github.com/someone/fork", custom).ok, true);
    assert.equal(checkRepoUrl(defaults[0], custom).ok, false);
  });

  it("redacts credentials", () => {
    assert.equal(redactUrl("https://user:token@github.com/a/b.git"), "https://github.com/a/b.git");
    assert.equal(redactUrl("https://github.com/a/b.git"), "https://github.com/a/b.git");
    assert.equal(redactUrl("not a url://user:pw@host/x"), "");
    assert.equal(redactUrl("token@github.com:org/repo.git"), "");
  });

  it("requires full commit hashes", () => {
    assert.equal(checkCommit("9cde165877a1e4ff47d0df6cf8b8a65b121d550c").ok, true);
    assert.equal(checkCommit("9CDE165877A1E4FF47D0DF6CF8B8A65B121D550C").ok, true);
    assert.equal(checkCommit("9cde1658").ok, false);
    assert.equal(checkCommit("9cde165877a1e4ff47d0df6cf8b8a65b121d550c0").ok, false);
    assert.equal(checkCommit("zcde165877a1e4ff47d0df6cf8b8a65b121d550c").ok, false);
  });

  it("requires pins when asked", () => {
    const base = { goZenonRepo: defaults[0], goZenonRef: "master", deploymentRepo: defaults[1], deploymentRef: "main" };
    assert.equal(releasePolicyErrors(base, policy).length, 0);
    assert.equal(releasePolicyErrors(base, policy, { requirePins: true }).length, 2);
    assert.equal(releasePolicyErrors({ ...base, goZenonCommit: "a".repeat(40), deploymentCommit: "b".repeat(40) }, policy, { requirePins: true }).length, 0);
  });

  it("reports every release setting problem", () => {
    const errors = releasePolicyErrors(
      {
        goZenonRepo: "http://github.com/zenon-network/go-zenon.git",
        goZenonRef: "-x",
        goZenonCommit: "abc",
        deploymentRepo: "https://github.com/hypercore-one/deployment.git",
        deploymentRef: "main",
        deploymentCommit: undefined
      },
      policy
    );
    assert.equal(errors.length, 3);
  });
});

describe("git ref validation", () => {
  const valid = ["main", "master", "release/v0.0.9", "v1.2.3", "release+candidate", "feature/a-b_c.d", "a/b/c", "x.y", "1.0", "v1.0-rc1"];
  const invalid = [
    "", "-x", "--upload-pack=x", "HEAD", "@", "a..b", "a@{b}", "main//x", "main/.hidden", "main.", "foo.lock/bar", "foo.lock",
    "a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a\u0001b", "a\u007fb", "ünicode", "/main", "main/", ".hidden"
  ];

  it("accepts valid refs", () => {
    for (const ref of valid) assert.equal(checkGitRef(ref).ok, true, ref);
  });

  it("rejects invalid refs", () => {
    for (const ref of invalid) assert.equal(checkGitRef(ref).ok, false, JSON.stringify(ref));
  });

  it("agrees with git check-ref-format --branch on the corpus", (t) => {
    const probe = spawnSync("git", ["--version"]);
    if (probe.error || probe.status !== 0) {
      t.skip("git not available");
      return;
    }
    for (const ref of [...valid, ...invalid]) {
      if (ref === "" || ref.startsWith("-")) continue; // git treats these as options / usage errors
      const git = spawnSync("git", ["check-ref-format", "--branch", ref]);
      const gitOk = git.status === 0;
      // Our validator may be stricter than git (non-ASCII and a bare "@" are rejected) but never looser.
      if (gitOk) {
        if (!checkGitRef(ref).ok) assert.ok(ref === "@" || /[^\x21-\x7e]/.test(ref), `rejected a ref git accepts: ${JSON.stringify(ref)}`);
      } else {
        assert.equal(checkGitRef(ref).ok, false, `accepted a ref git rejects: ${JSON.stringify(ref)}`);
      }
    }
  });
});
