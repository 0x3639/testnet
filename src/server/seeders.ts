import { isIP } from "node:net";
import { enodeFromPublicKey, multiaddrFromPublicKey, normalizePublicKey } from "./libp2p.js";
import type { SeedNodeProbeResult } from "../shared/types.js";

interface SeedNodeProbeInput {
  ip: string;
  rpcPort: number;
  p2pPort: number;
}

interface JsonRpcResponse {
  error?: {
    code?: number;
    message?: string;
  };
  result?: unknown;
}

function hostForUrl(ip: string): string {
  return isIP(ip) === 6 ? `[${ip}]` : ip;
}

function readPublicKey(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new Error("Seed RPC returned an invalid stats.networkInfo result");
  }

  const self = (result as { self?: unknown }).self;
  if (!self || typeof self !== "object") {
    throw new Error("Seed RPC response did not include self node information");
  }

  const rawPublicKey = (self as { publicKey?: unknown }).publicKey;
  if (typeof rawPublicKey !== "string") {
    throw new Error("Seed RPC response did not include a node public key");
  }

  try {
    return normalizePublicKey(rawPublicKey);
  } catch {
    throw new Error("Seed RPC returned a public key that is not a valid enode key");
  }
}

export function validateSeedNodeIp(ip: string): boolean {
  return isIP(ip.trim()) !== 0;
}

export async function probeSeedNode(input: SeedNodeProbeInput): Promise<SeedNodeProbeResult> {
  const ip = input.ip.trim();
  if (!validateSeedNodeIp(ip)) {
    throw new Error("Seed node must be an IP address");
  }

  const rpcUrl = `http://${hostForUrl(ip)}:${input.rpcPort}`;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "stats.networkInfo",
      params: []
    }),
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Seed RPC returned HTTP ${response.status}`);
  }

  const json = (await response.json()) as JsonRpcResponse;
  if (json.error) {
    throw new Error(json.error.message ?? `Seed RPC returned error ${json.error.code ?? ""}`.trim());
  }

  const publicKey = readPublicKey(json.result);
  const enode = enodeFromPublicKey(ip, input.p2pPort, publicKey);
  const multiaddr = multiaddrFromPublicKey(ip, input.p2pPort, publicKey);

  return {
    ip,
    rpcPort: input.rpcPort,
    p2pPort: input.p2pPort,
    publicKey,
    enode,
    multiaddr
  };
}
