import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { bootstrapInstallScript } from "./bootstrap-script.js";

/**
 * Exercises the bash emitted for operator nodes: the systemd start-time verifier and the agent's
 * helper functions, against fake toolchains and real git repositories.
 */
const script = bootstrapInstallScript("https://builder.example.test");
const GOOD = "9cde165877a1e4ff47d0df6cf8b8a65b121d550c";
const OTHER = "0123456789abcdef0123456789abcdef01234567";

function heredoc(marker: string): string {
  const lines = script.split("\n");
  const start = lines.findIndex((line) => line.includes(`<<'${marker}'`));
  const end = lines.indexOf(marker, start + 1);
  assert.ok(start >= 0 && end > start, `heredoc ${marker} not found`);
  return lines.slice(start + 1, end).join("\n") + "\n";
}

function bashFunction(source: string, name: string): string {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}\\n`, "m").exec(source);
  assert.ok(match, `function ${name} not found`);
  return match[0];
}

const hasBash = !spawnSync("bash", ["--version"]).error;
const hasGit = !spawnSync("git", ["--version"]).error && spawnSync("git", ["--version"]).status === 0;

describe("generated bootstrap script", { skip: !hasBash && "bash not available" }, () => {
  const verifyScript = heredoc("VERIFY");
  const agent = heredoc("AGENT");
  let root: string;
  let bin: string;
  let deploy: string;
  let state: string;
  let verifyPath: string;
  let helpersPath: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "znn-bootstrap-test-"));
    bin = path.join(root, "bin");
    deploy = path.join(root, "deploy");
    state = path.join(root, "state");
    for (const dir of [bin, path.join(deploy, "go", "bin"), state]) mkdirSync(dir, { recursive: true });
    verifyPath = path.join(root, "verify.sh");
    writeFileSync(verifyPath, verifyScript, { mode: 0o755 });
    helpersPath = path.join(root, "helpers.sh");
    writeFileSync(
      helpersPath,
      ["verify_gate_active", "checkout_pinned", "write_expected_commit", "binary_fingerprint", "quarantine_binary", "record_install_failure", "verify_znnd_build", "fetch_artifact"]
        .map((name) => bashFunction(agent, name))
        .join("\n")
    );
    writeFileSync(path.join(bin, "znnd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  });

  function fakeGo(metadata: string[]): void {
    const body = ["$2: go1.23.0", "\tpath\tgithub.com/zenon-network/go-zenon/cmd/znnd", ...metadata.map((line) => `\tbuild\t${line}`)].join("\\n");
    writeFileSync(path.join(deploy, "go", "bin", "go"), `#!/bin/sh\nprintf '${body}\\n' "$2"\n`, { mode: 0o755 });
  }

  function fakeSystemctl(execStartPre: string, reloadExit = 0): void {
    writeFileSync(
      path.join(bin, "systemctl"),
      `#!/bin/sh\necho "systemctl $*" >> "${root}/systemctl.log"\ncase "$1" in\n  daemon-reload) exit ${reloadExit} ;;\n  show) echo "${execStartPre}" ;;\n  cat) exit 0 ;;\nesac\nexit 0\n`,
      { mode: 0o755 }
    );
  }

  function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      ZNN_AGENT_STATE_DIR: state,
      ZNN_DEPLOYMENT_DIR: deploy,
      ...extra
    };
  }

  function verify(args: string[] = []): { status: number | null; out: string } {
    const result = spawnSync("bash", [verifyPath, ...args], { env: env(), encoding: "utf8" });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  function runHelpers(body: string, extraEnv: Record<string, string> = {}): { status: number | null; out: string } {
    const result = spawnSync("bash", ["-c", `set -uo pipefail; SERVICE_NAME=go-zenon; DEPLOYMENT_DIR=${JSON.stringify(deploy)}; STATE_DIR=${JSON.stringify(state)}; INSTALL_STATE_FILE=${JSON.stringify(path.join(state, "install-state.json"))}; source ${JSON.stringify(helpersPath)}; ${body}`], {
      env: env(extraEnv),
      encoding: "utf8"
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  describe("znn-testnet-verify-znnd", () => {
    it("refuses to start when no release has been applied (expected file missing)", () => {
      rmSync(path.join(state, "expected-znnd-commit"), { force: true });
      fakeGo([`vcs.revision=${GOOD}`, "vcs.modified=false"]);
      const result = verify();
      assert.equal(result.status, 1);
      assert.match(result.out, /no release has been applied/);
    });

    it("refuses to start when the expected file is empty", () => {
      writeFileSync(path.join(state, "expected-znnd-commit"), "\n");
      const result = verify();
      assert.equal(result.status, 1);
      assert.match(result.out, /is empty; refusing/);
    });

    it("accepts exactly the pinned revision with an unmodified tree, from file or argument", () => {
      fakeGo([`vcs.revision=${GOOD}`, "vcs.modified=false"]);
      writeFileSync(path.join(state, "expected-znnd-commit"), `${GOOD}\n`);
      const fromFile = verify();
      assert.equal(fromFile.status, 0);
      assert.match(fromFile.out, new RegExp(`revision=${GOOD}`));
      assert.equal(verify([GOOD.toUpperCase()]).status, 0);
    });

    it("rejects short pins, mismatches, and bad or missing modification metadata", () => {
      fakeGo([`vcs.revision=${GOOD}`, "vcs.modified=false"]);
      assert.equal(verify(["9cde1658"]).status, 1);
      assert.match(verify([OTHER]).out, /does not match the pinned commit/);
      fakeGo([`vcs.revision=${GOOD}`, "vcs.modified=true"]);
      assert.match(verify([GOOD]).out, /vcs.modified=false/);
      fakeGo([`vcs.revision=${GOOD}`]);
      assert.equal(verify([GOOD]).status, 1);
      fakeGo([`vcs.revision=${GOOD}`, "vcs.modified=false", "vcs.modified=false"]);
      assert.equal(verify([GOOD]).status, 1);
      fakeGo(["vcs.modified=false"]);
      assert.match(verify([GOOD]).out, /no embedded git revision/);
    });

    it("fails closed without a toolchain or binary", () => {
      rmSync(path.join(deploy, "go", "bin", "go"), { force: true });
      assert.match(verify([GOOD]).out, /go toolchain not found/);
      fakeGo([`vcs.revision=${GOOD}`, "vcs.modified=false"]);
      chmodSync(path.join(bin, "znnd"), 0o644);
      assert.match(verify([GOOD]).out, /znnd binary not found/);
      chmodSync(path.join(bin, "znnd"), 0o755);
    });
  });

  describe("agent helpers", () => {
    it("verify_gate_active requires the ExecStartPre hook and a working daemon-reload", () => {
      fakeSystemctl("{ path=/usr/local/bin/znn-testnet-verify-znnd ; argv[]=/usr/local/bin/znn-testnet-verify-znnd }");
      assert.equal(runHelpers("verify_gate_active").status, 0);
      fakeSystemctl("");
      assert.match(runHelpers("verify_gate_active").out, /does not run znn-testnet-verify-znnd/);
      fakeSystemctl("{ path=/usr/local/bin/znn-testnet-verify-znnd }", 1);
      assert.match(runHelpers("verify_gate_active").out, /daemon-reload failed/);
    });

    it("record_install_failure and quarantine_binary stop the service and move the binary aside", () => {
      fakeSystemctl("x");
      writeFileSync(path.join(bin, "znnd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const result = runHelpers('record_install_failure "key1" "evt1" "boom"; quarantine_binary');
      assert.equal(result.status, 0);
      const installState = JSON.parse(readFileSync(path.join(state, "install-state.json"), "utf8"));
      assert.equal(installState.failedKey, "key1");
      assert.equal(installState.lastError, "boom");
      assert.equal(existsSync(path.join(bin, "znnd")), false);
      assert.equal(existsSync(path.join(bin, "znnd.unverified")), true);
      assert.match(readFileSync(path.join(root, "systemctl.log"), "utf8"), /systemctl stop go-zenon/);
      writeFileSync(path.join(bin, "znnd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    });

    it("--retry clears a recorded failure", () => {
      writeFileSync(path.join(state, "install-state.json"), JSON.stringify({ failedKey: "k", lastError: "x", failedAt: "t", binaryKey: "b" }));
      const retry = /if \[\[ "\$\{1:-\}" == "--retry" \]\]; then\n[\s\S]*?\nfi\n/.exec(agent);
      assert.ok(retry, "retry block not found");
      const result = spawnSync("bash", ["-c", `set -euo pipefail; INSTALL_STATE_FILE=${JSON.stringify(path.join(state, "install-state.json"))}; set -- --retry; ${retry[0]}`], { env: env(), encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(path.join(state, "install-state.json"), "utf8")), { binaryKey: "b" });
    });

    it("write_expected_commit replaces the pin atomically with mode 0600 and refuses empty pins", () => {
      const target = path.join(state, "expected-znnd-commit");
      writeFileSync(target, `${OTHER}\n`);
      assert.equal(runHelpers(`write_expected_commit ""`).status, 1);
      assert.equal(runHelpers(`write_expected_commit 9cde1658`).status, 1);
      assert.equal(readFileSync(target, "utf8").trim(), OTHER);
      const ok = runHelpers(`write_expected_commit ${GOOD}`);
      assert.equal(ok.status, 0, ok.out);
      assert.equal(readFileSync(target, "utf8").trim(), GOOD);
      assert.equal(statSync(target).mode & 0o777, 0o600);
      assert.deepEqual(readdirSync(state).filter((name) => name.startsWith(".expected-znnd-commit.")), []);
    });

    it("binary_fingerprint distinguishes a rebuilt binary from a leftover one", () => {
      writeFileSync(path.join(bin, "znnd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const first = runHelpers("binary_fingerprint");
      assert.equal(first.status, 0);
      assert.match(first.out.trim(), /^[0-9a-f]{64}$/);
      assert.equal(runHelpers("binary_fingerprint").out, first.out);
      writeFileSync(path.join(bin, "znnd"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      assert.notEqual(runHelpers("binary_fingerprint").out, first.out);
      rmSync(path.join(bin, "znnd"));
      assert.equal(runHelpers("binary_fingerprint").out.trim(), "");
      writeFileSync(path.join(bin, "znnd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    });

    it("fetch_artifact never leaves a truncated file behind", () => {
      const dest = path.join(root, "artifact.json");
      writeFileSync(dest, "previous");
      const failing = runHelpers(`auth_get() { return 22; }; fetch_artifact https://x/y ${JSON.stringify(dest)}`);
      assert.equal(failing.status, 1);
      assert.equal(readFileSync(dest, "utf8"), "previous");
      const ok = runHelpers(`auth_get() { echo '{"ok":true}'; }; fetch_artifact https://x/y ${JSON.stringify(dest)}`);
      assert.equal(ok.status, 0);
      assert.equal(readFileSync(dest, "utf8").trim(), '{"ok":true}');
    });

    describe("checkout_pinned", { skip: !hasGit && "git not available" }, () => {
      function git(cwd: string, ...args: string[]): string {
        const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "advice.detachedHead=false", ...args], { cwd, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      }

      it("checks out exactly the pinned commit even after the branch moves, and the checkout is re-clonable", () => {
        const repo = path.join(root, "origin.git");
        mkdirSync(repo);
        git(repo, "init", "-q", "-b", "main");
        git(repo, "config", "uploadpack.allowAnySHA1InWant", "true");
        git(repo, "commit", "-q", "--allow-empty", "-m", "one");
        const pinned = git(repo, "rev-parse", "HEAD");
        git(repo, "commit", "-q", "--allow-empty", "-m", "two");
        const moved = git(repo, "rev-parse", "HEAD");
        assert.notEqual(pinned, moved);

        const dest = path.join(root, "checkout");
        const result = runHelpers(`checkout_pinned "file://${repo}" main ${pinned} ${JSON.stringify(dest)}`);
        assert.equal(result.status, 0, result.out);
        assert.equal(git(dest, "rev-parse", "HEAD"), pinned);
        assert.equal(git(dest, "rev-parse", "--abbrev-ref", "HEAD"), "pinned");

        // The deployment script clones this checkout by branch name; the commit must survive.
        const clone = path.join(root, "clone");
        git(root, "clone", "-q", "-b", "pinned", `file://${dest}`, clone);
        assert.equal(git(clone, "rev-parse", "HEAD"), pinned);

        const unpinned = runHelpers(`checkout_pinned "file://${repo}" main "" ${JSON.stringify(dest)}`);
        assert.equal(unpinned.status, 0, unpinned.out);
        assert.equal(git(dest, "rev-parse", "HEAD"), moved);

        // A pin that is not reachable from the ref is an integrity failure (exit 2), not a retry.
        const missing = runHelpers(`checkout_pinned "file://${repo}" main ${OTHER} ${JSON.stringify(dest)}`);
        assert.equal(missing.status, 2, missing.out);
        // An unreachable repository is transient (exit 1).
        const unreachable = runHelpers(`checkout_pinned "file://${root}/does-not-exist" main ${pinned} ${JSON.stringify(dest)}`);
        assert.equal(unreachable.status, 1, unreachable.out);
      });

      it("falls back to fetching the ref's history when the server refuses fetch-by-hash", () => {
        const repo = path.join(root, "strict.git");
        mkdirSync(repo);
        git(repo, "init", "-q", "-b", "main");
        git(repo, "commit", "-q", "--allow-empty", "-m", "one");
        const pinned = git(repo, "rev-parse", "HEAD");
        git(repo, "commit", "-q", "--allow-empty", "-m", "two");
        const dest = path.join(root, "strict-checkout");
        // Protocol v0 upload-pack refuses unadvertised objects unless allow*SHA1InWant is enabled,
        // which is the behavior of a conservative git server.
        const strict = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.version", GIT_CONFIG_VALUE_0: "0" };
        const result = runHelpers(`checkout_pinned "file://${repo}" main ${pinned} ${JSON.stringify(dest)}`, strict);
        assert.equal(result.status, 0, result.out);
        assert.match(result.out, /full history/);
        assert.equal(git(dest, "rev-parse", "HEAD"), pinned);
      });

      it("a real Go build from the file:// checkout embeds the pin and passes the verifier", { skip: spawnSync("go", ["version"]).status !== 0 && "go not available" }, () => {
        const repo = path.join(root, "gomod.git");
        mkdirSync(repo);
        git(repo, "init", "-q", "-b", "main");
        writeFileSync(path.join(repo, "go.mod"), "module example.test/znnd\n\ngo 1.21\n");
        writeFileSync(path.join(repo, "main.go"), "package main\n\nfunc main() {}\n");
        git(repo, "add", ".");
        git(repo, "commit", "-q", "-m", "one");
        const pinned = git(repo, "rev-parse", "HEAD");
        git(repo, "commit", "-q", "--allow-empty", "-m", "two");
        const dest = path.join(root, "go-zenon-pinned");
        assert.equal(runHelpers(`checkout_pinned "file://${repo}" main ${pinned} ${JSON.stringify(dest)}`).status, 0);
        // Simulate zenon.sh: clone the local checkout by branch name and build inside it.
        const clone = path.join(root, "go-build");
        git(root, "clone", "-q", "-b", "pinned", `file://${dest}`, clone);
        const build = spawnSync("go", ["build", "-o", path.join(bin, "znnd"), "."], { cwd: clone, encoding: "utf8", env: { ...process.env, GOFLAGS: "-mod=mod", GOTOOLCHAIN: "local" } });
        assert.equal(build.status, 0, build.stderr);
        // Point the verifier at the real toolchain and binary.
        rmSync(path.join(deploy, "go", "bin", "go"), { force: true });
        const goBin = spawnSync("sh", ["-c", "command -v go"], { encoding: "utf8" }).stdout.trim();
        writeFileSync(path.join(deploy, "go", "bin", "go"), `#!/bin/sh\nexec ${JSON.stringify(goBin)} "$@"\n`, { mode: 0o755 });
        const ok = verify([pinned]);
        assert.equal(ok.status, 0, ok.out);
        assert.match(ok.out, new RegExp(`revision=${pinned}`));
        assert.match(verify([OTHER]).out, /does not match/);
        writeFileSync(path.join(bin, "znnd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      });
    });
  });
});
