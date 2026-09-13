import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublicIp } from "./seeders.js";

describe("isPublicIp", () => {
  it("accepts globally routable addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "203.0.114.1", "2606:4700::1111", "2a00:1450:4001::1", "2002:0808:0808::"]) {
      assert.equal(isPublicIp(ip), true, ip);
    }
  });

  it("rejects loopback, private, link-local, special-purpose, and non-global IPv4", () => {
    const rejected = [
      "0.0.0.0", "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.255.255",
      "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.88.99.1",
      "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.9", "224.0.0.1",
      "240.0.0.1", "255.255.255.255", "not-an-ip", "1.2.3", "1.2.3.4.5"
    ];
    for (const ip of rejected) assert.equal(isPublicIp(ip), false, ip);
  });

  it("rejects non-global IPv6 including translation and tunnel prefixes", () => {
    const rejected = [
      "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:0:127.0.0.1", "::127.0.0.1",
      "64:ff9b::7f00:1", "64:ff9b::127.0.0.1", "64:ff9b:1:7f00:1::", "64:ff9b:1::1",
      "fc00::1", "fd00::1", "fe80::1", "febf::1", "ff02::1", "100::1",
      "2001::1", "2001:0:1::1", "2001:2::1", "2001:10::1", "2001:1f::1", "2001:20::1", "2001:2f::1",
      "2001:db8::1", "2002:7f00:1::", "2002:0a00:1::", "3fff::1", "5f00::1", "4000::1"
    ];
    for (const ip of rejected) assert.equal(isPublicIp(ip), false, ip);
  });
});
