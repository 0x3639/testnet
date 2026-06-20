import { createECDH, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const BASE_URL = process.env.BUILDER_URL ?? "http://127.0.0.1:8080";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin-pass-123";
const OUT_DIR = path.resolve("devnet", "four-node");
const DEVNET_DIR = path.join(OUT_DIR, "devnet");
const OPERATORS_DIR = path.join(OUT_DIR, "operators");
const CHAIN_IDENTIFIER = 69;
const EXTRA_DATA = "LOCAL DEV-NET";
const DECIMALS = 100000000;
const ZNN_ZTS = "zts1znnxxxxxxxxxxxxx9z4ulx";
const QSR_ZTS = "zts1qsrxxxxxxxxxxxxxmrhjll";
const PILLAR_CONTRACT = "z1qxemdeddedxpyllarxxxxxxxxxxxxxxxsy3fmg";
const PLASMA_CONTRACT = "z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp";

const seedNode = { role: "seed", ip: "10.88.0.9", httpPort: 36000, wsPort: 36100 };

const roles = [
  { role: "pillar", pillarName: "dev1", username: "devnet-node-1", ip: "10.88.0.10", httpPort: 36001, wsPort: 36101 },
  { role: "pillar2", pillarName: "dev2", username: "devnet-node-2", ip: "10.88.0.11", httpPort: 36002, wsPort: 36102 },
  { role: "pillar3", pillarName: "dev3", username: "devnet-node-3", ip: "10.88.0.12", httpPort: 36003, wsPort: 36103 },
  { role: "pillar4", pillarName: "dev4", username: "devnet-node-4", ip: "10.88.0.13", httpPort: 36004, wsPort: 36104 }
];

function randomPassword() {
  return randomBytes(18).toString("base64url");
}

function generateNodeKey() {
  const ecdh = createECDH("secp256k1");
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey("hex").padStart(64, "0");
  const publicKey = ecdh.getPublicKey("hex", "uncompressed").slice(2);
  if (!/^[0-9a-f]{64}$/i.test(privateKey) || !/^[0-9a-f]{128}$/i.test(publicKey)) {
    throw new Error("Generated an invalid secp256k1 node key");
  }
  return { privateKey, publicKey };
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function request(pathname, options = {}, cookie = "") {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers ?? {})
    }
  });
  const setCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${pathname}: ${body?.error ?? response.statusText}`);
  }
  return { body, cookie: setCookie };
}

async function login(username, password) {
  const result = await request(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password })
    },
    ""
  );
  return result.cookie;
}

async function maybeDeleteAdminRecords(adminCookie) {
  let overview = (await request("/api/admin/overview", {}, adminCookie)).body;
  for (const pillar of overview.pillars.filter((item) => roles.some((role) => role.pillarName === item.pillarName))) {
    await request(`/api/admin/pillars/${pillar.id}`, { method: "DELETE" }, adminCookie);
  }

  overview = (await request("/api/admin/overview", {}, adminCookie)).body;
  for (const user of overview.users.filter((item) => roles.some((role) => role.username === item.username))) {
    await request(`/api/admin/users/${user.id}`, { method: "DELETE" }, adminCookie);
  }
}

function nodeConfigFromPackage(config, role) {
  return {
    ...config,
    DataPath: "/root/.znn",
    WalletPath: "/root/.znn/wallet",
    GenesisFile: "/root/.znn/genesis.json",
    Name: `devnet-${role.role}`,
    Producer: {
      ...config.Producer,
      KeyFilePath: "producer.json"
    },
    RPC: {
      ...config.RPC,
      HTTPHost: "0.0.0.0",
      HTTPPort: 35997,
      WSHost: "0.0.0.0",
      WSPort: 35998,
      HTTPVirtualHosts: ["*"],
      HTTPCors: ["*"],
      WSOrigins: ["*"],
      Endpoints: ["ledger", "stats", "embedded", "subscribe"]
    },
    Net: {
      ...config.Net,
      ListenHost: "0.0.0.0",
      ListenPort: 35995,
      MinPeers: 3,
      MinConnectedPeers: 3,
      MaxPeers: 8,
      MaxPendingPeers: 4,
      Seeders: [seedNode.enode, ...roles.filter((candidate) => candidate.role !== role.role).map((candidate) => candidate.enode)]
    }
  };
}

function seedNodeConfig() {
  return {
    DataPath: "/root/.znn",
    WalletPath: "/root/.znn/wallet",
    GenesisFile: "/root/.znn/genesis.json",
    Name: "devnet-seed",
    LogLevel: "info",
    RPC: {
      EnableHTTP: true,
      EnableWS: true,
      HTTPHost: "0.0.0.0",
      HTTPPort: 35997,
      WSHost: "0.0.0.0",
      WSPort: 35998,
      HTTPVirtualHosts: ["*"],
      HTTPCors: ["*"],
      WSOrigins: ["*"],
      Endpoints: ["ledger", "stats", "embedded", "subscribe"]
    },
    Net: {
      ListenHost: "0.0.0.0",
      ListenPort: 35995,
      MinPeers: 0,
      MinConnectedPeers: 0,
      MaxPeers: 16,
      MaxPendingPeers: 8,
      Seeders: roles.map((role) => role.enode)
    }
  };
}

function balanceFor(genesis, address) {
  return genesis.GenesisBlocks.Blocks.find((block) => block.Address === address)?.BalanceList ?? {};
}

function sumBalances(genesis, zts) {
  return genesis.GenesisBlocks.Blocks.reduce((total, block) => total + Number(block.BalanceList[zts] ?? 0), 0);
}

function validateGenesis(genesis, pillars) {
  const checks = [];
  const expect = (label, ok, detail = "") => checks.push({ label, ok, detail });
  const amount = (value) => value * DECIMALS;

  expect("chain identifier", genesis.ChainIdentifier === CHAIN_IDENTIFIER, String(genesis.ChainIdentifier));
  expect("pillar count", genesis.PillarConfig.Pillars.length === 4, String(genesis.PillarConfig.Pillars.length));
  expect("active sporks", genesis.SporkConfig.Sporks.every((spork) => spork.activated), `${genesis.SporkConfig.Sporks.filter((spork) => spork.activated).length}/${genesis.SporkConfig.Sporks.length}`);
  expect("fusion count", genesis.PlasmaConfig.Fusions.length === 12, String(genesis.PlasmaConfig.Fusions.length));
  expect("pillar stake contract", Number(balanceFor(genesis, PILLAR_CONTRACT)[ZNN_ZTS]) === amount(15000) * 4, String(balanceFor(genesis, PILLAR_CONTRACT)[ZNN_ZTS]));
  expect("plasma contract", Number(balanceFor(genesis, PLASMA_CONTRACT)[QSR_ZTS]) === amount(1000) * 12, String(balanceFor(genesis, PLASMA_CONTRACT)[QSR_ZTS]));

  for (const pillar of pillars) {
    const liquid = balanceFor(genesis, pillar.pillarAddress);
    expect(`${pillar.pillarName} liquid ZNN`, Number(liquid[ZNN_ZTS]) === amount(50000), String(liquid[ZNN_ZTS]));
    expect(`${pillar.pillarName} liquid QSR`, Number(liquid[QSR_ZTS]) === amount(500000), String(liquid[QSR_ZTS]));
    for (const address of [pillar.pillarAddress, pillar.rewardAddress, pillar.producerAddress]) {
      const fused = genesis.PlasmaConfig.Fusions.some((fusion) => fusion.beneficiaryAddress === address && Number(fusion.amount) === amount(1000));
      expect(`${pillar.pillarName} fusion ${address}`, fused);
    }
  }

  const znnToken = genesis.TokenConfig.Tokens.find((token) => token.tokenStandard === ZNN_ZTS);
  const qsrToken = genesis.TokenConfig.Tokens.find((token) => token.tokenStandard === QSR_ZTS);
  expect("ZNN token supply", Number(znnToken?.totalSupply) === sumBalances(genesis, ZNN_ZTS), `${znnToken?.totalSupply} vs ${sumBalances(genesis, ZNN_ZTS)}`);
  expect("QSR token supply", Number(qsrToken?.totalSupply) === sumBalances(genesis, QSR_ZTS), `${qsrToken?.totalSupply} vs ${sumBalances(genesis, QSR_ZTS)}`);

  return checks;
}

function validateConfigs(configs) {
  const checks = [];
  const expect = (label, ok, detail = "") => checks.push({ label, ok, detail });
  const enodePattern = /^enode:\/\/[0-9a-f]{128}@10\.88\.0\.(9|10|11|12|13):35995$/i;

  expect("seed config exists", Boolean(configs.seed));
  expect("seed has no producer", !("Producer" in configs.seed));
  expect("seed seeder count", configs.seed.Net.Seeders.length === 4, String(configs.seed.Net.Seeders.length));
  expect("seed seeder syntax", configs.seed.Net.Seeders.every((seeder) => enodePattern.test(seeder)));

  for (const role of roles) {
    const config = configs[role.role];
    expect(`${role.role} data path`, config.DataPath === "/root/.znn", config.DataPath);
    expect(`${role.role} producer keyfile`, config.Producer.KeyFilePath === "producer.json", config.Producer.KeyFilePath);
    expect(`${role.role} seeder count`, config.Net.Seeders.length === 4, String(config.Net.Seeders.length));
    expect(`${role.role} includes seed`, config.Net.Seeders[0] === seedNode.enode);
    expect(`${role.role} excludes self`, !config.Net.Seeders.includes(role.enode));
    expect(`${role.role} seeder syntax`, config.Net.Seeders.every((seeder) => enodePattern.test(seeder)));
  }

  return checks;
}

async function main() {
  const adminCookie = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  await maybeDeleteAdminRecords(adminCookie);

  seedNode.nodeKey = generateNodeKey();
  seedNode.enode = `enode://${seedNode.nodeKey.publicKey}@${seedNode.ip}:35995`;

  for (const role of roles) {
    role.password = randomPassword();
    role.nodeKey = generateNodeKey();
    role.enode = `enode://${role.nodeKey.publicKey}@${role.ip}:35995`;
    await request(
      "/api/admin/users",
      {
        method: "POST",
        body: JSON.stringify({ username: role.username, password: role.password, role: "user" })
      },
      adminCookie
    );

    const userCookie = await login(role.username, role.password);
    const created = await request(
      "/api/pillar",
      {
        method: "POST",
        body: JSON.stringify({ pillarName: role.pillarName })
      },
      userCookie
    );
    role.pillar = created.body.pillar;
    role.userCookie = userCookie;
  }

  let overview = (await request("/api/admin/overview", {}, adminCookie)).body;
  await request(
    "/api/admin/settings",
    {
      method: "PUT",
      body: JSON.stringify({
        chainIdentifier: CHAIN_IDENTIFIER,
        extraData: EXTRA_DATA,
        expectedPillars: 4,
        minPillars: 3,
        genesisTimestampSec: Math.floor(Date.now() / 1000),
        seeders: [seedNode.enode],
        sporks: overview.settings.sporks
      })
    },
    adminCookie
  );
  await request("/api/admin/finalize", { method: "POST" }, adminCookie);
  overview = (await request("/api/admin/overview", {}, adminCookie)).body;

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(DEVNET_DIR, { recursive: true });
  await mkdir(OPERATORS_DIR, { recursive: true });
  await writeFile(path.join(DEVNET_DIR, "genesis.json"), pretty(overview.genesis));

  const configs = { seed: seedNodeConfig() };
  const seedDir = path.join(DEVNET_DIR, seedNode.role);
  await mkdir(seedDir, { recursive: true });
  await writeFile(path.join(seedDir, "config.json"), pretty(configs.seed));
  await writeFile(path.join(seedDir, "network-private-key"), seedNode.nodeKey.privateKey);

  for (const role of roles) {
    const packageResponse = await request("/api/pillar/package", {}, role.userCookie);
    await writeFile(path.join(OPERATORS_DIR, `${role.pillarName}-pillar-package.zip`), packageResponse.body);

    const zip = await JSZip.loadAsync(packageResponse.body);
    const packageConfig = JSON.parse(await zip.file("config.json").async("string"));
    const producerWallet = JSON.parse(await zip.file("wallets/producer.json").async("string"));
    const config = nodeConfigFromPackage(packageConfig, role);
    configs[role.role] = config;

    const roleDir = path.join(DEVNET_DIR, role.role);
    await mkdir(path.join(roleDir, "wallet"), { recursive: true });
    await writeFile(path.join(roleDir, "config.json"), pretty(config));
    await writeFile(path.join(roleDir, "network-private-key"), role.nodeKey.privateKey);
    await writeFile(path.join(roleDir, "wallet", "producer.json"), pretty(producerWallet));
  }

  const genesisChecks = validateGenesis(overview.genesis, roles.map((role) => role.pillar));
  const configChecks = validateConfigs(configs);
  const failedChecks = [...genesisChecks, ...configChecks].filter((check) => !check.ok);

  await writeFile(
    path.join(OUT_DIR, "Dockerfile"),
    `FROM go-zenon-devnet:latest\nRUN rm -rf /devnet\nCOPY devnet /devnet\n`
  );
  await writeFile(
    path.join(OUT_DIR, "docker-compose.yml"),
    `name: zenon-generated-devnet

services:
${roles
  .concat(seedNode)
  .map(
    (role) => `  ${role.role}:
    build: .
    image: zenon-generated-devnet:latest
    container_name: zenon-generated-${role.role}
    restart: unless-stopped
    environment:
      ZNND_ROLE: ${role.role}
    ports:
      - "${role.httpPort}:35997"
      - "${role.wsPort}:35998"
    volumes:
      - ${role.role}-data:/root/.znn
    networks:
      znnd:
        ipv4_address: ${role.ip}
`
  )
  .join("\n")}
networks:
  znnd:
    driver: bridge
    ipam:
      config:
        - subnet: 10.88.0.0/24

volumes:
${roles.concat(seedNode).map((role) => `  ${role.role}-data:`).join("\n")}
`
  );
  await writeFile(
    path.join(OUT_DIR, "operator-logins.txt"),
    roles.map((role) => `${role.username}\t${role.password}\t${BASE_URL}`).join("\n") + "\n"
  );
  await writeFile(
    path.join(OUT_DIR, "summary.json"),
    pretty({
      builderUrl: BASE_URL,
      chainIdentifier: CHAIN_IDENTIFIER,
      extraData: EXTRA_DATA,
      genesisTimestampSec: overview.settings.genesisTimestampSec,
      seedNode: { role: seedNode.role, ip: seedNode.ip, httpPort: seedNode.httpPort, wsPort: seedNode.wsPort, enode: seedNode.enode },
      seeders: roles.map((role) => ({ role: role.role, ip: role.ip, enode: role.enode })),
      configuredSeeders: [seedNode.enode],
      pillars: roles.map((role) => ({
        role: role.role,
        username: role.username,
        pillarName: role.pillar.pillarName,
        pillarAddress: role.pillar.pillarAddress,
        rewardAddress: role.pillar.rewardAddress,
        producerAddress: role.pillar.producerAddress,
        httpPort: role.httpPort,
        wsPort: role.wsPort
      })),
      validation: {
        genesis: genesisChecks,
        configs: configChecks,
        ok: failedChecks.length === 0
      }
    })
  );
  await writeFile(
    path.join(OUT_DIR, "README.md"),
    `# Four Node Zenon Devnet

Generated by the Zenon Testnet Builder.

## Run

\`\`\`bash
docker compose -f devnet/four-node/docker-compose.yml up -d --build
\`\`\`

HTTP RPC ports:

- seed: http://127.0.0.1:${seedNode.httpPort}
${roles.map((role) => `- ${role.role} / ${role.pillarName}: http://127.0.0.1:${role.httpPort}`).join("\n")}

The four pillar configs use the seed node enode first, followed by the other local pillar enodes as deterministic fallback peers.

The generated operator ZIPs and login credentials are in \`operators/\` and \`operator-logins.txt\`.
Treat wallet seed phrases, wallet passwords, and network-private-key files as secret material.
`
  );

  console.log(
    JSON.stringify(
      {
        outputDir: OUT_DIR,
        seedNode: {
          role: seedNode.role,
          enode: seedNode.enode,
          httpPort: seedNode.httpPort
        },
        pillars: roles.map((role) => ({
          role: role.role,
          pillarName: role.pillar.pillarName,
          producerAddress: role.pillar.producerAddress,
          enode: role.enode,
          httpPort: role.httpPort
        })),
        validationOk: failedChecks.length === 0,
        failedChecks
      },
      null,
      2
    )
  );

  if (failedChecks.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
