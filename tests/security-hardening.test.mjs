import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const tooShort = cryptoImport("synthetic-short-secret");
  const configured = cryptoImport(SYNTHETIC_SECRET);

  assert.notEqual(missing.status, 0);
  assert.notEqual(knownDefault.status, 0);
  assert.notEqual(tooShort.status, 0);
  assert.match(missing.stderr, /APP_SECRET must be set to a non-default value in production/);
  assert.match(knownDefault.stderr, /APP_SECRET must be set to a non-default value in production/);
  assert.match(tooShort.stderr, /at least 32 characters/);
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

test("standalone Compose publishes cleartext HTTP on loopback only", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");

  assert.match(compose, /127\.0\.0\.1:\$\{HTTP_PORT:-8080\}:80/);
  assert.doesNotMatch(compose, /^\s*-\s*"?\$\{HTTP_PORT:-8080\}:80"?\s*$/m);
});

test("release publishing requires full immutable commit pins", async () => {
  const { isPinnedGitCommit, requireReleasePins } = await import("../dist/server/server/releases.js");
  const validCommit = "a".repeat(40);
  const settings = {
    goZenonCommit: validCommit,
    deploymentCommit: validCommit
  };

  assert.equal(isPinnedGitCommit(validCommit), true);
  assert.equal(isPinnedGitCommit("main"), false);
  assert.doesNotThrow(() => requireReleasePins(settings));
  assert.throws(() => requireReleasePins({ ...settings, goZenonCommit: undefined }), /go-zenon/);
  assert.throws(() => requireReleasePins({ ...settings, deploymentCommit: undefined }), /deployment/);
});

test("production bootstrap URLs use one validated canonical origin", async () => {
  const { configuredPublicOrigin } = await import("../dist/server/server/origin.js");

  assert.throws(() => configuredPublicOrigin({ NODE_ENV: "production" }), /must be set/);
  assert.throws(
    () => configuredPublicOrigin({ NODE_ENV: "production", PUBLIC_BASE_URL: "http://testnet.example" }),
    /must use HTTPS/
  );
  assert.throws(
    () => configuredPublicOrigin({ NODE_ENV: "production", PUBLIC_BASE_URL: "https://testnet.example/path" }),
    /without credentials, path, query, or fragment/
  );
  assert.equal(
    configuredPublicOrigin({ NODE_ENV: "production", PUBLIC_BASE_URL: "https://testnet.example" }),
    "https://testnet.example"
  );
  assert.equal(
    configuredPublicOrigin({ NODE_ENV: "production", PUBLIC_BASE_URL: "http://127.0.0.1:8080" }),
    "http://127.0.0.1:8080"
  );
});

test("login attempt controls apply progressive delays, lockout, and a memory bound", async () => {
  const { LoginAttemptLimiter } = await import("../dist/server/server/login-rate-limit.js");
  const limiter = new LoginAttemptLimiter({
    maxAttempts: 3,
    windowMs: 5000,
    lockoutMs: 1000,
    baseDelayMs: 100,
    maxDelayMs: 400,
    maxEntries: 2
  });

  assert.equal(limiter.recordAttempt("account-a", 0), 100);
  assert.equal(limiter.retryAfterMs("account-a", 50), 50);
  assert.equal(limiter.recordAttempt("account-a", 100), 200);
  assert.equal(limiter.recordAttempt("account-a", 300), 1000);
  assert.equal(limiter.retryAfterMs("account-a", 1200), 100);
  limiter.success("account-a");
  assert.equal(limiter.retryAfterMs("account-a", 1200), 0);

  limiter.recordAttempt("account-a", 2000);
  limiter.recordAttempt("account-b", 2000);
  limiter.recordAttempt("account-c", 2000);
  assert.equal(limiter.size, 2);
  assert.equal(limiter.retryAfterMs("account-a", 2001), 0);
});

test("seed probing rejects local network targets and disables redirects", async () => {
  const { validateSeedProbeIp } = await import("../dist/server/server/seeders.js");
  const source = await readFile("src/server/seeders.ts", "utf8");

  assert.equal(validateSeedProbeIp("8.8.8.8"), true);
  assert.equal(validateSeedProbeIp("2606:4700:4700::1111"), true);
  assert.equal(validateSeedProbeIp("127.0.0.1"), false);
  assert.equal(validateSeedProbeIp("10.0.0.1"), false);
  assert.equal(validateSeedProbeIp("169.254.169.254"), false);
  assert.equal(validateSeedProbeIp("::1"), false);
  assert.equal(validateSeedProbeIp("fe80::1"), false);
  assert.match(source, /redirect: "error"/);
});

test("runtime container and browser assets use least-privilege local defaults", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  const styles = await readFile("src/web/styles.css", "utf8");

  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /install -d -o node -g node -m 700 \/app\/data/);
  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(dockerfile, /RUN npm install/);
  assert.doesNotMatch(styles, /fonts\.googleapis\.com/);
  assert.doesNotMatch(styles, /Space Grotesk|JetBrains Mono/);
});

test("patched transitive dependencies remain explicitly pinned", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));

  assert.equal(manifest.dependencies["@vitejs/plugin-react"], undefined);
  assert.ok(manifest.devDependencies["@vitejs/plugin-react"]);
  assert.deepEqual(manifest.overrides, {
    "body-parser": "1.20.6",
    nanoid: "3.3.18",
    postcss: "8.5.26",
    ws: "8.21.3"
  });
  assert.equal(lock.packages["node_modules/body-parser"].version, "1.20.6");
  assert.equal(lock.packages["node_modules/nanoid"].version, "3.3.18");
  assert.equal(lock.packages["node_modules/postcss"].version, "8.5.26");
  assert.equal(lock.packages["node_modules/ws"].version, "8.21.3");
});

test("bootstrap agent verifies pinned repositories before local deployment", async () => {
  process.env.APP_SECRET = SYNTHETIC_SECRET;
  const { bootstrapInstallScript } = await import("../dist/server/server/index.js");
  const script = bootstrapInstallScript("https://testnet.invalid");
  const syntax = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });

  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(script, /clone_pinned_repository "\$deployment_repo" "\$deployment_ref" "\$deployment_commit"/);
  assert.match(script, /clone_pinned_repository "\$go_repo" "\$go_ref" "\$go_commit"/);
  assert.match(script, /rev-parse HEAD/);
  assert.match(script, /file:\/\/\$PINNED_GO_SOURCE_DIR/);
  assert.doesNotMatch(script, /git clone --depth 1 --branch "\$deployment_ref"/);
  assert.doesNotMatch(script, /zenon\.sh --deploy zenon "\$go_repo" "\$go_ref"/);
});

test("enrollment is single-use and secret-download authority is short-lived", async () => {
  process.env.APP_SECRET = SYNTHETIC_SECRET;
  const {
    activeEnrollment,
    clearSecretDownloadToken,
    consumeEnrollment,
    createNodeCredentialFields,
    ensureNodeCredentialFields,
    rotateNodeCredentials,
    secretDownloadMatches
  } = await import("../dist/server/server/credentials.js");
  const { sha256 } = await import("../dist/server/server/crypto.js");
  const now = new Date("2026-08-23T12:00:00.000Z");
  const record = { ...createNodeCredentialFields(now) };
  const enrollment = activeEnrollment(record, now);

  assert.ok(enrollment);
  const credentials = consumeEnrollment(record, enrollment.token, now);
  assert.equal(activeEnrollment(record, now), undefined);
  assert.equal(record.statusTokenHash, sha256(credentials.statusToken));
  assert.equal(secretDownloadMatches(record, sha256(credentials.secretToken), new Date(now.getTime() + 60_000)), true);
  assert.equal(secretDownloadMatches(record, sha256(credentials.secretToken), new Date(now.getTime() + 31 * 60_000)), false);
  assert.throws(() => consumeEnrollment(record, enrollment.token, now), /already used/);

  ensureNodeCredentialFields(record);
  assert.equal(activeEnrollment(record, now), undefined);
  clearSecretDownloadToken(record);
  assert.equal(secretDownloadMatches(record, sha256(credentials.secretToken), now), false);

  const rotated = rotateNodeCredentials(record);
  assert.ok(rotated.token);
  assert.notEqual(rotated.token, enrollment.token);
});

test("bootstrap credentials stay out of command arguments and persistent cron values", async () => {
  process.env.APP_SECRET = SYNTHETIC_SECRET;
  const { bootstrapInstallScript } = await import("../dist/server/server/index.js");
  const script = bootstrapInstallScript("https://testnet.invalid");
  const frontend = await readFile("src/web/App.tsx", "utf8");
  const server = await readFile("src/server/index.ts", "utf8");

  assert.doesNotMatch(frontend, /sudo env ZNN_BOOTSTRAP_TOKEN=/);
  assert.match(frontend, /read -rsp 'Enrollment token: '/);
  assert.match(frontend, /sudo install -m 600 \/dev\/stdin/);
  assert.doesNotMatch(script, /ZNN_BOOTSTRAP_TOKEN=/);
  assert.match(script, /ZNN_CREDENTIAL_DIR=/);
  assert.match(script, /curl_with_token/);
  assert.match(script, /secret_get "\$producer_url"/);
  assert.match(script, /secret_get "\$network_private_key_url"/);
  assert.equal((server.match(/withSecretDownloadNode\(request, response/g) ?? []).length, 3);
});

test("node config omits producer passwords unless explicitly packaging them", async () => {
  process.env.APP_SECRET = SYNTHETIC_SECRET;
  const { buildNodeConfig } = await import("../dist/server/server/genesis.js");
  const settings = { minPillars: 4, expectedPillars: 4, seeders: [], bootstrapPeers: [] };
  const pillar = {
    pillarName: "synthetic-pillar",
    producerIndex: 0,
    producerWallet: { address: "synthetic-address" }
  };

  const deploymentConfig = buildNodeConfig(settings, pillar);
  const packageConfig = buildNodeConfig(settings, pillar, "synthetic-producer-password");
  assert.equal("Password" in deploymentConfig.Producer, false);
  assert.equal(packageConfig.Producer.Password, "synthetic-producer-password");
});

test("HTTP enrollment exchange scopes and revokes secret downloads", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "testnet-enrollment-api-"));
  const port = await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const selectedPort = typeof address === "object" && address ? address.port : 0;
      listener.close((error) => (error ? reject(error) : resolve(selectedPort)));
    });
  });
  const environment = {
    ...process.env,
    APP_SECRET: SYNTHETIC_SECRET,
    DATA_DIR: dataDir,
    NODE_ENV: "production",
    COOKIE_SECURE: "true",
    PORT: String(port),
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`
  };

  const setup = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'const {createAccount}=await import("./dist/server/server/accounts.js"); await createAccount("synthetic-operator","user","synthetic-password"); await createAccount("synthetic-admin","admin","synthetic-admin-password");'
    ],
    { cwd: process.cwd(), env: environment, encoding: "utf8" }
  );
  assert.equal(setup.status, 0, setup.stderr);

  const server = spawn(process.execPath, ["dist/server/server/index.js"], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => {
    serverError += String(chunk);
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const health = await fetch(`${baseUrl}/api/health`);
        if (health.ok) {
          ready = true;
          break;
        }
      } catch {
        // The child process is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, serverError);

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), true);
    assert.equal(healthResponse.headers.get("referrer-policy"), "no-referrer");
    assert.equal(healthResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(healthResponse.headers.get("x-frame-options"), "DENY");
    assert.equal(healthResponse.headers.get("strict-transport-security"), "max-age=31536000");

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "synthetic-operator", password: "synthetic-password" })
    });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const registration = await fetch(`${baseUrl}/api/pillar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ nodeType: "pillar", pillarName: "synthetic-pillar" })
    });
    assert.equal(registration.status, 201);

    const overviewResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    const overview = await overviewResponse.json();
    const enrollmentToken = overview.bootstrap?.enrollment?.token;
    assert.ok(enrollmentToken);

    const enrollmentResponse = await fetch(`${baseUrl}/api/bootstrap/enroll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${enrollmentToken}` }
    });
    assert.equal(enrollmentResponse.status, 200);
    const credentials = await enrollmentResponse.json();
    assert.ok(credentials.statusToken);
    assert.ok(credentials.secretToken);

    const statusTokenSecretRead = await fetch(`${baseUrl}/api/bootstrap/producer.json`, {
      headers: { Authorization: `Bearer ${credentials.statusToken}` }
    });
    assert.equal(statusTokenSecretRead.status, 401);

    const shortLivedSecretRead = await fetch(`${baseUrl}/api/bootstrap/producer.json`, {
      headers: { Authorization: `Bearer ${credentials.secretToken}` }
    });
    assert.equal(shortLivedSecretRead.status, 200);

    const reusedEnrollment = await fetch(`${baseUrl}/api/bootstrap/enroll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${enrollmentToken}` }
    });
    assert.equal(reusedEnrollment.status, 401);

    const completion = await fetch(`${baseUrl}/api/bootstrap/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.statusToken}` }
    });
    assert.equal(completion.status, 200);

    const revokedSecretRead = await fetch(`${baseUrl}/api/bootstrap/producer.json`, {
      headers: { Authorization: `Bearer ${credentials.secretToken}` }
    });
    assert.equal(revokedSecretRead.status, 401);

    const consumedOverviewResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    const consumedOverview = await consumedOverviewResponse.json();
    assert.equal(consumedOverview.bootstrap?.enrollment, undefined);

    const rotationResponse = await fetch(`${baseUrl}/api/bootstrap/enrollment-token`, {
      method: "POST",
      headers: { Cookie: cookie }
    });
    assert.equal(rotationResponse.status, 200);
    const rotation = await rotationResponse.json();
    assert.ok(rotation.enrollment?.token);
    assert.notEqual(rotation.enrollment.token, enrollmentToken);

    const revokedStatus = await fetch(`${baseUrl}/api/bootstrap/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.statusToken}` }
    });
    assert.equal(revokedStatus.status, 401);

    const adminLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "synthetic-admin", password: "synthetic-admin-password" })
    });
    assert.equal(adminLoginResponse.status, 200);
    const adminCookie = adminLoginResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(adminCookie);

    const protectedDownload = await fetch(`${baseUrl}/api/admin/config-template.json`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(protectedDownload.status, 200);
    assert.equal(protectedDownload.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(protectedDownload.headers.get("pragma"), "no-cache");
    assert.equal(protectedDownload.headers.get("x-content-type-options"), "nosniff");

    const failedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "synthetic-missing-user", password: "synthetic-wrong-password" })
    });
    assert.equal(failedLogin.status, 401);
    const throttledLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "synthetic-missing-user", password: "synthetic-wrong-password" })
    });
    assert.equal(throttledLogin.status, 429);
    assert.ok(Number(throttledLogin.headers.get("retry-after")) >= 1);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
