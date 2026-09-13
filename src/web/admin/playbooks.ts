import type { AdminOverview, PublicNetworkSettings, ReleaseTarget } from "../../shared/types";
import type { SectionId } from "./sections";
import { isOnline, telemetryNodes } from "./telemetry";

export type PlaybookId = "launch" | "relaunch" | "change";
export const PLAYBOOK_IDS: readonly PlaybookId[] = ["launch", "relaunch", "change"];
export const PLAYBOOK_STORAGE_KEY = "znn.admin.playbook";

export interface PlaybookInput {
  overview: AdminOverview;
  draft: PublicNetworkSettings;
  settingsDirty: boolean;
  now?: number;
}

export interface StepDefinition {
  id: string;
  label: string;
  description: string;
  section: SectionId;
  optional?: boolean;
  done: (input: PlaybookInput) => boolean;
  /** Why the step is not done yet; shown when it is the current step. Only called when `done` is false. */
  reason?: (input: PlaybookInput) => string;
}

export interface PlaybookDefinition {
  id: PlaybookId;
  title: string;
  selectLabel: string;
  steps: StepDefinition[];
}

export interface StepEvaluation {
  id: string;
  index: number;
  label: string;
  description: string;
  section: SectionId;
  optional: boolean;
  state: "done" | "current" | "pending";
  skipped: boolean;
  /** What still blocks this step; set on the current step only. */
  reason?: string;
}

export interface PlaybookEvaluation {
  playbook: PlaybookDefinition;
  steps: StepEvaluation[];
  currentIndex: number;
  current?: StepEvaluation;
  doneCount: number;
  total: number;
  complete: boolean;
}

const nowSec = (input: PlaybookInput) => Math.floor((input.now ?? Date.now()) / 1000);
const allNodes = (input: PlaybookInput) => telemetryNodes(input.overview);
const allOnline = (input: PlaybookInput) => {
  const nodes = allNodes(input);
  return nodes.length > 0 && nodes.every((node) => isOnline(node, input.now ?? Date.now()));
};
const readinessOk = (input: PlaybookInput, label: string) => input.overview.readiness.find((check) => check.label === label)?.ok ?? false;
const publishedAtMs = (input: PlaybookInput) => (input.overview.published ? Date.parse(input.overview.published.publishedAt) : undefined);
const finalizedAtMs = (input: PlaybookInput) => (input.overview.finalizedAt ? Date.parse(input.overview.finalizedAt) : undefined);

/**
 * True once the relaunch has been published: a wiped release, published after the latest finalize,
 * whose genesis is still in the future. Every earlier relaunch step counts as done in this state,
 * because the server clears the wipe flag and the draft now equals the published genesis time.
 */
function relaunchPublished(input: PlaybookInput): boolean {
  const published = input.overview.published;
  if (!published?.actions?.wipeData || !published.genesisStartAt) return false;
  const publishedAt = Date.parse(published.publishedAt);
  const finalizedAt = input.overview.finalizedAt ? Date.parse(input.overview.finalizedAt) : undefined;
  const genesisStart = Date.parse(published.genesisStartAt);
  return genesisStart > (input.now ?? Date.now()) && finalizedAt !== undefined && publishedAt >= finalizedAt;
}

/** True while a published go-zenon commit exists that not every node reports yet. */
function upgradePending(input: PlaybookInput): boolean {
  const expected = input.overview.published?.release?.goZenon.commit?.toLowerCase();
  const nodes = allNodes(input);
  if (!expected || nodes.length === 0) return false;
  return !nodes.every((node) => (node.nodeStatus?.latest?.process?.commit ?? "").toLowerCase().startsWith(expected));
}

const offlineCount = (input: PlaybookInput) => allNodes(input).filter((node) => !isOnline(node, input.now ?? Date.now())).length;
const nodesReason = (input: PlaybookInput) => {
  const nodes = allNodes(input);
  if (nodes.length === 0) return "no nodes registered yet";
  const offline = offlineCount(input);
  return `${offline} of ${nodes.length} node${nodes.length === 1 ? "" : "s"} not online`;
};
const unsavedReason = () => "unsaved changes in Network";

/** Reason a launch or relaunch publish is not done: nothing published, or published before the latest finalize. */
function publishReason(input: PlaybookInput): string {
  const published = publishedAtMs(input);
  const finalized = finalizedAtMs(input);
  if (published === undefined) return "nothing published yet";
  if (finalized !== undefined && published < finalized) return "published before the latest finalize";
  return "not published yet";
}

function draftTarget(draft: PublicNetworkSettings): ReleaseTarget {
  return {
    goZenon: { repoUrl: draft.goZenonRepo, ref: draft.goZenonRef, commit: draft.goZenonCommit || undefined },
    deployment: { repoUrl: draft.deploymentRepo, ref: draft.deploymentRef, commit: draft.deploymentCommit || undefined }
  };
}

/** True when the draft names the same repo/ref as the published release and any explicit draft pin matches. */
function targetMatchesPublished(draft: PublicNetworkSettings, published?: ReleaseTarget): boolean {
  if (!published) return false;
  const target = draftTarget(draft);
  const same = (a: ReleaseTarget["goZenon"], b: ReleaseTarget["goZenon"]) =>
    a.repoUrl === b.repoUrl && a.ref === b.ref && (!a.commit || a.commit.toLowerCase() === (b.commit ?? "").toLowerCase());
  return same(target.goZenon, published.goZenon) && same(target.deployment, published.deployment);
}

export const PLAYBOOKS: Record<PlaybookId, PlaybookDefinition> = {
  launch: {
    id: "launch",
    title: "Launch checklist",
    selectLabel: "Launch a new testnet",
    steps: [
      {
        id: "logins",
        label: "Create operator logins",
        description: "One login per pillar or seed node.",
        section: "users",
        done: (i) => i.overview.users.some((u) => u.role === "user"),
        reason: () => "no operator logins yet"
      },
      {
        id: "nodes",
        label: "Register nodes",
        description: "Operators create pillars; you generate seeds.",
        section: "nodes",
        done: (i) => i.overview.pillars.length >= i.draft.minPillars,
        reason: (i) => `${i.overview.pillars.length} of ${i.draft.minPillars} minimum pillars registered`
      },
      {
        id: "configure",
        label: "Configure network",
        description: "Future genesis time and at least one seeder, saved.",
        section: "network",
        done: (i) => (i.draft.genesisTimestampSec > nowSec(i) || Boolean(i.overview.finalizedAt)) && readinessOk(i, "Seeders"),
        reason: (i) => {
          if (i.draft.genesisTimestampSec <= nowSec(i) && !i.overview.finalizedAt) return "genesis start time is in the past";
          return i.draft.seeders.length ? "seeders not saved yet" : "no seeders configured";
        }
      },
      { id: "save", label: "Save settings", description: "Persist the draft so it can be finalized.", section: "network", done: (i) => !i.settingsDirty, reason: unsavedReason },
      {
        id: "finalize",
        label: "Finalize genesis",
        description: "Lock pillars and funds into genesis.json.",
        section: "release",
        done: (i) => Boolean(i.overview.finalizedAt),
        reason: () => "not finalized yet"
      },
      {
        id: "publish",
        label: "Publish release",
        description: "Go public and instruct nodes to install.",
        section: "release",
        done: (i) => {
          const published = publishedAtMs(i);
          const finalized = finalizedAtMs(i);
          return published !== undefined && (finalized === undefined || published >= finalized);
        },
        reason: publishReason
      },
      { id: "online", label: "Verify nodes online", description: "All nodes report Online before genesis time.", section: "nodes", done: allOnline, reason: nodesReason }
    ]
  },
  relaunch: {
    id: "relaunch",
    title: "Relaunch checklist",
    selectLabel: "Relaunch (new genesis)",
    steps: [
      {
        id: "genesis-time",
        label: "Set a new genesis time",
        description: "Pick a fresh start in Genesis basics.",
        section: "network",
        done: (i) => {
          if (relaunchPublished(i)) return true;
          const publishedStart = i.overview.published?.genesisStartAt ? Math.floor(Date.parse(i.overview.published.genesisStartAt) / 1000) : undefined;
          return i.draft.genesisTimestampSec > nowSec(i) && i.draft.genesisTimestampSec !== publishedStart;
        },
        reason: (i) => (i.draft.genesisTimestampSec <= nowSec(i) ? "genesis start time is in the past" : "genesis time matches the published release")
      },
      {
        id: "wipe",
        label: "Enable data wipe",
        description: "Turn on “wipe node data on publish”.",
        section: "network",
        done: (i) => relaunchPublished(i) || i.draft.wipeDataOnPublish,
        reason: () => "wipe node data on publish is off"
      },
      { id: "save", label: "Save settings", description: "Persist the new draft.", section: "network", done: (i) => !i.settingsDirty, reason: unsavedReason },
      {
        id: "finalize",
        label: "Finalize genesis",
        description: "Re-lock genesis with the new time.",
        section: "release",
        done: (i) => {
          if (relaunchPublished(i)) return true;
          const finalized = finalizedAtMs(i);
          const published = publishedAtMs(i);
          return finalized !== undefined && (published === undefined || finalized > published);
        },
        reason: (i) => (finalizedAtMs(i) === undefined ? "not finalized yet" : "finalized before the published release; finalize again")
      },
      { id: "publish", label: "Publish release", description: "Nodes wipe chain data and restart.", section: "release", done: relaunchPublished, reason: publishReason },
      { id: "rejoin", label: "Verify nodes rejoin", description: "Watch health return to Online.", section: "nodes", done: allOnline, reason: nodesReason }
    ]
  },
  change: {
    id: "change",
    title: "Release change checklist",
    selectLabel: "Change release / upgrade",
    steps: [
      {
        id: "edit",
        label: "Edit release target",
        description: "New repo, branch/tag or commit pins.",
        section: "network",
        // Done while the draft differs from what is published, and while a published upgrade is
        // still rolling out. Once every node runs the published build the checklist is idle again
        // and points back at this step.
        done: (i) => !targetMatchesPublished(i.draft, i.overview.published?.release) || upgradePending(i),
        reason: () => "release target matches the published release"
      },
      { id: "apply-at", label: "Set apply time (optional)", description: "Coordinate the switch-over moment.", section: "network", optional: true, done: (i) => Boolean(i.draft.releaseApplyAtSec) },
      { id: "save", label: "Save settings", description: "Persist the new target.", section: "network", done: (i) => !i.settingsDirty, reason: unsavedReason },
      {
        id: "publish",
        label: "Publish release",
        description: "Nodes build, verify and restart on it.",
        section: "release",
        done: (i) => targetMatchesPublished(i.draft, i.overview.published?.release),
        reason: () => "the saved release target is not published yet"
      },
      {
        id: "applied",
        label: "Watch nodes apply",
        description: "Version column shows the new build.",
        section: "nodes",
        done: (i) => Boolean(i.overview.published?.release?.goZenon.commit) && allNodes(i).length > 0 && !upgradePending(i),
        reason: (i) => {
          if (!i.overview.published?.release?.goZenon.commit) return "no published go-zenon commit";
          const nodes = allNodes(i);
          if (nodes.length === 0) return "no nodes registered yet";
          const expected = i.overview.published.release.goZenon.commit.toLowerCase();
          const behind = nodes.filter((node) => !(node.nodeStatus?.latest?.process?.commit ?? "").toLowerCase().startsWith(expected)).length;
          return `${behind} of ${nodes.length} node${nodes.length === 1 ? "" : "s"} still on the previous build`;
        }
      }
    ]
  }
};

export function evaluatePlaybook(id: PlaybookId, input: PlaybookInput): PlaybookEvaluation {
  const playbook = PLAYBOOKS[id];
  const steps: StepEvaluation[] = [];
  let currentIndex = -1;
  for (const [index, step] of playbook.steps.entries()) {
    const optional = Boolean(step.optional);
    const done = step.done(input);
    const skipped = optional && !done;
    let state: StepEvaluation["state"];
    let reason: string | undefined;
    if (currentIndex >= 0) {
      state = "pending";
    } else if (done) {
      state = "done";
    } else if (optional) {
      state = "pending";
    } else {
      state = "current";
      currentIndex = index;
      reason = step.reason?.(input);
    }
    steps.push({ id: step.id, index, label: step.label, description: step.description, section: step.section, optional, state, skipped, reason });
  }
  const doneCount = steps.filter((step) => step.state === "done").length;
  return {
    playbook,
    steps,
    currentIndex,
    current: currentIndex >= 0 ? steps[currentIndex] : undefined,
    doneCount,
    total: steps.filter((step) => !step.skipped).length,
    complete: currentIndex < 0
  };
}

export function parsePlaybookId(value: string | null | undefined): PlaybookId {
  return (PLAYBOOK_IDS as readonly string[]).includes(value ?? "") ? (value as PlaybookId) : "launch";
}
