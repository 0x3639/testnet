import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { BOOTSTRAP_SECRET_MAX_DOWNLOADS } from "./bootstrap-secret-limit.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureAppSecret = "fixture-app-secret-for-tests";

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function pillar(id: string, token: string) {
  const wallet = { address: "test-address", keyFile: { fixture: true }, passwordCipher: "test-cipher" };
  return {
    id,
    userId: id,
    pillarName: id,
    pillarWallet: wallet,
    rewardWallet: wallet,
    producerWallet: wallet,
    producerIndex: 0,
    statusTokenHash: createHash("sha256").update(token).digest("hex"),
    statusTokenCipher: "test-cipher",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function seed(id: string, token: string) {
  const nonce = Buffer.alloc(12, 1);
  const key = createHash("sha256").update(fixtureAppSecret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update("fixture-network-key", "utf8"), cipher.final()]);
  return {
    id,
    userId: id,
    nodeName: id,
    publicIp: "198.51.100.1",
    p2pPort: 35995,
    publicKey: "fixture-public-key",
    enode: "fixture-enode",
    multiaddr: "/ip4/198.51.100.1/tcp/35995",
    networkPrivateKeyCipher: `${nonce.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`,
    statusTokenHash: createHash("sha256").update(token).digest("hex"),
    statusTokenCipher: "test-cipher",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

it("bounds authenticated secret routes by node token without charging invalid or wrong-type requests", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "testnet-secret-http-"));
  try {
    const token = "fixture-pillar-token";
    const otherToken = "fixture-other-token";
    const seedToken = "fixture-seed-token";
    const state = {
      users: [],
      sessions: [],
      pillars: [pillar("pillar-one", token), pillar("pillar-two", otherToken)],
      seedNodes: [seed("seed-one", seedToken)],
      settings: {
        sporkAddress: "test-spork-address",
        sporkWallet: { address: "test-spork-address", keyFile: {}, passwordCipher: "test-cipher" }
      }
    };
    await writeFile(path.join(dataDir, "app-state.json"), JSON.stringify(state), { mode: 0o600 });

    const port = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
      cwd: repoRoot,
      env: { ...process.env, APP_SECRET: fixtureAppSecret, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });

    const get = (route: string, bearer?: string) => fetch(`${origin}${route}`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}
    });

    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error(`Server exited before readiness: ${output}`);
        try {
          const health = await get("/api/health");
          if (health.ok) { ready = true; break; }
        } catch { /* Wait for startup. */ }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(ready, `Server did not become ready: ${output}`);

      assert.equal((await get("/api/bootstrap/producer.json")).status, 401);
      assert.equal((await get("/api/bootstrap/producer.json", "invalid-token")).status, 401);
      assert.equal((await get("/api/bootstrap/network-private-key", token)).status, 404);

      for (let index = 0; index < BOOTSTRAP_SECRET_MAX_DOWNLOADS; index += 1) {
        assert.equal((await get("/api/bootstrap/producer.json", token)).status, 200);
      }
      const blocked = await get("/api/bootstrap/producer-password.txt", token);
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
      assert.match(blocked.headers.get("cache-control") ?? "", /no-store/);
      assert.equal((await get("/api/bootstrap/producer.json", otherToken)).status, 200);

      assert.equal((await get("/api/bootstrap/producer.json", seedToken)).status, 404);
      for (let index = 0; index < BOOTSTRAP_SECRET_MAX_DOWNLOADS; index += 1) {
        assert.equal((await get("/api/bootstrap/network-private-key", seedToken)).status, 200);
      }
      const blockedSeed = await get("/api/bootstrap/network-private-key", seedToken);
      assert.equal(blockedSeed.status, 429);
      assert.ok(Number(blockedSeed.headers.get("retry-after")) > 0);
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
