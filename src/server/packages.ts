import JSZip from "jszip";
import { KeyFile } from "znn-typescript-sdk";
import { decryptText } from "./crypto.js";
import { buildNodeConfig } from "./genesis.js";
import type { NetworkSettings, PillarRecord, StoredWallet } from "../shared/types.js";

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function walletPassword(wallet: StoredWallet): string {
  return decryptText(wallet.passwordCipher);
}

function statusToken(pillar: PillarRecord): string {
  return pillar.statusTokenCipher ? decryptText(pillar.statusTokenCipher) : "";
}

async function walletSeedWords(wallet: StoredWallet): Promise<string> {
  const keyStore = await KeyFile.setPassword(walletPassword(wallet)).decrypt(wallet.keyFile as never);
  return keyStore.mnemonic;
}

export async function buildPillarPackage(settings: NetworkSettings, pillar: PillarRecord): Promise<Buffer> {
  const zip = new JSZip();
  const producerPassword = walletPassword(pillar.producerWallet);
  const nodeStatusToken = statusToken(pillar);
  const [producerSeedWords, pillarSeedWords, rewardSeedWords] = await Promise.all([
    walletSeedWords(pillar.producerWallet),
    walletSeedWords(pillar.pillarWallet),
    walletSeedWords(pillar.rewardWallet)
  ]);

  zip.file(
    "pillar-info.json",
    pretty({
      pillarName: pillar.pillarName,
      pillarAddress: pillar.pillarWallet.address,
      rewardAddress: pillar.rewardWallet.address,
      producerAddress: pillar.producerWallet.address,
      producerIndex: pillar.producerIndex,
      nodeStatus: {
        endpoint: "/api/bootstrap/status",
        tokenFile: "node/status-token.txt",
        interval: "1 minute"
      },
      allocations: {
        pillarAddress: {
          znn: "50000",
          qsr: "500000"
        },
        fusedPlasma: {
          producerAddressQsr: "1000",
          pillarAddressQsr: "1000",
          rewardAddressQsr: "1000"
        }
      }
    })
  );

  zip.file("config.json", pretty(buildNodeConfig(settings, pillar, producerPassword)));

  zip.file("wallets/producer.json", pretty(pillar.producerWallet.keyFile));
  zip.file("wallets/producer-password.txt", `${producerPassword}\n`);
  zip.file("wallets/producer-seed-words.txt", `${producerSeedWords}\n`);
  zip.file("wallets/pillar.json", pretty(pillar.pillarWallet.keyFile));
  zip.file("wallets/pillar-password.txt", `${walletPassword(pillar.pillarWallet)}\n`);
  zip.file("wallets/pillar-seed-words.txt", `${pillarSeedWords}\n`);
  zip.file("wallets/reward.json", pretty(pillar.rewardWallet.keyFile));
  zip.file("wallets/reward-password.txt", `${walletPassword(pillar.rewardWallet)}\n`);
  zip.file("wallets/reward-seed-words.txt", `${rewardSeedWords}\n`);
  zip.file("node/status-token.txt", `${nodeStatusToken}\n`);
  zip.file(
    "node/status-report-example.sh",
    `#!/usr/bin/env bash
set -euo pipefail

BASE_URL="\${BASE_URL:-https://testnet.example.com}"
TOKEN="\${ZNN_STATUS_TOKEN:-$(cat ./node/status-token.txt)}"

curl -fsS -X POST "$BASE_URL/api/bootstrap/status" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "node": {
      "hostname": "'"$(hostname)"'",
      "serviceActive": true
    },
    "sync": {
      "state": 2,
      "currentHeight": 0,
      "targetHeight": 0
    },
    "network": {
      "peerCount": 0
    },
    "logs": {
      "errorCountLastMinute": 0,
      "warningCountLastMinute": 0,
      "recent": []
    }
  }'
`
  );
  zip.file(
    "wallets/seed-words.json",
    pretty({
      producer: {
        address: pillar.producerWallet.address,
        seedWords: producerSeedWords
      },
      pillar: {
        address: pillar.pillarWallet.address,
        seedWords: pillarSeedWords
      },
      reward: {
        address: pillar.rewardWallet.address,
        seedWords: rewardSeedWords
      }
    })
  );

  zip.file(
    "README.md",
    `# ${pillar.pillarName} Pillar Package

Copy \`wallets/producer.json\` to the path referenced by \`config.json\`:

\`\`\`
/var/lib/znn/wallet/producer.json
\`\`\`

The final network \`genesis.json\` is provided by the testnet admin after registration closes.
Keep every password and seed phrase in this package private.
`
  );

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function buildSporkPackage(settings: NetworkSettings): Promise<Buffer> {
  const zip = new JSZip();
  if (!settings.sporkWallet) {
    zip.file("README.md", "No spork wallet has been generated yet.\n");
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }

  zip.file("spork-wallet.json", pretty(settings.sporkWallet.keyFile));
  zip.file("spork-password.txt", `${walletPassword(settings.sporkWallet)}\n`);
  zip.file("spork-seed-words.txt", `${await walletSeedWords(settings.sporkWallet)}\n`);
  zip.file(
    "README.md",
    `# Testnet Spork Wallet

Address: ${settings.sporkAddress}

This wallet controls spork creation and activation for the generated testnet.
Keep the password and seed phrase private.
`
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
