import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SYNTHETIC_SECRET = "synthetic-test-secret-with-sufficient-randomness";

function runModule(code, environment = {}) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_SECRET: SYNTHETIC_SECRET,
      ...environment
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function cryptoImport(appSecret) {
  const environment = { ...process.env, NODE_ENV: "production" };
  if (appSecret === undefined) delete environment.APP_SECRET;
  else environment.APP_SECRET = appSecret;
  return spawnSync(process.execPath, ["--input-type=module", "-e", 'await import("./dist/server/server/crypto.js")'], {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8"
  });
}

test("state storage creates and repairs private permissions", () => {
  const result = runModule(`
    const { chmod, mkdtemp, rm, stat } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dataDir = await mkdtemp(join(tmpdir(), "testnet-state-permissions-"));
    process.env.DATA_DIR = dataDir;
    const { readState } = await import("./dist/server/server/storage.js");
    await readState();
    const stateFile = join(dataDir, "app-state.json");
    const initial = {
      directory: (await stat(dataDir)).mode & 0o777,
      file: (await stat(stateFile)).mode & 0o777
    };
    await chmod(dataDir, 0o755);
    await chmod(stateFile, 0o644);
    await readState();
    const repaired = {
      directory: (await stat(dataDir)).mode & 0o777,
      file: (await stat(stateFile)).mode & 0o777
    };
    await rm(dataDir, { recursive: true, force: true });
    console.log(JSON.stringify({ initial, repaired }));
  `);

  assert.deepEqual(result, {
    initial: { directory: 0o700, file: 0o600 },
    repaired: { directory: 0o700, file: 0o600 }
  });
});

test("password reset revokes older sessions and keeps only the active session", () => {
  const result = runModule(`
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dataDir = await mkdtemp(join(tmpdir(), "testnet-session-reset-"));
    process.env.DATA_DIR = dataDir;
    const { createAccount, resetAccountPassword } = await import("./dist/server/server/accounts.js");
    const { currentUser, login } = await import("./dist/server/server/auth.js");
    const account = await createAccount("synthetic-admin", "admin", "synthetic-old-password");
    const olderSession = await login(account.user.username, "synthetic-old-password");
    const activeSession = await login(account.user.username, "synthetic-old-password");
    await resetAccountPassword(account.user.id, "synthetic-new-password", activeSession.token);
    const outcome = {
      olderSessionAlive: Boolean(await currentUser(olderSession.token)),
      activeSessionAlive: Boolean(await currentUser(activeSession.token)),
      oldPasswordWorks: Boolean(await login(account.user.username, "synthetic-old-password")),
      newPasswordWorks: Boolean(await login(account.user.username, "synthetic-new-password"))
    };
    await rm(dataDir, { recursive: true, force: true });
    console.log(JSON.stringify(outcome));
  `);

  assert.deepEqual(result, {
    olderSessionAlive: false,
    activeSessionAlive: true,
    oldPasswordWorks: false,
    newPasswordWorks: true
  });
});

test("production rejects missing and default application secrets", () => {
  const missing = cryptoImport(undefined);
  const knownDefault = cryptoImport("dev-secret-change-me");
  const configured = cryptoImport(SYNTHETIC_SECRET);

  assert.notEqual(missing.status, 0);
  assert.notEqual(knownDefault.status, 0);
  assert.match(missing.stderr, /APP_SECRET must be set to a non-default value in production/);
  assert.match(knownDefault.stderr, /APP_SECRET must be set to a non-default value in production/);
  assert.equal(configured.status, 0, configured.stderr);
});

test("generated node RPC defaults are loopback-only with no wildcard origins", async () => {
  process.env.APP_SECRET = SYNTHETIC_SECRET;
  const { buildNodeConfig } = await import("../dist/server/server/genesis.js");
  const config = buildNodeConfig({ minPillars: 4, expectedPillars: 4, seeders: [], bootstrapPeers: [] });

  assert.equal(config.RPC.HTTPHost, "127.0.0.1");
  assert.equal(config.RPC.WSHost, "127.0.0.1");
  assert.deepEqual(config.RPC.HTTPVirtualHosts, ["localhost", "127.0.0.1"]);
  assert.deepEqual(config.RPC.HTTPCors, []);
  assert.deepEqual(config.RPC.WSOrigins, []);
});

test("devnet output uses private writes and loopback host port publishing", async () => {
  const source = await readFile("scripts/create-four-node-devnet.mjs", "utf8");

  assert.equal((source.match(/await writeFile\(/g) ?? []).length, 1);
  assert.equal((source.match(/await mkdir\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /HTTPCors:\s*\["\*"\]/);
  assert.doesNotMatch(source, /WSOrigins:\s*\["\*"\]/);
  assert.match(source, /127\.0\.0\.1:\$\{role\.httpPort\}:35997/);
  assert.match(source, /127\.0\.0\.1:\$\{role\.wsPort\}:35998/);
});
