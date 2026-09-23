import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SPORKS, DEFAULT_SPORKS_VERSION, DYNAMIC_PLASMA_SPORK_ID, LIBP2P_SPORK_ID } from "./constants.js";
import { duplicateSporkIds } from "./settings.js";
import { mergeDefaultSporks, normalizeState } from "./storage.js";
import type { AppState, SporkRecord } from "../shared/types.js";

// Provenance: placeholder spork IDs compiled into go-zenon at commit
// 32b96d9241a53966c31c310bd637e57562300255 (dev branch), common/types/spork.go lines 31 and 37:
//   Libp2pSpork        = NewImplementedSpork("...0001")
//   DynamicPlasmaSpork = NewImplementedSpork("...0002")
// Nodes select a feature by ID, never by name, so these literals are the contract. Re-check them
// against the pinned go-zenon commit whenever the release target changes.
const UPSTREAM_LIBP2P_SPORK_ID = "0000000000000000000000000000000000000000000000000000000000000001";
const UPSTREAM_DYNAMIC_PLASMA_SPORK_ID = "0000000000000000000000000000000000000000000000000000000000000002";

const dynamicPlasma = (id: string, name = "dynamic-plasma"): SporkRecord => ({
  id,
  name,
  description: "Activates Dynamic Plasma",
  activated: true,
  enforcementHeight: 10
});
const libp2p = (id: string, name = "libp2p"): SporkRecord => ({
  id,
  name,
  description: "Activates the libp2p networking stack",
  activated: false,
  enforcementHeight: 20
});
const governance: SporkRecord = {
  id: "0000000000000000000000000000000000000000000000000000000000000003",
  name: "governance",
  description: "Activates the governance stack",
  activated: false,
  enforcementHeight: 30
};
const originalThree = DEFAULT_SPORKS.slice(0, 3).map((spork) => ({ ...spork }));
const ids = (sporks: SporkRecord[]) => sporks.map((spork) => spork.id);

describe("default sporks", () => {
  it("uses the go-zenon placeholder IDs", () => {
    assert.equal(LIBP2P_SPORK_ID, UPSTREAM_LIBP2P_SPORK_ID);
    assert.equal(DYNAMIC_PLASMA_SPORK_ID, UPSTREAM_DYNAMIC_PLASMA_SPORK_ID);
  });

  it("assigns the DynamicPlasmaSpork ID to dynamic-plasma and the Libp2pSpork ID to libp2p", () => {
    assert.equal(DEFAULT_SPORKS.find((entry) => entry.name === "dynamic-plasma")?.id, UPSTREAM_DYNAMIC_PLASMA_SPORK_ID);
    assert.equal(DEFAULT_SPORKS.find((entry) => entry.name === "libp2p")?.id, UPSTREAM_LIBP2P_SPORK_ID);
  });

  it("has no duplicate IDs", () => {
    assert.deepEqual(duplicateSporkIds([...DEFAULT_SPORKS]), []);
  });
});

describe("mergeDefaultSporks", () => {
  const swappedDraft = [...originalThree, dynamicPlasma(LIBP2P_SPORK_ID), libp2p(DYNAMIC_PLASMA_SPORK_ID), governance];
  const correctedDraft = [...originalThree, dynamicPlasma(DYNAMIC_PLASMA_SPORK_ID), libp2p(LIBP2P_SPORK_ID), governance];

  it("repairs the swapped IDs of a version-2 draft while keeping each record's activation and height", () => {
    assert.deepEqual(mergeDefaultSporks(swappedDraft, 2), correctedDraft);
  });

  it("leaves a version-2 draft that was already corrected by hand alone", () => {
    assert.deepEqual(mergeDefaultSporks(correctedDraft, 2), correctedDraft);
  });

  it("leaves a draft on the current version alone even when it looks swapped", () => {
    assert.deepEqual(mergeDefaultSporks(swappedDraft, DEFAULT_SPORKS_VERSION), swappedDraft);
  });

  it("swaps by ID when a default was renamed, without producing duplicate IDs or re-adding the default", () => {
    const draft = [...originalThree, dynamicPlasma(LIBP2P_SPORK_ID, "my-plasma"), libp2p(DYNAMIC_PLASMA_SPORK_ID), governance];
    const merged = mergeDefaultSporks(draft, 2);
    assert.deepEqual(merged, [...originalThree, dynamicPlasma(DYNAMIC_PLASMA_SPORK_ID, "my-plasma"), libp2p(LIBP2P_SPORK_ID), governance]);
    assert.deepEqual(duplicateSporkIds(merged), []);
  });

  it("does not restore a default an admin removed from a version-2 draft", () => {
    const draft = [...originalThree, libp2p(DYNAMIC_PLASMA_SPORK_ID), governance];
    assert.deepEqual(mergeDefaultSporks(draft, 2), [...originalThree, libp2p(LIBP2P_SPORK_ID), governance]);
  });

  it("does not touch records that use neither placeholder ID", () => {
    const custom: SporkRecord = { id: "ab".repeat(32), name: "my-spork", description: "", activated: false, enforcementHeight: 5 };
    assert.deepEqual(mergeDefaultSporks([...originalThree, custom], 2), [...originalThree, custom]);
  });

  it("leaves a renamed record that was corrected by hand alone when its counterpart was removed", () => {
    const draft = [...originalThree, libp2p(LIBP2P_SPORK_ID, "my-network"), governance];
    assert.deepEqual(mergeDefaultSporks(draft, 2), draft);
  });

  it("leaves a draft alone when both defaults were renamed, since it cannot tell corrected from swapped", () => {
    const draft = [...originalThree, dynamicPlasma(DYNAMIC_PLASMA_SPORK_ID, "my-plasma"), libp2p(LIBP2P_SPORK_ID, "my-network"), governance];
    assert.deepEqual(mergeDefaultSporks(draft, 2), draft);
  });

  it("preserves a duplicate-ID draft unchanged, leaving it to the finalize blockers", () => {
    const draft = [...originalThree, dynamicPlasma(DYNAMIC_PLASMA_SPORK_ID), libp2p(DYNAMIC_PLASMA_SPORK_ID), governance];
    assert.deepEqual(mergeDefaultSporks(draft, 2), draft);
  });

  it("repairs an undefined-version draft that already carried the swapped pair", () => {
    const merged = mergeDefaultSporks([...originalThree, dynamicPlasma(LIBP2P_SPORK_ID), libp2p(DYNAMIC_PLASMA_SPORK_ID)], undefined);
    assert.deepEqual(merged, [...originalThree, dynamicPlasma(DYNAMIC_PLASMA_SPORK_ID), libp2p(LIBP2P_SPORK_ID), { ...governance }]);
  });

  it("appends the test sporks with correct IDs to a pre-spork undefined-version draft", () => {
    const merged = mergeDefaultSporks(originalThree, undefined);
    assert.deepEqual(ids(merged), ids([...DEFAULT_SPORKS]));
    assert.deepEqual(duplicateSporkIds(merged), []);
  });
});

describe("duplicateSporkIds", () => {
  it("reports IDs that appear more than once, ignoring case", () => {
    const sporks = [dynamicPlasma(LIBP2P_SPORK_ID), libp2p(LIBP2P_SPORK_ID.toUpperCase()), governance];
    assert.deepEqual(duplicateSporkIds(sporks), [LIBP2P_SPORK_ID]);
  });
});

describe("normalizeState spork migration", () => {
  const finalizedGenesis = { genesis: { SporkConfig: { Sporks: [] } }, finalizedAt: "2026-09-18T10:05:44.643Z" } as unknown as NonNullable<AppState["finalizedGenesis"]>;
  const stateWith = (sporks: SporkRecord[], defaultSporksVersion: number | undefined): Partial<AppState> =>
    ({ defaultSporksVersion, finalizedGenesis, settings: { sporks } as unknown as AppState["settings"] }) as Partial<AppState>;

  it("discards a finalized genesis when the migration changes the sporks", () => {
    const state = normalizeState(stateWith([...originalThree, dynamicPlasma(LIBP2P_SPORK_ID), libp2p(DYNAMIC_PLASMA_SPORK_ID), governance], 2));
    assert.equal(state.finalizedGenesis, undefined);
    assert.equal(state.settings.sporks.find((spork) => spork.name === "dynamic-plasma")?.id, DYNAMIC_PLASMA_SPORK_ID);
    assert.equal(state.defaultSporksVersion, DEFAULT_SPORKS_VERSION);
  });

  it("keeps a finalized genesis when the migration leaves the sporks unchanged", () => {
    const state = normalizeState(stateWith([...originalThree, dynamicPlasma(DYNAMIC_PLASMA_SPORK_ID), libp2p(LIBP2P_SPORK_ID), governance], 2));
    assert.deepEqual(state.finalizedGenesis, finalizedGenesis);
  });

  it("discards a finalized genesis when the stored sporks carry duplicate IDs", () => {
    const state = normalizeState(stateWith([...originalThree, dynamicPlasma(DYNAMIC_PLASMA_SPORK_ID), libp2p(DYNAMIC_PLASMA_SPORK_ID), governance], 2));
    assert.equal(state.finalizedGenesis, undefined);
  });

  it("preserves an explicitly empty version-2 spork list instead of restoring the defaults", () => {
    const state = normalizeState(stateWith([], 2));
    assert.deepEqual(state.settings.sporks, []);
    assert.deepEqual(state.finalizedGenesis, finalizedGenesis);
  });

  it("fills in the defaults when the stored settings have no spork list at all", () => {
    const state = normalizeState({ defaultSporksVersion: 2, settings: {} as AppState["settings"] });
    assert.deepEqual(ids(state.settings.sporks), ids([...DEFAULT_SPORKS]));
  });

  it("keeps a finalized genesis on a current-version state", () => {
    const state = normalizeState(stateWith([...originalThree, dynamicPlasma(LIBP2P_SPORK_ID), libp2p(DYNAMIC_PLASMA_SPORK_ID), governance], DEFAULT_SPORKS_VERSION));
    assert.deepEqual(state.finalizedGenesis, finalizedGenesis);
  });
});
