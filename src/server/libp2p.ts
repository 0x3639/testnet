import { isIP } from "node:net";

const PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{128}$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btc(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const digits = [0];
  for (let index = zeros; index < bytes.length; index += 1) {
    let carry = bytes[index];
    for (let digitIndex = 0; digitIndex < digits.length; digitIndex += 1) {
      carry += digits[digitIndex] << 8;
      digits[digitIndex] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = "1".repeat(zeros);
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    output += BASE58_ALPHABET[digits[index]];
  }
  return output;
}

export function normalizePublicKey(publicKey: string): string {
  const normalized = publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;
  if (!PUBLIC_KEY_PATTERN.test(normalized)) {
    throw new Error("Node public key must be a 128-character secp256k1 public key");
  }
  return normalized.toLowerCase();
}

export function hostForEnode(ip: string): string {
  return isIP(ip) === 6 ? `[${ip}]` : ip;
}

export function enodeFromPublicKey(ip: string, p2pPort: number, publicKey: string): string {
  return `enode://${normalizePublicKey(publicKey)}@${hostForEnode(ip)}:${p2pPort}`;
}

export function libp2pPeerIdFromPublicKey(publicKey: string): string {
  const normalized = normalizePublicKey(publicKey);
  const x = normalized.slice(0, 64);
  const yIsOdd = Number.parseInt(normalized.slice(126, 128), 16) % 2 === 1;
  const compressed = Buffer.from(`${yIsOdd ? "03" : "02"}${x}`, "hex");
  const proto = Buffer.concat([
    Buffer.from([0x08, 0x02, 0x12, compressed.length]),
    compressed
  ]);
  const multihash = Buffer.concat([Buffer.from([0x00, proto.length]), proto]);
  return base58btc(multihash);
}

export function multiaddrFromPublicKey(ip: string, p2pPort: number, publicKey: string): string {
  const trimmedIp = ip.trim();
  const protocol = isIP(trimmedIp);
  if (protocol !== 4 && protocol !== 6) {
    throw new Error("Bootstrap peer multiaddr requires an IPv4 or IPv6 address");
  }
  return `/${protocol === 6 ? "ip6" : "ip4"}/${trimmedIp}/tcp/${p2pPort}/p2p/${libp2pPeerIdFromPublicKey(publicKey)}`;
}

export function multiaddrFromEnode(enode: string): string | undefined {
  const match = /^enode:\/\/([0-9a-fA-F]{128})@(\[[^\]]+\]|[^:]+):(\d+)$/.exec(enode.trim());
  if (!match) return undefined;

  const host = match[2].startsWith("[") && match[2].endsWith("]") ? match[2].slice(1, -1) : match[2];
  const port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  if (!isIP(host)) return undefined;
  return multiaddrFromPublicKey(host, port, match[1]);
}

