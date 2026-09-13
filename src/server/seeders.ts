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

function parseIpv4(ip: string): number[] | undefined {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return parts;
}

function isPublicIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0) return false; // 0.0.0.0/8 "this" network
  if (a === 10) return false; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 carrier-grade NAT
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private, Docker bridges
  if (a === 192 && b === 0 && octets[2] === 0) return false; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && octets[2] === 2) return false; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && octets[2] === 99) return false; // 192.88.99.0/24 deprecated 6to4 relay anycast
  if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function expandIpv6(ip: string): number[] | undefined {
  // Returns the eight 16-bit groups of an IPv6 address, or undefined if it cannot be parsed.
  let address = ip;
  let embeddedIpv4: number[] | undefined;
  const lastColon = address.lastIndexOf(":");
  if (address.includes(".") && lastColon >= 0) {
    embeddedIpv4 = parseIpv4(address.slice(lastColon + 1));
    if (!embeddedIpv4) return undefined;
    address = `${address.slice(0, lastColon + 1)}${((embeddedIpv4[0] << 8) | embeddedIpv4[1]).toString(16)}:${(
      (embeddedIpv4[2] << 8) |
      embeddedIpv4[3]
    ).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail].map((group) => Number.parseInt(group, 16));
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return undefined;
  return groups;
}

function isPublicIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return false;
  const [g0, g1, g2, , , , g6, g7] = groups;
  const embeddedIpv4 = () => `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  // Fail closed: IANA allocates global unicast only from 2000::/3. Everything outside it
  // (unspecified, loopback, IPv4-mapped/compatible/translated, NAT64 (well-known and local-use),
  // unique-local, link-local, multicast, discard-only, and unallocated space) is rejected.
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && g1 === 0x0000) return false; // 2001::/32 Teredo (tunnels an obfuscated IPv4 address)
  if (g0 === 0x2001 && g1 === 0x0002 && g2 === 0) return false; // 2001:2::/48 benchmarking
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0010) return false; // 2001:10::/28 ORCHID
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0020) return false; // 2001:20::/28 ORCHIDv2
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g0 === 0x2002) return isPublicIpv4(`${g1 >> 8}.${g1 & 0xff}.${g2 >> 8}.${g2 & 0xff}`); // 2002::/16 6to4
  if (g0 === 0x3fff) return false; // 3fff::/20 documentation
  void embeddedIpv4;
  return true;
}

/**
 * True only for globally routable unicast addresses. Used to keep server-side probes from
 * reaching loopback, private, link-local, or cloud metadata addresses (SSRF).
 */
export function isPublicIp(ip: string): boolean {
  const trimmed = ip.trim();
  const version = isIP(trimmed);
  if (version === 4) return isPublicIpv4(trimmed);
  if (version === 6) return isPublicIpv6(trimmed);
  return false;
}

export async function probeSeedNode(input: SeedNodeProbeInput): Promise<SeedNodeProbeResult> {
  const ip = input.ip.trim();
  if (!validateSeedNodeIp(ip)) {
    throw new Error("Seed node must be an IP address");
  }
  if (!isPublicIp(ip)) {
    throw new Error("Seed node must have a public IP address; loopback, private, and link-local addresses cannot be probed");
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
    // Never follow redirects: the destination was validated as a public IP and a redirect could
    // point anywhere, including loopback or metadata addresses.
    redirect: "error",
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
