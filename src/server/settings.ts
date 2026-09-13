import type { AppState, NetworkSettings, NetworkSettingsSnapshot, PillarRecord } from "../shared/types.js";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The settings as published to nodes: everything except the spork wallet secret material. */
export function settingsSnapshot(settings: NetworkSettings): NetworkSettingsSnapshot {
  const { sporkWallet: _sporkWallet, ...snapshot } = settings;
  return cloneJson(snapshot);
}

/**
 * Identity of everything a publish would snapshot. Publishing compares the key computed when the
 * admin clicked publish with the key inside the serialized state update, so any concurrent edit to
 * any published field (not only the repository coordinates) aborts the publish with a conflict.
 */
export function publishSnapshotKey(settings: NetworkSettings): string {
  return JSON.stringify(settingsSnapshot(settings));
}

/**
 * Identity of the settings that are baked into genesis.json. A finalized genesis is discarded when
 * any of these change. Seeders, bootstrap peers and the pillar-count thresholds are deliberately
 * excluded: they only reach config.json and the readiness checks, and seeders are routinely added
 * after launch, when a re-finalize would be refused because the genesis time has passed.
 */
export function genesisSettingsKey(settings: NetworkSettings): string {
  return JSON.stringify({
    chainIdentifier: settings.chainIdentifier,
    extraData: settings.extraData,
    sporkAddress: settings.sporkAddress,
    genesisTimestampSec: settings.genesisTimestampSec,
    sporks: settings.sporks,
    genesisFunds: settings.genesisFunds
  });
}

/** The parts of a pillar record that feed genesis and node configs (telemetry excluded). */
function pillarGenesisInputs(pillar: PillarRecord) {
  return {
    id: pillar.id,
    pillarName: pillar.pillarName,
    createdAt: pillar.createdAt,
    producerIndex: pillar.producerIndex,
    pillarAddress: pillar.pillarWallet.address,
    rewardAddress: pillar.rewardWallet.address,
    producerAddress: pillar.producerWallet.address
  };
}

/**
 * Identity of every input a publish consumes: the settings snapshot, the pillar set that goes into
 * genesis, and the finalized genesis if any. Node telemetry and download timestamps are excluded
 * so status reports arriving during a publish do not cause spurious conflicts.
 */
export function publishInputsKey(state: Pick<AppState, "settings" | "pillars" | "finalizedGenesis">): string {
  return JSON.stringify({
    settings: settingsSnapshot(state.settings),
    pillars: state.pillars.map(pillarGenesisInputs),
    finalizedAt: state.finalizedGenesis?.finalizedAt ?? null,
    finalizedGenesis: state.finalizedGenesis?.genesis ?? null
  });
}
