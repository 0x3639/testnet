import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPORKS, DEFAULT_SPORKS_VERSION } from "./constants.js";
import { mergeDefaultSporks } from "./storage.js";

// Placeholder spork IDs compiled into go-zenon common/types/spork.go.
// Nodes select a feature by ID, never by name, so these must match exactly.
const LIBP2P_SPORK_ID = "0000000000000000000000000000000000000000000000000000000000000001";
const DYNAMIC_PLASMA_SPORK_ID = "0000000000000000000000000000000000000000000000000000000000000002";

describe("default sporks", () => {
  it("assigns the go-zenon DynamicPlasmaSpork ID to the dynamic-plasma record", () => {
    const spork = DEFAULT_SPORKS.find((entry) => entry.name === "dynamic-plasma");
    assert.equal(spork?.id, DYNAMIC_PLASMA_SPORK_ID);
  });

  it("assigns the go-zenon Libp2pSpork ID to the libp2p record", () => {
    const spork = DEFAULT_SPORKS.find((entry) => entry.name === "libp2p");
    assert.equal(spork?.id, LIBP2P_SPORK_ID);
  });
});

describe("mergeDefaultSporks", () => {
  const swappedDraft = [
    { id: LIBP2P_SPORK_ID, name: "dynamic-plasma", description: "Activates Dynamic Plasma", activated: true, enforcementHeight: 10 },
    { id: DYNAMIC_PLASMA_SPORK_ID, name: "libp2p", description: "Activates the libp2p networking stack", activated: false, enforcementHeight: 20 }
  ];

  it("repairs the swapped IDs of a version-2 draft while keeping each record's activation and height", () => {
    const sporks = mergeDefaultSporks(swappedDraft, 2);
    const dynamicPlasma = sporks.find((entry) => entry.name === "dynamic-plasma");
    const libp2p = sporks.find((entry) => entry.name === "libp2p");
    assert.deepEqual(dynamicPlasma, { ...swappedDraft[0], id: DYNAMIC_PLASMA_SPORK_ID });
    assert.deepEqual(libp2p, { ...swappedDraft[1], id: LIBP2P_SPORK_ID });
  });

  it("still appends default sporks missing from an older draft", () => {
    const sporks = mergeDefaultSporks(swappedDraft, 2);
    assert.ok(sporks.some((entry) => entry.name === "governance"));
    assert.equal(sporks.length, DEFAULT_SPORKS.length);
  });

  it("leaves a draft with a swapped-looking record alone once it is on the current version", () => {
    const sporks = mergeDefaultSporks(swappedDraft, DEFAULT_SPORKS_VERSION);
    assert.deepEqual(sporks, swappedDraft);
  });

  it("does not touch records an admin gave other names", () => {
    const custom = [{ id: LIBP2P_SPORK_ID, name: "my-spork", description: "", activated: false, enforcementHeight: 5 }];
    const sporks = mergeDefaultSporks(custom, 2);
    assert.deepEqual(sporks[0], custom[0]);
  });
});
