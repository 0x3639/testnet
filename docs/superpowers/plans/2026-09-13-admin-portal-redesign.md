# Admin Portal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single admin "Genesis Control" page with a six-section sidebar shell, a playbook-driven launch bar, a Network Status view, and tooltips, preserving every existing admin capability.

**Architecture:** The admin UI moves out of `src/web/App.tsx` into `src/web/admin/` (one file per section) with pure, `node:test`-covered modules for telemetry health, playbook evaluation, Status aggregates, and hash parsing. Shared helpers and small components move to `src/web/shared/` so the landing and operator views keep using them. The server is untouched; all data still comes from `GET /api/admin/overview` (`AdminOverview` in `src/shared/types.ts`).

**Tech Stack:** React 18, Vite 6, TypeScript 5.7, lucide-react, plain CSS in `src/web/styles.css`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-13-admin-portal-redesign-design.md`

## Global Constraints

- Branch `admin-portal-redesign`; one PR; commits land in the four stages below (Tasks 1-5 = stage 1, 6-7 = stage 2, 8-9 = stage 3, 10-12 = stage 4). Every task must typecheck and build.
- Visual theme unchanged: reuse tokens (`--bg #151515`, `--panel #1d1f1e`, `--panel-2 #202523`, `--border #313735`, `--text #f4f7f5`, `--muted #a3aca7`, `--green #00d557`, `--blue #0061eb`, `--warn #f7c948`, `--danger #ff5470`, radius `7px`), fonts (Space Grotesk UI, JetBrains Mono data), and existing classes (`.panel`, `.btn`, `.ledger`, `.statusPill`, `.statTile`, table styles).
- Type scale for the admin: h1 2.2rem, h2 1.2rem, body 0.9-0.95rem, table/meta 0.85rem, ledger 0.72rem.
- Section ids and hashes: `status`, `launch`, `users`, `nodes`, `network`, `release`. Default section: `status` when `overview.published` exists, else `launch`.
- Playbook `localStorage` key: `znn.admin.playbook`.
- Every existing API call, `window.confirm` guard, and `.alert` error display is preserved. No server changes.
- Tooltip copy is exactly the text in the spec's Tooltips section.
- Pure modules (`telemetry.ts`, `sections.ts`, `playbooks.ts`, `statusAggregates.ts`, `tooltips.ts`) import nothing from React or the DOM and take `now` as a parameter where time matters.
- Commit with `git -c commit.gpgsign=false commit` if a GPG prompt would block; end messages with the session attribution lines used in this repo.
- Verification commands: `npm run typecheck`, `npm test`, `npm run build`.

---

### Task 1: Shared helpers and small components move to `src/web/shared/`

**Files:**
- Create: `src/web/shared/api.ts`, `src/web/shared/format.ts`, `src/web/shared/ui.tsx`
- Modify: `src/web/App.tsx` (delete the moved definitions, import them instead)

**Interfaces:**
- Produces: `api<T>(path, init?)`, `Session`, `RefreshState` from `api.ts`; `download`, `shortAddress`, `copy`, `loginUrl`, `publicUrl`, `shellQuote`, `bootstrapCommand`, `toUtcDateTimeInput`, `fromUtcDateTimeInput`, `utcSecondsFromNow`, `formatUtc`, `settingsKey`, `generatePassword`, `repoPolicyHint`, `isHttpUrl`, `repoShortName` from `format.ts`; `AddressValue`, `Button`, `RefreshButton`, `StatTile`, `EndpointRow` from `ui.tsx`.

- [ ] **Step 1: Create `src/web/shared/api.ts`**

Move `Session`, `RefreshState`, and `api` from `src/web/App.tsx` (currently lines 36-57) verbatim, exporting them:

```ts
import type { AdminOverview, UserOverview } from "../../shared/types";

export type Session = UserOverview | AdminOverview;
export type RefreshState = "idle" | "refreshing" | "updated" | "error";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const json = response.headers.get("content-type")?.includes("application/json") ? await response.json() : undefined;
  if (!response.ok) {
    throw new Error(json?.error ?? response.statusText);
  }
  return json as T;
}
```

- [ ] **Step 2: Create `src/web/shared/format.ts`**

Move these functions from `App.tsx` verbatim, each with `export` added: `download`, `shortAddress`, `copy`, `loginUrl`, `publicUrl`, `shellQuote`, `bootstrapCommand`, `toUtcDateTimeInput`, `fromUtcDateTimeInput`, `utcSecondsFromNow`, `formatUtc`, `settingsKey`, `generatePassword` (lines 58-137), and `isHttpUrl`, `repoShortName` (lines 250-261), and `repoPolicyHint` (lines 1032-1036). The file needs:

```ts
import type { PublicNetworkSettings, RepoPolicyInfo } from "../../shared/types";
```

- [ ] **Step 3: Create `src/web/shared/ui.tsx`**

Move `AddressValue`, `Button`, `RefreshButton` (lines 138-183), `EndpointRow` (lines 263-284), and `StatTile` (lines 286-294) verbatim with `export` added. Imports at the top:

```tsx
import { CheckCircle2, Copy, RefreshCcw } from "lucide-react";
import { useState } from "react";
import type { RefreshState } from "./api";
import { copy, shortAddress } from "./format";
```

- [ ] **Step 4: Update `src/web/App.tsx`**

Delete the moved definitions and add, after the lucide import:

```ts
import { api, type RefreshState, type Session } from "./shared/api";
import {
  bootstrapCommand,
  copy,
  download,
  formatUtc,
  fromUtcDateTimeInput,
  generatePassword,
  isHttpUrl,
  loginUrl,
  publicUrl,
  repoPolicyHint,
  repoShortName,
  settingsKey,
  toUtcDateTimeInput,
  utcSecondsFromNow
} from "./shared/format";
import { AddressValue, Button, EndpointRow, RefreshButton, StatTile } from "./shared/ui";
```

Remove now-unused lucide icons from the import (`CheckCircle2`, `Copy`, `RefreshCcw` stay only if still used elsewhere in `App.tsx`; run typecheck to find out). Keep `shellQuote` unexported-import only if `App.tsx` still uses it (it does not; `bootstrapCommand` uses it inside `format.ts`).

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/web/shared src/web/App.tsx
git -c commit.gpgsign=false commit -m "Move shared web helpers and components to src/web/shared"
```

---

### Task 2: Pure telemetry helpers (`src/web/admin/telemetry.ts`) with tests

**Files:**
- Create: `src/web/admin/telemetry.ts`, `src/web/admin/telemetry.test.ts`
- Modify: `package.json` (test glob), `tsconfig.web.json` (node types), `src/web/App.tsx` (import from the new module)

**Interfaces:**
- Produces:
  ```ts
  export type TelemetryNode = { id: string; name: string; nodeType: "pillar" | "seed"; nodeStatus?: PublicNodeStatus };
  export type HealthTone = "ok" | "warn" | "bad" | "muted";
  export interface NodeHealth { label: string; tone: HealthTone }
  export const STALE_AFTER_MS = 5 * 60 * 1000;
  export function telemetryNodes(overview: Pick<AdminOverview, "pillars" | "seedNodes">): TelemetryNode[]
  export function formatAge(value?: string, now?: number): string
  export function syncStateLabel(value?: number): string
  export function heightLag(node: TelemetryNode): string
  export function clockSkewSeconds(node: TelemetryNode): number | undefined
  export function formatClockSkew(node: TelemetryNode): string
  export function shortCommit(value?: string): string
  export function nodeHealth(node: TelemetryNode, now?: number): NodeHealth
  export function isOnline(node: TelemetryNode, now?: number): boolean
  ```

- [ ] **Step 1: Enable web tests in the toolchain**

In `package.json` set `"test": "tsx --test src/server/*.test.ts src/web/admin/*.test.ts"`. In `tsconfig.web.json` set `"types": ["vite/client", "node"]` so test files that import `node:test` typecheck under the web config (they are already included by `src/web/**/*.ts`).

- [ ] **Step 2: Write the failing test `src/web/admin/telemetry.test.ts`**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAge, isOnline, nodeHealth, telemetryNodes, type TelemetryNode } from "./telemetry";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

function node(latest: Partial<NonNullable<TelemetryNode["nodeStatus"]>["latest"]> | undefined, name = "n"): TelemetryNode {
  return {
    id: name,
    name,
    nodeType: "pillar",
    nodeStatus: latest ? { latest: { receivedAt: ago(10), ...latest }, historyCount: 1 } : undefined
  };
}

describe("nodeHealth", () => {
  it("is Online for a fresh, synced, error-free report", () => {
    const n = node({ sync: { state: 2, currentHeight: 100, targetHeight: 100 }, node: { serviceActive: true } });
    assert.deepEqual(nodeHealth(n, NOW), { label: "Online", tone: "ok" });
    assert.equal(isOnline(n, NOW), true);
  });

  it("reports No report, Stale, Install failed, Service down, Errors, Syncing, Lagging", () => {
    assert.equal(nodeHealth(node(undefined), NOW).label, "No report");
    assert.equal(nodeHealth(node({ receivedAt: ago(6 * 60) }), NOW).label, "Stale");
    assert.equal(nodeHealth(node({ node: { lastError: "boom" } }), NOW).label, "Install failed");
    assert.equal(nodeHealth(node({ node: { serviceActive: false } }), NOW).label, "Service down");
    assert.equal(nodeHealth(node({ logs: { errorCountLastMinute: 2 } }), NOW).label, "Errors");
    assert.equal(nodeHealth(node({ sync: { state: 1 } }), NOW).label, "Syncing");
    assert.equal(nodeHealth(node({ sync: { state: 2, currentHeight: 10, targetHeight: 100 } }), NOW).label, "Lagging");
  });

  it("uses the supplied clock", () => {
    const n = node({ receivedAt: ago(10), sync: { state: 2 } });
    assert.equal(nodeHealth(n, NOW).label, "Online");
    assert.equal(nodeHealth(n, NOW + 10 * 60 * 1000).label, "Stale");
  });
});

describe("formatAge and telemetryNodes", () => {
  it("formats ages relative to the supplied clock", () => {
    assert.equal(formatAge(undefined, NOW), "No report");
    assert.equal(formatAge(ago(12), NOW), "12s ago");
    assert.equal(formatAge(ago(18 * 60), NOW), "18m ago");
    assert.equal(formatAge(ago(3 * 3600), NOW), "3h ago");
  });

  it("flattens pillars and seed nodes in order", () => {
    const nodes = telemetryNodes({
      pillars: [{ id: "p1", pillarName: "alpha", pillarAddress: "", rewardAddress: "", producerAddress: "", producerIndex: 0, createdAt: "" }],
      seedNodes: [{ id: "s1", userId: "u", nodeName: "seed-1", publicIp: "1.2.3.4", p2pPort: 1, publicKey: "", enode: "", multiaddr: "", createdAt: "" }]
    });
    assert.deepEqual(nodes.map((n) => [n.id, n.name, n.nodeType]), [["p1", "alpha", "pillar"], ["s1", "seed-1", "seed"]]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx --test src/web/admin/telemetry.test.ts`
Expected: FAIL, cannot find module `./telemetry`.

- [ ] **Step 4: Create `src/web/admin/telemetry.ts`**

Move `formatAge`, `syncStateLabel`, `TelemetryNode`, `heightLag`, `clockSkewSeconds`, `formatClockSkew`, `shortCommit`, `nodeHealth` from `App.tsx` (lines 975-1056) and add `now` parameters, `isOnline`, `telemetryNodes`, and constants:

```ts
import type { AdminOverview, PublicNodeStatus } from "../../shared/types";

export type TelemetryNode = {
  id: string;
  name: string;
  nodeType: "pillar" | "seed";
  nodeStatus?: PublicNodeStatus;
};

export type HealthTone = "ok" | "warn" | "bad" | "muted";
export interface NodeHealth {
  label: string;
  tone: HealthTone;
}

/** A node that has not reported for this long is Stale. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function telemetryNodes(overview: Pick<AdminOverview, "pillars" | "seedNodes">): TelemetryNode[] {
  return [
    ...overview.pillars.map((pillar) => ({ id: pillar.id, name: pillar.pillarName, nodeType: "pillar" as const, nodeStatus: pillar.nodeStatus })),
    ...overview.seedNodes.map((seedNode) => ({ id: seedNode.id, name: seedNode.nodeName, nodeType: "seed" as const, nodeStatus: seedNode.nodeStatus }))
  ];
}

export function formatAge(value?: string, now = Date.now()): string {
  if (!value) return "No report";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
```

Then the moved `syncStateLabel`, `heightLag`, `clockSkewSeconds`, `formatClockSkew`, `shortCommit` unchanged (exported), and `nodeHealth` with the signature `nodeHealth(node: TelemetryNode, now = Date.now()): NodeHealth` where `const ageMs = now - Date.parse(latest.receivedAt);` replaces the `Date.now()` call and `ageMs > STALE_AFTER_MS` replaces the literal. Finally:

```ts
export function isOnline(node: TelemetryNode, now = Date.now()): boolean {
  return nodeHealth(node, now).label === "Online";
}
```

- [ ] **Step 5: Point `App.tsx` at the module**

Delete the moved definitions from `App.tsx` and add `import { formatAge, formatClockSkew, heightLag, nodeHealth, shortCommit, syncStateLabel, telemetryNodes, type TelemetryNode } from "./admin/telemetry";`. In `AdminView`, replace the `telemetryNodes` `useMemo` body with `useMemo(() => telemetryNodes(session), [session.pillars, session.seedNodes])` (rename the local to `nodes` if the import name clashes).

- [ ] **Step 6: Run tests, typecheck, build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all server tests plus the new telemetry tests pass; typecheck and build succeed.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.web.json src/web/admin/telemetry.ts src/web/admin/telemetry.test.ts src/web/App.tsx
git -c commit.gpgsign=false commit -m "Extract pure telemetry helpers with tests"
```

---

### Task 3: Section ids and hash navigation

**Files:**
- Create: `src/web/admin/sections.ts`, `src/web/admin/sections.test.ts`, `src/web/admin/useHashSection.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SECTION_IDS = ["status", "launch", "users", "nodes", "network", "release"] as const;
  export type SectionId = (typeof SECTION_IDS)[number];
  export const SECTION_LABELS: Record<SectionId, string>;   // "Status", "Launch Ops", "Users", "Nodes", "Network", "Release"
  export function parseSection(hash: string, fallback: SectionId): SectionId;
  export function defaultSection(published: boolean): SectionId;
  export function useHashSection(fallback: SectionId): [SectionId, (section: SectionId) => void];
  ```

- [ ] **Step 1: Write the failing test `src/web/admin/sections.test.ts`**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSection, parseSection, SECTION_IDS } from "./sections";

describe("sections", () => {
  it("parses valid hashes with or without the leading #", () => {
    for (const id of SECTION_IDS) {
      assert.equal(parseSection(`#${id}`, "launch"), id);
      assert.equal(parseSection(id, "launch"), id);
    }
  });

  it("falls back for empty, unknown, or mixed-case hashes", () => {
    assert.equal(parseSection("", "launch"), "launch");
    assert.equal(parseSection("#", "status"), "status");
    assert.equal(parseSection("#nope", "launch"), "launch");
    assert.equal(parseSection("#Status", "launch"), "launch");
  });

  it("defaults to status once published, launch before", () => {
    assert.equal(defaultSection(true), "status");
    assert.equal(defaultSection(false), "launch");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/web/admin/sections.test.ts`
Expected: FAIL, cannot find module `./sections`.

- [ ] **Step 3: Create `src/web/admin/sections.ts`**

```ts
export const SECTION_IDS = ["status", "launch", "users", "nodes", "network", "release"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  status: "Status",
  launch: "Launch Ops",
  users: "Users",
  nodes: "Nodes",
  network: "Network",
  release: "Release"
};

export function parseSection(hash: string, fallback: SectionId): SectionId {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  return (SECTION_IDS as readonly string[]).includes(value) ? (value as SectionId) : fallback;
}

export function defaultSection(published: boolean): SectionId {
  return published ? "status" : "launch";
}
```

- [ ] **Step 4: Create `src/web/admin/useHashSection.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { parseSection, type SectionId } from "./sections";

/** The active admin section, kept in window.location.hash so reloads and links preserve it. */
export function useHashSection(fallback: SectionId): [SectionId, (section: SectionId) => void] {
  const [section, setSectionState] = useState<SectionId>(() => parseSection(window.location.hash, fallback));

  useEffect(() => {
    const onHashChange = () => setSectionState(parseSection(window.location.hash, fallback));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [fallback]);

  const setSection = useCallback((next: SectionId) => {
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setSectionState(next);
  }, []);

  return [section, setSection];
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/web/admin/sections.ts src/web/admin/sections.test.ts src/web/admin/useHashSection.ts
git -c commit.gpgsign=false commit -m "Add admin section ids and hash navigation"
```

---

### Task 4: Section components (Users, Nodes, Network, Release) as new files

Create the four section components as standalone files that are not yet rendered. They reuse the existing components by moving them out of `App.tsx`.

**Files:**
- Create: `src/web/admin/UsersSection.tsx`, `src/web/admin/NodesSection.tsx`, `src/web/admin/NetworkSection.tsx`, `src/web/admin/ReleaseSection.tsx`, `src/web/admin/SectionHeader.tsx`
- Modify: `src/web/App.tsx` (remove moved components), `src/web/styles.css` (append rules)

**Interfaces:**
- Consumes: `Button`, `RefreshButton`, `AddressValue` from `../shared/ui`; helpers from `../shared/format`; `TelemetryNode`, `nodeHealth`, etc. from `./telemetry`.
- Produces:
  ```tsx
  // SectionHeader.tsx
  export function SectionHeader({ kicker, title, description, aside }: { kicker?: string; title: string; description?: React.ReactNode; aside?: React.ReactNode })
  // UsersSection.tsx
  export interface CreateUserInput { username: string; password: string; role: Role }
  export function UsersSection(props: { users: ManagedUser[]; currentUser: AuthUser; onCreate: (input: CreateUserInput) => Promise<void>; onResetPassword: (userId: string, password: string) => Promise<void>; onDeleteUser: (user: ManagedUser) => Promise<void> })
  // NodesSection.tsx
  export interface CreateSeedNodeInput { userId: string; nodeName: string; publicIp: string; p2pPort: number }
  export function NodesSection(props: { overview: AdminOverview; nodes: TelemetryNode[]; refresh: () => Promise<void>; refreshState: RefreshState; onDeletePillar: (pillar: PublicPillar) => Promise<void>; onDeleteSeedNode: (seedNode: PublicSeedNode) => Promise<void>; onCreateSeedNode: (input: CreateSeedNodeInput) => Promise<PublicSeedNode> })
  // NetworkSection.tsx
  export interface ProbeSeedInput { ip: string; rpcPort: number; p2pPort: number }
  export function NetworkSection(props: { draft: PublicNetworkSettings; setDraft: React.Dispatch<React.SetStateAction<PublicNetworkSettings>>; settingsDirty: boolean; repoPolicy: RepoPolicyInfo; onSave: (settings: PublicNetworkSettings) => Promise<void>; onProbeSeed: (seed: ProbeSeedInput) => Promise<{ seed: SeedNodeProbeResult; settings: PublicNetworkSettings }> })
  // ReleaseSection.tsx
  export function ReleaseSection(props: { overview: AdminOverview; settingsDirty: boolean; wipeOnPublish: boolean; publishing: boolean; error: string; onFinalize: () => Promise<void>; onPublish: () => Promise<void> })
  ```

- [ ] **Step 1: Create `src/web/admin/SectionHeader.tsx`**

```tsx
import type React from "react";

export function SectionHeader({ kicker, title, description, aside }: { kicker?: string; title: string; description?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="sectionHeader">
      <div>
        {kicker ? <span className="ledger">{kicker}</span> : null}
        <h1>{title}</h1>
        {description ? <p className="sectionCopy">{description}</p> : null}
      </div>
      {aside ? <div className="sectionAside">{aside}</div> : null}
    </header>
  );
}
```

- [ ] **Step 2: Create `src/web/admin/UsersSection.tsx`**

Move `CreateUserInput`, `CreatedCredential`, `credentialText`, and `UserManagement` from `App.tsx` (lines 695-914) into this file. Rename `UserManagement` to `UsersSection`, export `CreateUserInput`, and make these changes:
  - Wrap the returned `<section className="panel wide">` in a fragment preceded by `<SectionHeader title="Users" description="One login per pillar or seed node operator. They sign in to register their node and download their package." />`.
  - Change the panel header to `<span className="ledger">Access</span><h2>Add a login</h2>`.
  - Reset password on demand: add `const [resetOpenFor, setResetOpenFor] = useState<string | null>(null);`. In the Password cell render the existing `resetPasswordForm` only when `resetOpenFor === user.id`; otherwise render `<Button variant="secondary" icon={<KeyRound size={18} />} onClick={() => setResetOpenFor(user.id)}>Reset password</Button>`. After a successful reset call `setResetOpenFor(null)`.
  - Add a logins count line above the table: `<div className="tableCaption mono mutedText">{users.length} login{users.length === 1 ? "" : "s"}</div>`.

Imports: `Copy, KeyRound, Trash2, UserPlus` from lucide-react; `FormEvent, useState` from react; types `AuthUser, ManagedUser, Role`; `Button` from `../shared/ui`; `copy, generatePassword, loginUrl` from `../shared/format`; `SectionHeader`.

- [ ] **Step 3: Create `src/web/admin/NodesSection.tsx`**

Move `NodeStatusPanel` (lines 1058-1131) and `CreateSeedNodeInput` (1139-1144) here. Build `NodesSection` from the pillar and seed-node panels currently inline in `AdminView` (the JSX from `<NodeStatusPanel .../>` through the end of the seed-node `</section>`), moving the seed-node form state (`seedNodeInput`, `seedNodeBusy`, `seedNodeError`, `generatedSeedNode`) and `createManagedSeedNode` into this component; `createManagedSeedNode` calls `props.onCreateSeedNode(seedNodeInput)` and stores the returned node in `generatedSeedNode`.

```tsx
export function NodesSection({ overview, nodes, refresh, refreshState, onDeletePillar, onDeleteSeedNode, onCreateSeedNode }: { /* see Interfaces */ }) {
  const userById = useMemo(() => new Map(overview.users.map((user) => [user.id, user])), [overview.users]);
  const availableSeedNodeUsers = useMemo(() => overview.users.filter((user) => user.role === "user" && !user.nodeName), [overview.users]);
  const [detailed, setDetailed] = useState(false);
  // ...seed form state moved from AdminView...
  return (
    <>
      <SectionHeader
        title="Nodes"
        description="Pillars register themselves; seed nodes are generated here. Health reports arrive once nodes run the bootstrap."
      />
      <NodeStatusPanel nodes={nodes} refresh={refresh} refreshState={refreshState} detailed={detailed} onToggleDetailed={() => setDetailed((v) => !v)} />
      <div className="nodePanels">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <span className="ledger">Pillars</span>
              <h2>Pillars · {overview.pillars.length} of {overview.settings.expectedPillars}</h2>
            </div>
            <Button variant="secondary" icon={<KeyRound size={18} />} onClick={() => download("/api/admin/spork-package.zip")}>Spork Wallet</Button>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Pillar address</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {overview.pillars.map((pillar) => (
                  <tr key={pillar.id} title={`reward ${pillar.rewardAddress} · producer ${pillar.producerAddress}`}>
                    <td>{pillar.pillarName}</td>
                    <td><AddressValue value={pillar.pillarAddress} /></td>
                    <td className="mono">{new Date(pillar.createdAt).toLocaleString()}</td>
                    <td><Button variant="danger" icon={<Trash2 size={18} />} onClick={() => void onDeletePillar(pillar)}>Delete</Button></td>
                  </tr>
                ))}
                {overview.pillars.length === 0 ? <tr><td colSpan={4} className="mutedText">No pillars registered yet</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panelHeader">
            <div>
              <span className="ledger">Seed nodes</span>
              <h2>Seed nodes · {overview.seedNodes.length}</h2>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Address</th><th>Enode</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {overview.seedNodes.map((seedNode) => (
                  <tr key={seedNode.id} title={`operator ${userById.get(seedNode.userId)?.username ?? "unknown"} · ${seedNode.multiaddr}`}>
                    <td>{seedNode.nodeName}</td>
                    <td className="mono">{seedNode.publicIp}:{seedNode.p2pPort}</td>
                    <td><AddressValue value={seedNode.enode} /></td>
                    <td><Button variant="danger" icon={<Trash2 size={18} />} onClick={() => void onDeleteSeedNode(seedNode)}>Delete</Button></td>
                  </tr>
                ))}
                {overview.seedNodes.length === 0 ? <tr><td colSpan={4} className="mutedText">No managed seed nodes yet</td></tr> : null}
              </tbody>
            </table>
          </div>
          <form className="seedCreateGrid" onSubmit={createManagedSeedNode}>
            {/* the existing Operator Login select, Seed Node Name, Public IP, P2P Port inputs and Generate Seed Node button, copied verbatim from AdminView */}
          </form>
          {seedNodeError ? <div className="alert">{seedNodeError}</div> : null}
          {generatedSeedNode ? (
            <div className="resultStack">
              <button className="seedResult mono" type="button" onClick={() => copy(generatedSeedNode.enode)} title="Copy generated enode">{generatedSeedNode.enode}</button>
              <button className="seedResult mono" type="button" onClick={() => copy(generatedSeedNode.multiaddr)} title="Copy generated libp2p multiaddr">{generatedSeedNode.multiaddr}</button>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
```

The only remaining comment is the seed form body: copy the four `<label>` blocks and the submit `Button` exactly as they appear in `AdminView` today (the `seedCreateGrid` form). Imports for this file: `KeyRound, Trash2, Server` from lucide-react; `FormEvent, useMemo, useState` from react; types `AdminOverview, PublicPillar, PublicSeedNode`; `RefreshState` from `../shared/api`; `copy, download` from `../shared/format`; `AddressValue, Button, RefreshButton` from `../shared/ui`; `SectionHeader`; telemetry helpers.

`NodeStatusPanel` gains props `detailed: boolean; onToggleDetailed: () => void`. Its header toolbar renders `<Button variant="ghost" onClick={onToggleDetailed}>{detailed ? "Compact" : "Detailed"}</Button>` next to `RefreshButton`. The Clock, Sync, Commit, and Logs columns (both `<th>` and `<td>`) render only when `detailed` is true; Node, Type, Health, Last Seen, Height, Lag, Peers, Version, Service always render.

Write the pillar and seed tables in full (do not leave the comments above in the code); they are the existing tables trimmed to the columns listed, with `Delete` buttons calling `onDeletePillar(pillar)` / `onDeleteSeedNode(seedNode)`.

- [ ] **Step 4: Create `src/web/admin/NetworkSection.tsx`**

Move `ProbeSeedInput`, `SettingsForm`, `GenesisSporkEditor`, and `GenesisFundingEditor` from `App.tsx` here. Rename `SettingsForm` to `NetworkSection`, add the `settingsDirty` prop, and restructure its JSX into these panels (same inputs and handlers as today, only regrouped):

```tsx
<>
  <SectionHeader
    title="Network"
    description="Draft settings. Nothing reaches nodes until you Save here, then Finalize and Publish on the Release page."
    aside={settingsDirty ? <span className="statusPill warn">Unsaved changes</span> : <span className="mono mutedText">Saved</span>}
  />
  <form className="networkForm" onSubmit={submit}>
    <section className="panel">
      <div className="panelHeader"><div><span className="ledger">Genesis</span><h2>Genesis basics</h2></div></div>
      <div className="formGrid">{/* Chain Identifier, Genesis Start (UTC), Minimum Pillars, Expected Pillars inputs as today */}</div>
      {/* Extra Data label as today */}
    </section>
    <section className="panel">
      <div className="panelHeader"><div><span className="ledger">Release</span><h2>Release target</h2></div></div>
      <div className="formGrid">{/* go-zenon Repo (+hint), Branch / Tag, Commit Pin (placeholder "resolved at publish"), Deployment Commit Pin, Deployment Branch / Tag as today */}</div>
      {/* Deployment Script Repo, Apply Release At + Now/+10/+30/+60/Clear toolbar as today */}
      <label className="checkboxRow warnRow">{/* wipe checkbox as today */}</label>
    </section>
    <section className="panel">
      <div className="panelHeader"><div><span className="ledger">Peers</span><h2>Seeders & bootstrap peers</h2></div></div>
      <div className="formGrid">{/* Seeders textarea, Bootstrap Peers textarea (labels "Seeders (one per line)", "Bootstrap Peers (one per line)") */}</div>
      <div className="seedProbe">{/* existing RPC probe block unchanged */}</div>
    </section>
    <div className="nodePanels">
      <GenesisSporkEditor draft={draft} setDraft={setDraft} onSave={onSave} />
      <GenesisFundingEditor draft={draft} setDraft={setDraft} onSave={onSave} />
    </div>
    {error ? <div className="alert">{error}</div> : null}
    {settingsDirty ? (
      <div className="stickySaveBar">
        <span>Unsaved draft — Finalize and Publish are locked until you save.</span>
        <Button type="submit" icon={<Save size={18} />} disabled={saving}>{saving ? "Saving" : "Save Settings"}</Button>
      </div>
    ) : null}
  </form>
</>
```

Write every input in full by copying it from the current `SettingsForm`. Keep the two editors' own Save buttons (they save the whole draft and are harmless). Change the Commit Pin placeholders from `"optional"` to `"resolved at publish"`; keep the `<small>` hints. Change the editors' panel `<h2>` to "Sporks" and "Funded addresses" and their add buttons to "Add".

- [ ] **Step 5: Create `src/web/admin/ReleaseSection.tsx`**

Move `PublishedArtifacts` (lines 916-973) here. Then:

```tsx
import { CheckCircle2, FileJson, Server } from "lucide-react";
import { useMemo, useState } from "react";
import type { AdminOverview } from "../../shared/types";
import { download } from "../shared/format";
import { Button } from "../shared/ui";
import { SectionHeader } from "./SectionHeader";

export function ReleaseSection({ overview, settingsDirty, wipeOnPublish, publishing, error, onFinalize, onPublish }: { /* see Interfaces */ }) {
  const [tab, setTab] = useState<"genesis" | "config">("genesis");
  const json = useMemo(() => JSON.stringify(tab === "genesis" ? overview.genesis : overview.configTemplate, null, 2), [overview, tab]);
  const finalized = Boolean(overview.finalizedAt);
  const published = Boolean(overview.published);
  const pillarCount = overview.pillars.length;
  const expected = overview.settings.expectedPillars;

  return (
    <>
      <SectionHeader title="Release" description="Three actions, in order. Each unlocks the next." />
      {error ? <div className="alert">{error}</div> : null}
      <section className="panel releaseCard">
        <div className="releaseCardHeader">
          <span className="stepCircle done">1</span>
          <div><h2>Review artifacts</h2><p className="mutedText">Check the generated genesis.json and config.json.</p></div>
          <div className="toolbar compactToolbar">
            <Button variant="secondary" icon={<FileJson size={18} />} onClick={() => download("/api/admin/genesis.json")}>Download genesis</Button>
            <Button variant="secondary" icon={<FileJson size={18} />} onClick={() => download("/api/admin/config-template.json")}>Download config</Button>
          </div>
        </div>
        <div className="tabs">
          <button className={tab === "genesis" ? "active" : ""} type="button" onClick={() => setTab("genesis")}>genesis.json</button>
          <button className={tab === "config" ? "active" : ""} type="button" onClick={() => setTab("config")}>config.json</button>
        </div>
        <pre>{json}</pre>
      </section>
      <section className="panel releaseCard">
        <div className="releaseCardHeader">
          <span className={`stepCircle ${finalized ? "done" : "current"}`}>{finalized ? "✓" : "2"}</span>
          <div>
            <h2>Finalize genesis</h2>
            <p className="mutedText">
              {overview.finalizedAt
                ? `Finalized ${new Date(overview.finalizedAt).toLocaleString()}`
                : `Not finalized yet. Requires saved settings and ${pillarCount} of ${expected} pillars.`}
            </p>
          </div>
          <Button icon={<CheckCircle2 size={18} />} onClick={() => void onFinalize()} disabled={settingsDirty}>Finalize</Button>
        </div>
      </section>
      <section className="panel releaseCard">
        <div className="releaseCardHeader">
          <span className={`stepCircle ${published ? "done" : finalized ? "current" : "pending"}`}>{published ? "✓" : "3"}</span>
          <div>
            <h2>Publish release</h2>
            <p className="mutedText">{finalized ? "Makes the artifacts public and instructs every bootstrapped node to install this release." : "Locked until the genesis is finalized."}</p>
          </div>
          <Button icon={<Server size={18} />} onClick={() => void onPublish()} disabled={publishing || settingsDirty || !finalized}>
            {publishing ? "Publishing" : "Publish Release"}
          </Button>
        </div>
        <div className={`wipeBanner${wipeOnPublish ? " danger" : ""}`}>
          Wipe node data on publish: <strong>{wipeOnPublish ? "on" : "off"}</strong>
        </div>
      </section>
      <section className="panel">
        <div className="panelHeader"><div><span className="ledger">Public</span><h2>Published artifacts</h2></div></div>
        {overview.published ? (
          <PublishedArtifacts published={overview.published} />
        ) : (
          <div className="emptyState">Nothing published yet. After publishing, public URLs for genesis.json, config.json and node-plan.json appear here.</div>
        )}
      </section>
    </>
  );
}
```

Note: today Finalize is allowed before all pillars register (the server does not enforce a minimum); keep that behavior and only disable on `settingsDirty`. Publish is additionally disabled until finalized, which matches today's server (it auto-finalizes) but the spec asks the UI to gate it; keep `!finalized` in the disabled condition.

- [ ] **Step 6: Append CSS to `src/web/styles.css`**

```css
/* Admin sections */
.sectionHeader {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.sectionHeader h1 {
  margin: 4px 0 6px;
  font-size: 2.2rem;
  line-height: 1.1;
}

.sectionCopy {
  margin: 0;
  color: var(--muted);
  max-width: 60ch;
}

.sectionAside {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tableCaption {
  margin: 12px 0 6px;
  font-size: 0.85rem;
}

.nodePanels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 18px;
}

.networkForm {
  display: grid;
  gap: 18px;
}

.checkboxRow.warnRow {
  border: 1px solid rgba(247, 201, 72, 0.38);
  border-radius: var(--radius);
  background: rgba(247, 201, 72, 0.08);
  padding: 10px 12px;
}

.stickySaveBar {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  border: 1px solid rgba(247, 201, 72, 0.38);
  border-radius: var(--radius);
  background: #181b1a;
  padding: 12px 16px;
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.35);
}

.releaseCard {
  display: grid;
  gap: 14px;
}

.releaseCardHeader {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
}

.releaseCardHeader h2 {
  margin: 0 0 4px;
  font-size: 1.2rem;
}

.releaseCardHeader p {
  margin: 0;
}

.stepCircle {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid #313735;
  border-radius: 50%;
  color: #6f7772;
  background: #181b1a;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  font-weight: 600;
}

.stepCircle.done {
  border-color: rgba(0, 213, 87, 0.38);
  color: var(--green);
  background: rgba(0, 213, 87, 0.12);
}

.stepCircle.current {
  border-color: rgba(0, 213, 87, 0.6);
  color: #041008;
  background: var(--green);
}

.wipeBanner {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  color: var(--muted);
}

.wipeBanner.danger {
  border-color: rgba(255, 84, 112, 0.45);
  color: #ffdce2;
  background: rgba(255, 84, 112, 0.1);
}
```

- [ ] **Step 7: Typecheck the new files only**

`App.tsx` will not typecheck until Task 5 deletes `AdminView`, because the components it used have moved. Check the new files in isolation:

Run: `npx tsc -p tsconfig.web.json --noEmit 2>&1 | grep -v "src/web/App.tsx"`
Expected: no errors reported for files under `src/web/admin/`.

- [ ] **Step 8: Continue with Task 5 before committing**

Tasks 4 and 5 are committed together at the end of Task 5.

---

### Task 5: `AdminApp` shell with sidebar and hash navigation; swap it into `App.tsx`

**Files:**
- Create: `src/web/admin/AdminApp.tsx`, `src/web/admin/Sidebar.tsx`
- Modify: `src/web/App.tsx` (delete `AdminView`, `StatusGrid`, `Field`, `AmountRow` if unused; render `AdminApp` for admins), `src/web/styles.css`

**Interfaces:**
- Produces:
  ```tsx
  export function AdminApp(props: { session: AdminOverview; refresh: () => Promise<void>; refreshState: RefreshState; onLogout: () => void })
  export function Sidebar(props: { user: AuthUser; section: SectionId; onNavigate: (s: SectionId) => void; badges: Partial<Record<SectionId, string>>; onLogout: () => void })
  ```

- [ ] **Step 1: Create `src/web/admin/Sidebar.tsx`**

```tsx
import { LogOut, Server } from "lucide-react";
import type { AuthUser } from "../../shared/types";
import { SECTION_IDS, SECTION_LABELS, type SectionId } from "./sections";

export function Sidebar({ user, section, onNavigate, badges, onLogout }: {
  user: AuthUser;
  section: SectionId;
  onNavigate: (section: SectionId) => void;
  badges: Partial<Record<SectionId, string>>;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar adminSidebar">
      <div className="brand">
        <div className="logoBox"><Server size={22} /></div>
        <div><strong>NoM Testnet</strong><span>Admin console</span></div>
      </div>
      <nav className="sideNav" aria-label="Admin sections">
        {SECTION_IDS.map((id) => (
          <button key={id} type="button" className={`sideNavItem${section === id ? " active" : ""}`} onClick={() => onNavigate(id)} aria-current={section === id ? "page" : undefined}>
            <span>{SECTION_LABELS[id]}</span>
            {badges[id] ? <span className="sideNavBadge">{badges[id]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="userBadge">
        <span>{user.username.slice(0, 2).toUpperCase()}</span>
        <div><strong>{user.username}</strong><small>Admin</small></div>
        <button type="button" className="btn ghost iconOnly" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create `src/web/admin/AdminApp.tsx`**

Move the `AdminView` state and handlers here: `settingsDraft`, `settingsBase`, `settingsBaseRef`, `settingsDirty`, the `useEffect` that re-bases the draft, `adminError`, `publishing`, and the handlers `saveSettings`, `probeSeed`, `createUser`, `resetUserPassword`, `deleteUser`, `deletePillar`, `deleteSeedNode`, `finalize`, `publish` (unchanged bodies). Add a `createSeedNode(input)` handler that posts to `/api/admin/seed-nodes`, calls `refresh()`, and returns `result.seedNode`. Then:

```tsx
export function AdminApp({ session, refresh, refreshState, onLogout }: { session: AdminOverview; refresh: () => Promise<void>; refreshState: RefreshState; onLogout: () => void }) {
  const fallback = defaultSection(Boolean(session.published));
  const [section, setSection] = useHashSection(fallback);
  const nodes = useMemo(() => telemetryNodes(session), [session.pillars, session.seedNodes]);
  // ...state and handlers described above...
  const staleCount = nodes.filter((node) => nodeHealth(node).label === "Stale").length;
  const badges: Partial<Record<SectionId, string>> = {};
  if (staleCount) badges.nodes = `${staleCount} stale`;
  if (settingsDirty) badges.network = "draft";

  return (
    <div className="appShell adminShell">
      <Sidebar user={session.user} section={section} onNavigate={setSection} badges={badges} onLogout={onLogout} />
      <main className="content adminContent">
        {adminError ? <div className="alert">{adminError}</div> : null}
        {section === "status" || section === "launch" ? (
          <section className="panel"><div className="emptyState">Coming in the next stage.</div></section>
        ) : null}
        {section === "users" ? <UsersSection users={session.users} currentUser={session.user} onCreate={createUser} onResetPassword={resetUserPassword} onDeleteUser={deleteUser} /> : null}
        {section === "nodes" ? <NodesSection overview={session} nodes={nodes} refresh={refresh} refreshState={refreshState} onDeletePillar={deletePillar} onDeleteSeedNode={deleteSeedNode} onCreateSeedNode={createSeedNode} /> : null}
        {section === "network" ? <NetworkSection draft={settingsDraft} setDraft={setSettingsDraft} settingsDirty={settingsDirty} repoPolicy={session.repoPolicy} onSave={saveSettings} onProbeSeed={probeSeed} /> : null}
        {section === "release" ? <ReleaseSection overview={session} settingsDirty={settingsDirty} wipeOnPublish={settingsDraft.wipeDataOnPublish} publishing={publishing} error="" onFinalize={finalize} onPublish={publish} /> : null}
      </main>
    </div>
  );
}
```

`deletePillar` and `deleteSeedNode` keep their `window.confirm` guards. `publish` additionally asks `if (settingsDraft.wipeDataOnPublish && !window.confirm("Wipe node data on publish is ON. Every node will delete its chain data and restart from the new genesis. Publish anyway?")) return;` before calling the API.

- [ ] **Step 3: Wire `App.tsx`**

In `App()`, render admins without the generic `Shell`:

```tsx
if (session.user.role === "admin") {
  return <AdminApp session={session as AdminOverview} refresh={refresh} refreshState={refreshState} onLogout={logout} />;
}
return (
  <Shell user={session.user} onLogout={logout}>
    <OperatorView session={session as UserOverview} refresh={refresh} />
  </Shell>
);
```

Delete `AdminView`, `StatusGrid`, and any helper now unused (`Field`, `AmountRow` are used by `OperatorView`; keep them). Remove unused imports until typecheck is clean.

- [ ] **Step 4: Append CSS**

```css
.adminShell {
  grid-template-columns: 220px 1fr;
}

.adminSidebar {
  padding: 20px;
  gap: 18px;
}

.sideNav {
  display: grid;
  gap: 4px;
}

.sideNavItem {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--muted);
  background: transparent;
  padding: 0 12px;
  text-align: left;
  cursor: pointer;
}

.sideNavItem:hover {
  color: var(--text);
}

.sideNavItem.active {
  border-color: var(--border);
  color: var(--text);
  background: var(--panel);
  font-weight: 600;
}

.sideNavBadge {
  border: 1px solid rgba(247, 201, 72, 0.38);
  border-radius: var(--radius);
  color: var(--warn);
  background: rgba(247, 201, 72, 0.08);
  padding: 1px 6px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.68rem;
  text-transform: uppercase;
}

.adminSidebar .userBadge {
  gap: 10px;
}

.btn.iconOnly {
  width: 34px;
  height: 34px;
  padding: 0;
  margin-left: auto;
  justify-content: center;
}

.adminContent {
  display: grid;
  align-content: start;
  gap: 18px;
}

@media (max-width: 760px) {
  .adminShell {
    grid-template-columns: 1fr;
  }
  .adminSidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .sideNav {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

- [ ] **Step 5: Verify manually**

Run: `npm run typecheck && npm run build`, then start `npm run dev` with a seeded `data/` (create an admin with `npm run account -- create-admin --username admin --password admin-secret-pw`), sign in, and confirm: sidebar navigation changes the hash; reload keeps the section; Users, Nodes, Network, Release render and every action (create user, reset, delete, generate seed node, probe, save, finalize, publish) still works; the sticky save bar appears when a field changes and disappears after saving.

- [ ] **Step 6: Commit (stage 1 complete)**

```bash
git add src/web src/web/styles.css
git -c commit.gpgsign=false commit -m "Split the admin into a sidebar shell with six sections"
```

---

### Task 6: Playbook engine (`playbooks.ts`) with tests

**Files:**
- Create: `src/web/admin/playbooks.ts`, `src/web/admin/playbooks.test.ts`

**Interfaces:**
- Consumes: `isOnline`, `telemetryNodes` from `./telemetry`; `SectionId` from `./sections`.
- Produces:
  ```ts
  export type PlaybookId = "launch" | "relaunch" | "change";
  export const PLAYBOOK_IDS: readonly PlaybookId[];
  export interface PlaybookInput { overview: AdminOverview; draft: PublicNetworkSettings; settingsDirty: boolean; now?: number }
  export interface StepDefinition { id: string; label: string; description: string; section: SectionId; optional?: boolean; done: (input: PlaybookInput) => boolean }
  export interface PlaybookDefinition { id: PlaybookId; title: string; selectLabel: string; steps: StepDefinition[] }
  export interface StepEvaluation { id: string; index: number; label: string; description: string; section: SectionId; optional: boolean; state: "done" | "current" | "pending"; skipped: boolean }
  export interface PlaybookEvaluation { playbook: PlaybookDefinition; steps: StepEvaluation[]; currentIndex: number; current?: StepEvaluation; doneCount: number; total: number; complete: boolean }
  export const PLAYBOOKS: Record<PlaybookId, PlaybookDefinition>;
  export function evaluatePlaybook(id: PlaybookId, input: PlaybookInput): PlaybookEvaluation;
  export function parsePlaybookId(value: string | null | undefined): PlaybookId;  // "launch" when invalid
  export const PLAYBOOK_STORAGE_KEY = "znn.admin.playbook";
  ```

- [ ] **Step 1: Write the failing test `src/web/admin/playbooks.test.ts`**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminOverview, PublicNetworkSettings, PublicPillar } from "../../shared/types";
import { evaluatePlaybook, parsePlaybookId, type PlaybookInput } from "./playbooks";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const HOUR = 3600;
const COMMIT = "9cde165877a1e4ff47d0df6cf8b8a65b121d550c";

function settings(overrides: Partial<PublicNetworkSettings> = {}): PublicNetworkSettings {
  return {
    chainIdentifier: 1,
    extraData: "x",
    expectedPillars: 3,
    minPillars: 2,
    genesisTimestampSec: Math.floor(NOW / 1000) + HOUR,
    goZenonRepo: "https://github.com/zenon-network/go-zenon.git",
    goZenonRef: "master",
    deploymentRepo: "https://github.com/hypercore-one/deployment.git",
    deploymentRef: "main",
    wipeDataOnPublish: false,
    sporkAddress: "z1",
    seeders: ["enode://a"],
    bootstrapPeers: [],
    sporks: [],
    genesisFunds: [],
    ...overrides
  };
}

function pillar(name: string, online: boolean, commit = COMMIT): PublicPillar {
  return {
    id: name,
    pillarName: name,
    pillarAddress: "",
    rewardAddress: "",
    producerAddress: "",
    producerIndex: 0,
    createdAt: "",
    nodeStatus: online
      ? { latest: { receivedAt: new Date(NOW - 10_000).toISOString(), sync: { state: 2 }, node: { serviceActive: true }, process: { commit } }, historyCount: 1 }
      : undefined
  };
}

function overview(overrides: Partial<AdminOverview> = {}): AdminOverview {
  const s = settings();
  return {
    user: { id: "a", username: "admin", role: "admin" },
    settings: s,
    repoPolicy: { allowedHosts: ["github.com"] },
    users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }],
    pillars: [],
    seedNodes: [],
    readiness: [{ label: "Seeders", ok: true, detail: "1 configured" }],
    genesis: {},
    configTemplate: {},
    ...overrides
  };
}

function input(o: AdminOverview, extra: Partial<PlaybookInput> = {}): PlaybookInput {
  return { overview: o, draft: o.settings, settingsDirty: false, now: NOW, ...extra };
}

describe("launch playbook", () => {
  it("starts at step 1 for an empty network", () => {
    const e = evaluatePlaybook("launch", input(overview()));
    assert.equal(e.currentIndex, 0);
    assert.equal(e.doneCount, 0);
    assert.equal(e.steps[0].state, "current");
    assert.equal(e.steps[1].state, "pending");
  });

  it("marks logins, nodes, and configuration done and points at Save when dirty", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", false), pillar("p2", false)]
    });
    const e = evaluatePlaybook("launch", input(o, { settingsDirty: true }));
    assert.deepEqual(e.steps.slice(0, 4).map((s) => s.state), ["done", "done", "done", "current"]);
    assert.equal(e.doneCount, 3);
  });

  it("never shows a later step done before an earlier one", () => {
    // Published, but no operator logins: step 1 is current and publish must show pending.
    const o = overview({ published: { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [] } });
    const e = evaluatePlaybook("launch", input(o));
    assert.equal(e.steps[0].state, "current");
    assert.equal(e.steps[5].state, "pending");
  });

  it("completes when everything is published and all nodes are online", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", true), pillar("p2", true)],
      finalizedAt: "2026-09-13T10:00:00Z",
      published: { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [] }
    });
    const e = evaluatePlaybook("launch", input(o));
    assert.equal(e.complete, true);
    assert.equal(e.doneCount, e.total);
    assert.equal(e.current, undefined);
  });
});

describe("relaunch playbook", () => {
  const published = { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [], genesisStartAt: "2026-09-13T13:00:00Z", actions: { wipeData: false } };

  it("requires a new future genesis time first", () => {
    const o = overview({ published, finalizedAt: "2026-09-13T10:00:00Z" });
    assert.equal(evaluatePlaybook("relaunch", input(o)).currentIndex, 0);
    const moved = { ...o.settings, genesisTimestampSec: Math.floor(NOW / 1000) + 2 * HOUR };
    const e = evaluatePlaybook("relaunch", input(o, { draft: moved, settingsDirty: true }));
    assert.equal(e.steps[0].state, "done");
    assert.equal(e.steps[1].state, "current");
  });

  it("keeps steps 1-5 done after the wiped publish even though the server cleared the wipe flag", () => {
    const later = { ...published, publishedAt: "2026-09-13T11:30:00Z", genesisStartAt: "2026-09-13T15:00:00Z", actions: { wipeData: true } };
    // Draft equals the published genesis time (15:00Z) and wipeDataOnPublish is false again, as after a real publish.
    const s = settings({ genesisTimestampSec: Math.floor(NOW / 1000) + 3 * HOUR, wipeDataOnPublish: false });
    const waiting = overview({ settings: s, published: later, finalizedAt: "2026-09-13T11:20:00Z", pillars: [pillar("p1", false)] });
    let e = evaluatePlaybook("relaunch", input(waiting, { draft: s }));
    assert.deepEqual(e.steps.map((step) => step.state), ["done", "done", "done", "done", "done", "current"]);
    const rejoined = overview({ ...waiting, pillars: [pillar("p1", true)] });
    e = evaluatePlaybook("relaunch", input(rejoined, { draft: s }));
    assert.equal(e.complete, true);
  });
});

describe("change playbook", () => {
  const published = {
    publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [],
    release: { goZenon: { repoUrl: "https://github.com/zenon-network/go-zenon.git", ref: "master", commit: COMMIT }, deployment: { repoUrl: "https://github.com/hypercore-one/deployment.git", ref: "main", commit: "b".repeat(40) } }
  };

  it("treats an unchanged target as not yet edited and skips the optional apply-time step", () => {
    const o = overview({ published });
    const e = evaluatePlaybook("change", input(o));
    assert.equal(e.steps[0].state, "current");
    assert.equal(e.steps[1].optional, true);
    assert.equal(e.steps[1].skipped, true);
  });

  it("walks edit -> save -> publish -> nodes apply, then returns to idle", () => {
    const idle = overview({ published, pillars: [pillar("p1", true, COMMIT)] });
    assert.equal(evaluatePlaybook("change", input(idle)).currentIndex, 0);

    const draft = { ...idle.settings, goZenonRef: "v2" };
    let e = evaluatePlaybook("change", input(idle, { draft, settingsDirty: true }));
    assert.equal(e.steps[0].state, "done");
    assert.equal(e.steps[2].state, "current");

    const saved = overview({ ...idle, settings: draft });
    e = evaluatePlaybook("change", input(saved, { draft }));
    assert.equal(e.steps[3].state, "current");

    const newPublished = { ...published, release: { ...published.release, goZenon: { ...published.release.goZenon, ref: "v2", commit: "1".repeat(40) } } };
    const rolling = overview({ ...saved, published: newPublished, pillars: [pillar("p1", true, COMMIT)] });
    e = evaluatePlaybook("change", input(rolling, { draft }));
    assert.deepEqual(e.steps.map((step) => step.state), ["done", "pending", "done", "done", "current"]);
    assert.equal(e.steps[1].skipped, true);

    const applied = overview({ ...rolling, pillars: [pillar("p1", true, "1".repeat(40))] });
    e = evaluatePlaybook("change", input(applied, { draft }));
    assert.equal(e.currentIndex, 0, "idle again once every node runs the published build");
  });
});

describe("parsePlaybookId", () => {
  it("accepts known ids and falls back to launch", () => {
    assert.equal(parsePlaybookId("relaunch"), "relaunch");
    assert.equal(parsePlaybookId("change"), "change");
    assert.equal(parsePlaybookId("nope"), "launch");
    assert.equal(parsePlaybookId(null), "launch");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/web/admin/playbooks.test.ts`
Expected: FAIL, cannot find module `./playbooks`.

- [ ] **Step 3: Create `src/web/admin/playbooks.ts`**

```ts
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
      { id: "logins", label: "Create operator logins", description: "One login per pillar or seed node.", section: "users", done: (i) => i.overview.users.some((u) => u.role === "user") },
      { id: "nodes", label: "Register nodes", description: "Operators create pillars; you generate seeds.", section: "nodes", done: (i) => i.overview.pillars.length >= i.overview.settings.minPillars },
      {
        id: "configure",
        label: "Configure network",
        description: "Chain ID, genesis time, release target.",
        section: "network",
        done: (i) => (i.draft.genesisTimestampSec > nowSec(i) || Boolean(i.overview.finalizedAt)) && readinessOk(i, "Seeders")
      },
      { id: "save", label: "Save settings", description: "Persist the draft so it can be finalized.", section: "network", done: (i) => !i.settingsDirty },
      { id: "finalize", label: "Finalize genesis", description: "Lock pillars and funds into genesis.json.", section: "release", done: (i) => Boolean(i.overview.finalizedAt) },
      { id: "publish", label: "Publish release", description: "Go public and instruct nodes to install.", section: "release", done: (i) => Boolean(i.overview.published) },
      { id: "online", label: "Verify nodes online", description: "All nodes report Online before genesis time.", section: "nodes", done: allOnline }
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
        }
      },
      { id: "wipe", label: "Enable data wipe", description: "Turn on “wipe node data on publish”.", section: "network", done: (i) => relaunchPublished(i) || i.draft.wipeDataOnPublish },
      { id: "save", label: "Save settings", description: "Persist the new draft.", section: "network", done: (i) => !i.settingsDirty },
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
        }
      },
      { id: "publish", label: "Publish release", description: "Nodes wipe chain data and restart.", section: "release", done: relaunchPublished },
      { id: "rejoin", label: "Verify nodes rejoin", description: "Watch health return to Online.", section: "nodes", done: allOnline }
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
        done: (i) => !targetMatchesPublished(i.draft, i.overview.published?.release) || upgradePending(i)
      },
      { id: "apply-at", label: "Set apply time (optional)", description: "Coordinate the switch-over moment.", section: "network", optional: true, done: (i) => Boolean(i.draft.releaseApplyAtSec) },
      { id: "save", label: "Save settings", description: "Persist the new target.", section: "network", done: (i) => !i.settingsDirty },
      { id: "publish", label: "Publish release", description: "Nodes build, verify and restart on it.", section: "release", done: (i) => targetMatchesPublished(i.draft, i.overview.published?.release) },
      {
        id: "applied",
        label: "Watch nodes apply",
        description: "Version column shows the new build.",
        section: "nodes",
        done: (i) => Boolean(i.overview.published?.release?.goZenon.commit) && allNodes(i).length > 0 && !upgradePending(i)
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
    let state: StepEvaluation["state"];
    let skipped = false;
    if (currentIndex >= 0) {
      state = "pending";
    } else if (step.done(input)) {
      state = "done";
    } else if (optional) {
      state = "pending";
      skipped = true;
    } else {
      state = "current";
      currentIndex = index;
    }
    steps.push({ id: step.id, index, label: step.label, description: step.description, section: step.section, optional, state, skipped });
  }
  const doneCount = steps.filter((step) => step.state === "done").length;
  return {
    playbook,
    steps,
    currentIndex,
    current: currentIndex >= 0 ? steps[currentIndex] : undefined,
    doneCount,
    total: steps.length,
    complete: currentIndex < 0
  };
}

export function parsePlaybookId(value: string | null | undefined): PlaybookId {
  return (PLAYBOOK_IDS as readonly string[]).includes(value ?? "") ? (value as PlaybookId) : "launch";
}
```

Note on the change playbook: while nodes are still applying a published upgrade, steps 1-4 stay done and "Watch nodes apply" is current. Once every node reports the published commit, the draft matches the release and nothing is pending, so the checklist returns to its idle state with "Edit release target" current; that is intended, the cycle is over and the next action is a new edit.

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/web/admin/playbooks.test.ts`
Expected: PASS. If the "walks edit -> save -> publish -> nodes apply" case fails on the first assertion because step 1 evaluates `done` with an unchanged target, re-read `targetMatchesPublished`: the draft ref `v2` differs from published `master`, so `edit` must be done.

- [ ] **Step 5: Commit**

```bash
git add src/web/admin/playbooks.ts src/web/admin/playbooks.test.ts
git -c commit.gpgsign=false commit -m "Add playbook step evaluation with tests"
```

---

### Task 7: Launch bar and Launch Ops section

**Files:**
- Create: `src/web/admin/LaunchBar.tsx`, `src/web/admin/LaunchOps.tsx`, `src/web/admin/usePlaybook.ts`
- Modify: `src/web/admin/AdminApp.tsx`, `src/web/styles.css`

**Interfaces:**
- Consumes: `evaluatePlaybook`, `PLAYBOOKS`, `PLAYBOOK_IDS`, `PLAYBOOK_STORAGE_KEY`, `parsePlaybookId`, types from `./playbooks`; `SectionId`, `SECTION_LABELS` from `./sections`.
- Produces:
  ```tsx
  export function usePlaybook(): [PlaybookId, (id: PlaybookId) => void]
  export function LaunchBar(props: { playbook: PlaybookId; onPlaybookChange: (id: PlaybookId) => void; evaluation: PlaybookEvaluation; onNavigate: (s: SectionId) => void })
  export function LaunchOps(props: { overview: AdminOverview; nodes: TelemetryNode[]; settingsDirty: boolean; evaluation: PlaybookEvaluation; onNavigate: (s: SectionId) => void })
  export function StepCircle(props: { state: "done" | "current" | "pending"; index: number })   // in LaunchBar.tsx, reused by LaunchOps
  ```

- [ ] **Step 1: Create `src/web/admin/usePlaybook.ts`**

```ts
import { useCallback, useState } from "react";
import { parsePlaybookId, PLAYBOOK_STORAGE_KEY, type PlaybookId } from "./playbooks";

function readStored(): PlaybookId {
  try {
    return parsePlaybookId(window.localStorage.getItem(PLAYBOOK_STORAGE_KEY));
  } catch {
    return "launch";
  }
}

export function usePlaybook(): [PlaybookId, (id: PlaybookId) => void] {
  const [playbook, setPlaybookState] = useState<PlaybookId>(readStored);
  const setPlaybook = useCallback((id: PlaybookId) => {
    setPlaybookState(id);
    try {
      window.localStorage.setItem(PLAYBOOK_STORAGE_KEY, id);
    } catch {
      // storage unavailable; the choice just does not persist
    }
  }, []);
  return [playbook, setPlaybook];
}
```

- [ ] **Step 2: Create `src/web/admin/LaunchBar.tsx`**

```tsx
import { Check } from "lucide-react";
import { PLAYBOOK_IDS, PLAYBOOKS, type PlaybookEvaluation, type PlaybookId } from "./playbooks";
import { SECTION_LABELS, type SectionId } from "./sections";

export function StepCircle({ state, index }: { state: "done" | "current" | "pending"; index: number }) {
  return <span className={`stepCircle ${state}`}>{state === "done" ? <Check size={14} /> : index + 1}</span>;
}

export function LaunchBar({ playbook, onPlaybookChange, evaluation, onNavigate }: {
  playbook: PlaybookId;
  onPlaybookChange: (id: PlaybookId) => void;
  evaluation: PlaybookEvaluation;
  onNavigate: (section: SectionId) => void;
}) {
  const current = evaluation.current;
  return (
    <div className="launchBar">
      <select className="launchSelect" value={playbook} onChange={(event) => onPlaybookChange(event.target.value as PlaybookId)} aria-label="Playbook">
        {PLAYBOOK_IDS.map((id) => (
          <option key={id} value={id}>{PLAYBOOKS[id].selectLabel}</option>
        ))}
      </select>
      <ol className="stepper" aria-label={`${evaluation.playbook.title}: ${evaluation.doneCount} of ${evaluation.total} done`}>
        {evaluation.steps.map((step) => (
          <li key={step.id} className="stepperItem">
            <button type="button" className="stepperButton" title={step.label} onClick={() => onNavigate(step.section)}>
              <StepCircle state={step.state} index={step.index} />
            </button>
            {step.index < evaluation.total - 1 ? <span className={`stepperLine${step.state === "done" ? " done" : ""}`} /> : null}
          </li>
        ))}
      </ol>
      <div className="nextHint">
        {current ? (
          <>
            <span>Next: <strong>{current.label}</strong></span>
            <button type="button" className="btn primary small" onClick={() => onNavigate(current.section)}>Go</button>
          </>
        ) : (
          <span className="mono mutedText">All steps complete</span>
        )}
        <span className="visuallyHidden">{SECTION_LABELS[current?.section ?? "status"]}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/web/admin/LaunchOps.tsx`**

```tsx
import type { AdminOverview } from "../../shared/types";
import { formatUtc } from "../shared/format";
import { StepCircle } from "./LaunchBar";
import type { PlaybookEvaluation } from "./playbooks";
import { SECTION_LABELS, type SectionId } from "./sections";
import { SectionHeader } from "./SectionHeader";
import { isOnline, nodeHealth, type TelemetryNode } from "./telemetry";

export function LaunchOps({ overview, nodes, settingsDirty, evaluation, onNavigate }: {
  overview: AdminOverview;
  nodes: TelemetryNode[];
  settingsDirty: boolean;
  evaluation: PlaybookEvaluation;
  onNavigate: (section: SectionId) => void;
}) {
  const admins = overview.users.filter((u) => u.role === "admin").length;
  const operators = overview.users.length - admins;
  const healthy = nodes.filter((n) => isOnline(n)).length;
  const attention = nodes.filter((n) => !isOnline(n));
  const firstAttention = attention[0];
  const genesis = new Date(overview.settings.genesisTimestampSec * 1000).toISOString();

  return (
    <>
      <SectionHeader
        kicker={`Testnet-${overview.settings.chainIdentifier} · genesis ${formatUtc(genesis)}`}
        title="Launch Ops"
        aside={<span className="mono mutedText"><span className={`liveDot${evaluation.complete ? " on" : ""}`} /> {evaluation.doneCount} of {evaluation.total} steps done</span>}
      />
      <div className="sectionCards">
        <button type="button" className="sectionCard" onClick={() => onNavigate("users")}>
          <span className="ledger">Users</span>
          <strong className="mono">{overview.users.length}</strong>
          <small>{admins} admin{admins === 1 ? "" : "s"} · {operators} operator{operators === 1 ? "" : "s"}</small>
        </button>
        <button type="button" className={`sectionCard${attention.length ? " danger" : ""}`} onClick={() => onNavigate("nodes")}>
          <span className="ledger">Nodes</span>
          <strong className="mono">{healthy}<span className="mutedText">/{nodes.length} healthy</span></strong>
          <small>{firstAttention ? `${firstAttention.name} ${nodeHealth(firstAttention).label.toLowerCase()} — needs attention` : nodes.length ? "All nodes healthy" : "No nodes yet"}</small>
        </button>
        <button type="button" className={`sectionCard${settingsDirty ? " warn" : ""}`} onClick={() => onNavigate("network")}>
          <span className="ledger">Network</span>
          <strong className="mono">{settingsDirty ? "Draft" : "Saved"}</strong>
          <small>{settingsDirty ? "Unsaved changes — save to unlock Finalize" : "Settings are saved"}</small>
        </button>
        <button type="button" className="sectionCard" onClick={() => onNavigate("release")}>
          <span className="ledger">Release</span>
          <strong className="mono">{overview.published ? formatUtc(overview.published.publishedAt) : "—"}</strong>
          <small>{overview.published ? "Published" : overview.finalizedAt ? "Finalized · not published yet" : "Not finalized · nothing published yet"}</small>
        </button>
      </div>
      <section className="panel">
        <div className="panelHeader"><div><span className="ledger">Playbook</span><h2>{evaluation.playbook.title}</h2></div></div>
        <div className="checklist">
          {evaluation.steps.map((step) => (
            <button key={step.id} type="button" className={`checklistRow ${step.state}`} onClick={() => onNavigate(step.section)}>
              <StepCircle state={step.state} index={step.index} />
              <strong>{step.label}{step.optional ? <span className="mutedText"> (optional)</span> : null}</strong>
              <span className="mutedText">{step.description}</span>
              <span className="ledger">{SECTION_LABELS[step.section]}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="readinessTiles">
        {overview.readiness.map((check) => (
          <div key={check.label} className="readinessTile">
            <span className={`readinessDot${check.ok ? " ok" : ""}`} />
            <div><strong>{check.label}</strong><small className="mutedText">{check.detail}</small></div>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Wire into `AdminApp.tsx`**

Add `const [playbook, setPlaybook] = usePlaybook();` and `const evaluation = useMemo(() => evaluatePlaybook(playbook, { overview: session, draft: settingsDraft, settingsDirty }), [playbook, session, settingsDraft, settingsDirty]);`. Render `<LaunchBar playbook={playbook} onPlaybookChange={setPlaybook} evaluation={evaluation} onNavigate={setSection} />` as the first child of `<main>`, and replace the `launch` placeholder with `<LaunchOps overview={session} nodes={nodes} settingsDirty={settingsDirty} evaluation={evaluation} onNavigate={setSection} />`.

- [ ] **Step 5: Append CSS**

```css
.launchBar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin: -28px -28px 0;
  border-bottom: 1px solid var(--border);
  background: #181b1a;
  padding: 12px 24px;
}

.launchSelect {
  min-width: 220px;
}

.stepper {
  display: flex;
  align-items: center;
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
}

.stepperItem {
  display: flex;
  align-items: center;
}

.stepperButton {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.stepperLine {
  display: block;
  width: 26px;
  height: 2px;
  background: #2a302d;
}

.stepperLine.done {
  background: rgba(0, 213, 87, 0.4);
}

.nextHint {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.btn.small {
  min-height: 30px;
  padding: 4px 12px;
  font-size: 0.85rem;
}

.visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.sectionCards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}

.sectionCard {
  display: grid;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  background: var(--panel);
  padding: 14px;
  text-align: left;
  cursor: pointer;
}

.sectionCard:hover {
  background: var(--panel-2);
}

.sectionCard strong {
  font-size: 1.25rem;
}

.sectionCard small {
  color: var(--muted);
}

.sectionCard.danger {
  border-color: rgba(255, 84, 112, 0.45);
}

.sectionCard.warn {
  border-color: rgba(247, 201, 72, 0.38);
}

.checklist {
  display: grid;
}

.checklistRow {
  display: grid;
  grid-template-columns: auto minmax(180px, auto) minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  border: 0;
  border-bottom: 1px solid #272c2a;
  color: var(--text);
  background: transparent;
  padding: 10px 0;
  text-align: left;
  cursor: pointer;
}

.checklistRow:last-child {
  border-bottom: 0;
}

.checklistRow.pending strong {
  color: var(--muted);
}

.readinessTiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.readinessTile {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 13px;
}

.readinessTile strong,
.readinessTile small {
  display: block;
}

.readinessDot {
  flex: none;
  width: 10px;
  height: 10px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--warn);
}

.readinessDot.ok {
  background: var(--green);
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npm run build`. In the dev server: switch playbooks, confirm the stepper reflects real state (create an operator login and watch step 1 complete), the "Go" button and step circles navigate, and the choice survives a reload.

- [ ] **Step 7: Commit (stage 2 complete)**

```bash
git add src/web/admin src/web/styles.css
git -c commit.gpgsign=false commit -m "Add the launch bar, playbooks, and Launch Ops section"
```

---

### Task 8: Status aggregates (`statusAggregates.ts`) with tests

**Files:**
- Create: `src/web/admin/statusAggregates.ts`, `src/web/admin/statusAggregates.test.ts`

**Interfaces:**
- Consumes: `TelemetryNode`, `nodeHealth`, `isOnline`, `formatAge`, `HealthTone` from `./telemetry`.
- Produces:
  ```ts
  export interface StatusTiles { momentumHeight?: number; maxLag: number; activeNodes: number; totalNodes: number; producingPillars: number; totalPillars: number; avgPeers?: number }
  export interface AttentionItem { id: string; name: string; tone: HealthTone; label: string; message: string }
  export interface HealthCount { label: string; tone: HealthTone; count: number }
  export function statusTiles(nodes: TelemetryNode[], now?: number): StatusTiles
  export function attentionItems(nodes: TelemetryNode[], now?: number): AttentionItem[]
  export function healthCounts(nodes: TelemetryNode[], now?: number): HealthCount[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionItems, healthCounts, statusTiles } from "./statusAggregates";
import type { TelemetryNode } from "./telemetry";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

function node(name: string, nodeType: "pillar" | "seed", latest?: Partial<NonNullable<TelemetryNode["nodeStatus"]>["latest"]>): TelemetryNode {
  return { id: name, name, nodeType, nodeStatus: latest ? { latest: { receivedAt: ago(10), ...latest }, historyCount: 1 } : undefined };
}

const fleet: TelemetryNode[] = [
  node("alpha", "pillar", { sync: { state: 2, currentHeight: 184220, targetHeight: 184220 }, network: { peerCount: 9 } }),
  node("beta", "pillar", { sync: { state: 2, currentHeight: 184220, targetHeight: 184220 }, network: { peerCount: 8 } }),
  node("gamma", "pillar", { sync: { state: 1, currentHeight: 163904, targetHeight: 184220 }, network: { peerCount: 7 } }),
  node("seed-frankfurt", "seed", { sync: { state: 2, currentHeight: 184220, targetHeight: 184220 }, network: { peerCount: 11 } }),
  node("seed-osaka", "seed", { receivedAt: ago(18 * 60), sync: { state: 2, currentHeight: 180011, targetHeight: 180011 } })
];

describe("statusTiles", () => {
  it("aggregates heights, active nodes, producing pillars, and peers", () => {
    const tiles = statusTiles(fleet, NOW);
    assert.equal(tiles.momentumHeight, 184220);
    assert.equal(tiles.maxLag, 20316);
    assert.equal(tiles.activeNodes, 4);
    assert.equal(tiles.totalNodes, 5);
    assert.equal(tiles.producingPillars, 2);
    assert.equal(tiles.totalPillars, 3);
    assert.equal(tiles.avgPeers, 8.75);
  });

  it("is empty-safe", () => {
    const tiles = statusTiles([], NOW);
    assert.equal(tiles.momentumHeight, undefined);
    assert.equal(tiles.avgPeers, undefined);
    assert.equal(tiles.activeNodes, 0);
  });
});

describe("attentionItems and healthCounts", () => {
  it("lists every node that is not Online with a human message", () => {
    const items = attentionItems(fleet, NOW);
    assert.deepEqual(items.map((i) => [i.name, i.label]), [["gamma", "Syncing"], ["seed-osaka", "Stale"]]);
    assert.match(items[0].message, /20,316 momentums behind/);
    assert.match(items[1].message, /No report for 18m/);
  });

  it("describes install failures, no reports, and errors", () => {
    const items = attentionItems([
      node("x", "pillar", { node: { lastError: "Built znnd commit abc does not match" } }),
      node("y", "pillar"),
      node("z", "pillar", { logs: { errorCountLastMinute: 3 } })
    ], NOW);
    assert.equal(items[0].message, "Built znnd commit abc does not match");
    assert.match(items[1].message, /Has not reported yet/);
    assert.match(items[2].message, /3 errors in the last minute/);
  });

  it("counts nodes per health label", () => {
    assert.deepEqual(healthCounts(fleet, NOW), [
      { label: "Online", tone: "ok", count: 3 },
      { label: "Syncing", tone: "warn", count: 1 },
      { label: "Stale", tone: "bad", count: 1 }
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/web/admin/statusAggregates.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Create `src/web/admin/statusAggregates.ts`**

```ts
import { formatAge, isOnline, nodeHealth, type HealthTone, type TelemetryNode } from "./telemetry";

export interface StatusTiles {
  momentumHeight?: number;
  maxLag: number;
  activeNodes: number;
  totalNodes: number;
  producingPillars: number;
  totalPillars: number;
  avgPeers?: number;
}

export interface AttentionItem {
  id: string;
  name: string;
  tone: HealthTone;
  label: string;
  message: string;
}

export interface HealthCount {
  label: string;
  tone: HealthTone;
  count: number;
}

const ACTIVE_WITHIN_MS = 5 * 60 * 1000;

export function statusTiles(nodes: TelemetryNode[], now = Date.now()): StatusTiles {
  const reports = nodes.map((node) => node.nodeStatus?.latest).filter((latest): latest is NonNullable<typeof latest> => Boolean(latest));
  const heights = reports.map((r) => r.sync?.currentHeight).filter((h): h is number => typeof h === "number");
  const lags = reports
    .map((r) => (typeof r.sync?.currentHeight === "number" && typeof r.sync.targetHeight === "number" ? Math.max(0, r.sync.targetHeight - r.sync.currentHeight) : 0));
  const peers = reports.map((r) => r.network?.peerCount).filter((p): p is number => typeof p === "number");
  const pillars = nodes.filter((node) => node.nodeType === "pillar");
  return {
    momentumHeight: heights.length ? Math.max(...heights) : undefined,
    maxLag: lags.length ? Math.max(...lags) : 0,
    activeNodes: reports.filter((r) => now - Date.parse(r.receivedAt) < ACTIVE_WITHIN_MS).length,
    totalNodes: nodes.length,
    producingPillars: pillars.filter((node) => isOnline(node, now)).length,
    totalPillars: pillars.length,
    avgPeers: peers.length ? peers.reduce((a, b) => a + b, 0) / peers.length : undefined
  };
}

function attentionMessage(node: TelemetryNode, label: string, now: number): string {
  const latest = node.nodeStatus?.latest;
  switch (label) {
    case "No report":
      return "Has not reported yet — run the bootstrap command.";
    case "Stale":
      return `No report for ${formatAge(latest?.receivedAt, now).replace(" ago", "")} — check the machine or re-run the bootstrap command.`;
    case "Install failed":
      return latest?.node?.lastError ?? "The last release could not be applied.";
    case "Service down":
      return "Service is not running.";
    case "Errors":
      return `${latest?.logs?.errorCountLastMinute ?? 0} errors in the last minute.`;
    case "Clock skew": {
      const reported = latest?.reportedAt ? Date.parse(latest.reportedAt) : Number.NaN;
      const received = latest?.receivedAt ? Date.parse(latest.receivedAt) : Number.NaN;
      const skew = Number.isNaN(reported) || Number.isNaN(received) ? 0 : Math.round((reported - received) / 1000);
      return `Clock is ${Math.abs(skew)} s off.`;
    }
    case "Waiting":
      return "Waiting for a published release.";
    case "Syncing":
    case "Lagging": {
      const behind = typeof latest?.sync?.currentHeight === "number" && typeof latest.sync.targetHeight === "number" ? Math.max(0, latest.sync.targetHeight - latest.sync.currentHeight) : 0;
      return `Syncing, ${behind.toLocaleString("en-US")} momentums behind — catching up normally.`;
    }
    default:
      return label;
  }
}

export function attentionItems(nodes: TelemetryNode[], now = Date.now()): AttentionItem[] {
  return nodes
    .map((node) => ({ node, health: nodeHealth(node, now) }))
    .filter(({ health }) => health.label !== "Online")
    .map(({ node, health }) => ({ id: node.id, name: node.name, tone: health.tone, label: health.label, message: attentionMessage(node, health.label, now) }));
}

export function healthCounts(nodes: TelemetryNode[], now = Date.now()): HealthCount[] {
  const counts = new Map<string, HealthCount>();
  for (const node of nodes) {
    const health = nodeHealth(node, now);
    const entry = counts.get(health.label) ?? { label: health.label, tone: health.tone, count: 0 };
    entry.count += 1;
    counts.set(health.label, entry);
  }
  const order: HealthTone[] = ["ok", "warn", "bad", "muted"];
  return [...counts.values()].sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone) || b.count - a.count);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/web/admin/statusAggregates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/admin/statusAggregates.ts src/web/admin/statusAggregates.test.ts
git -c commit.gpgsign=false commit -m "Add Status view aggregates with tests"
```

---

### Task 9: Status view

**Files:**
- Create: `src/web/admin/StatusView.tsx`
- Modify: `src/web/admin/AdminApp.tsx`, `src/web/styles.css`

**Interfaces:**
- Consumes: `statusTiles`, `attentionItems` from `./statusAggregates`; `formatAge`, `nodeHealth`, `shortCommit` from `./telemetry`; `StatTile`, `RefreshButton`, `Button` from `../shared/ui`; `publicUrl`, `formatUtc`, `copy` from `../shared/format`.
- Produces: `export function StatusView(props: { overview: AdminOverview; nodes: TelemetryNode[]; refresh: () => Promise<void>; refreshState: RefreshState; lastUpdatedAt: number; onNavigate: (s: SectionId) => void })`

- [ ] **Step 1: Track the last update time in `AdminApp`**

Add `const [lastUpdatedAt, setLastUpdatedAt] = useState(Date.now());` and `useEffect(() => setLastUpdatedAt(Date.now()), [session]);`. Add a one-second ticker only while the Status section is shown: `const [, setTick] = useState(0); useEffect(() => { if (section !== "status") return; const id = window.setInterval(() => setTick((t) => t + 1), 1000); return () => window.clearInterval(id); }, [section]);`.

- [ ] **Step 2: Create `src/web/admin/StatusView.tsx`**

```tsx
import { Copy } from "lucide-react";
import type { AdminOverview } from "../../shared/types";
import type { RefreshState } from "../shared/api";
import { copy, formatUtc, publicUrl } from "../shared/format";
import { Button, RefreshButton, StatTile } from "../shared/ui";
import { SectionHeader } from "./SectionHeader";
import type { SectionId } from "./sections";
import { attentionItems, statusTiles } from "./statusAggregates";
import { formatAge, nodeHealth, shortCommit, type TelemetryNode } from "./telemetry";

export function StatusView({ overview, nodes, refresh, refreshState, lastUpdatedAt, onNavigate }: {
  overview: AdminOverview;
  nodes: TelemetryNode[];
  refresh: () => Promise<void>;
  refreshState: RefreshState;
  lastUpdatedAt: number;
  onNavigate: (section: SectionId) => void;
}) {
  const now = Date.now();
  const tiles = statusTiles(nodes, now);
  const attention = attentionItems(nodes, now);
  const published = overview.published;
  const release = published?.release;
  const artifacts = published
    ? [
        { name: "genesis.json", url: publicUrl(published.genesisPath) },
        { name: "config.json", url: publicUrl(published.configPath) },
        ...(published.nodePlanPath ? [{ name: "node-plan.json", url: publicUrl(published.nodePlanPath) }] : [])
      ]
    : [];
  const secondsAgo = Math.max(0, Math.floor((now - lastUpdatedAt) / 1000));

  return (
    <>
      <SectionHeader
        kicker={`Testnet-${overview.settings.chainIdentifier} · ${published ? "running" : "not launched"}`}
        title={<><span className={`liveDot${published ? " on" : ""}`} /> Network Status</> as unknown as string}
        aside={<><span className="mono mutedText">Auto-refreshes every 30s · last update {secondsAgo}s ago</span><RefreshButton refresh={refresh} state={refreshState} /></>}
      />
      <div className="statTiles statusTiles">
        <StatTile label="Momentum height" value={tiles.momentumHeight?.toLocaleString("en-US") ?? "—"} hint={tiles.momentumHeight === undefined ? undefined : tiles.maxLag === 0 ? "in sync" : `${tiles.maxLag.toLocaleString("en-US")} behind`} />
        <StatTile label="Active nodes" value={`${tiles.activeNodes} / ${tiles.totalNodes}`} hint="reported in the last 5 min" />
        <StatTile label="Pillars producing" value={`${tiles.producingPillars} / ${tiles.totalPillars}`} />
        <StatTile label="Avg peers" value={tiles.avgPeers === undefined ? "—" : tiles.avgPeers.toFixed(1)} />
        <StatTile label="Release" value={release ? `${release.goZenon.ref} @ ${shortCommit(release.goZenon.commit)}` : "—"} hint={published ? `published ${formatUtc(published.publishedAt)}` : undefined} />
        <StatTile label="Genesis" value={formatUtc(new Date(overview.settings.genesisTimestampSec * 1000).toISOString())} hint={`chain ${overview.settings.chainIdentifier}`} />
      </div>
      <section className="panel">
        <div className="panelHeader"><div><span className="ledger">Alerts</span><h2>Needs attention</h2></div></div>
        {attention.length ? (
          <div className="attentionList">
            {attention.map((item) => (
              <button key={item.id} type="button" className="attentionRow" onClick={() => onNavigate("nodes")}>
                <strong>{item.name}</strong>
                <span className="mutedText">{item.message}</span>
                <span className="ledger">Nodes →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mono mutedText">All nodes online</div>
        )}
      </section>
      <div className="statusColumns">
        <section className="panel">
          <div className="panelHeader"><div><span className="ledger">Telemetry</span><h2>Node health</h2></div></div>
          <div className="healthList">
            {nodes.map((node) => {
              const health = nodeHealth(node, now);
              return (
                <div key={node.id} className="healthRow">
                  <span>{node.name}</span>
                  <span className="mono mutedText">{node.nodeType}</span>
                  <span className="mono mutedText">{formatAge(node.nodeStatus?.latest?.receivedAt, now)}</span>
                  <span className={`statusPill ${health.tone}`}>{health.label}</span>
                </div>
              );
            })}
            {nodes.length === 0 ? <div className="emptyState">No nodes registered yet</div> : null}
          </div>
          <div className="toolbar"><Button variant="secondary" onClick={() => onNavigate("nodes")}>Full telemetry</Button></div>
        </section>
        <section className="panel">
          <div className="panelHeader"><div><span className="ledger">Release</span><h2>Current release</h2></div></div>
          {published && release ? (
            <>
              <div className="kvRows">
                <span className="ledger">go-zenon</span><span className="mono">{release.goZenon.ref} @ {shortCommit(release.goZenon.commit)}</span>
                <span className="ledger">Deployment</span><span className="mono">{release.deployment.ref} @ {shortCommit(release.deployment.commit)}</span>
                <span className="ledger">Published</span><span className="mono">{formatUtc(published.publishedAt)}</span>
              </div>
              <div className="artifactRows">
                {artifacts.map((file) => (
                  <button key={file.name} type="button" className="artifactRow" onClick={() => copy(file.url)} title={`Copy ${file.url}`}>
                    <span className="mono artifactName">{file.name}</span>
                    <span className="mono mutedText artifactUrl">{file.url}</span>
                    <Copy size={16} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="emptyState">Nothing published yet.</div>
          )}
          <div className="toolbar"><Button variant="secondary" onClick={() => onNavigate("release")}>Release details</Button></div>
        </section>
      </div>
    </>
  );
}
```

Change `SectionHeader`'s `title` prop type to `React.ReactNode` (Task 4 file) and remove the `as unknown as string` cast above.

- [ ] **Step 3: Wire into `AdminApp.tsx`**

Replace the `status` placeholder with `<StatusView overview={session} nodes={nodes} refresh={refresh} refreshState={refreshState} lastUpdatedAt={lastUpdatedAt} onNavigate={setSection} />`.

- [ ] **Step 4: Append CSS**

```css
.statusTiles {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.sectionHeader h1 .liveDot {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 10px;
  vertical-align: middle;
  box-shadow: 0 0 0 4px rgba(0, 213, 87, 0.15);
}

.attentionList,
.healthList,
.artifactRows {
  display: grid;
}

.attentionRow,
.healthRow,
.artifactRow {
  display: grid;
  gap: 12px;
  align-items: center;
  border: 0;
  border-bottom: 1px solid #272c2a;
  color: var(--text);
  background: transparent;
  padding: 10px 0;
  text-align: left;
}

.attentionRow:last-child,
.healthRow:last-child,
.artifactRow:last-child {
  border-bottom: 0;
}

.attentionRow {
  grid-template-columns: minmax(110px, auto) minmax(0, 1fr) auto;
  cursor: pointer;
}

.healthRow {
  grid-template-columns: minmax(0, 1fr) auto auto auto;
}

.statusColumns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.kvRows {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 14px;
  align-items: center;
  margin-bottom: 12px;
}

.artifactRow {
  grid-template-columns: auto minmax(0, 1fr) auto;
  cursor: pointer;
}

.artifactName {
  color: var(--green);
}

.artifactUrl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run build`. In the dev server with a published release, confirm the tiles, attention list, health roll-up, and artifact copy rows; before publishing, confirm the empty states and that the default section is Launch Ops.

- [ ] **Step 6: Commit (stage 3 complete)**

```bash
git add src/web/admin src/web/styles.css
git -c commit.gpgsign=false commit -m "Add the Network Status view"
```

---

### Task 10: Tooltips

**Files:**
- Create: `src/web/admin/tooltips.ts`, `src/web/admin/Tooltip.tsx`
- Modify: `src/web/styles.css`, and every section file to place the tips

**Interfaces:**
- Produces: `export const TIPS: Record<TipKey, string>`, `export const READINESS_TIPS: Record<string, string>`, `export function Tooltip({ text }: { text: string })`.

- [ ] **Step 1: Create `src/web/admin/tooltips.ts`**

Copy every entry from the spec's Tooltips section verbatim:

```ts
export const TIPS = {
  "status.attention": "Anything not reporting Online shows up here. Click an item to jump to its node.",
  "status.health": "Live roll-up from each node's bootstrap agent. Full telemetry table is on the Nodes page.",
  "status.release": "What every node is running right now. Public URLs are what operators and explorers download.",
  "launch.checklist": "Pick a playbook in the top bar. Steps check themselves off as the network state changes; click any step to jump to the right page.",
  "users.add": "Use Generate for a strong password, then Copy Login to send URL + credentials to the operator in one message.",
  "users.role": "Operators manage a single node. Admins see this console. You almost always want Operator.",
  "nodes.health": "Each node's bootstrap agent reports every minute. Stale means no report for 5+ minutes — check the machine or re-run the bootstrap command.",
  "nodes.pillars": "Registered by operators from their own logins. Deleting a pillar frees its login for reuse and removes it from the genesis.",
  "nodes.seeds": "You generate seed nodes for an unused operator login. The generated enode and multiaddr are added to Seeders and Bootstrap Peers automatically.",
  "network.genesis": "Chain identifier and genesis time are baked into genesis.json. Changing them after launch means a relaunch — every node wipes and restarts from the new genesis.",
  "network.genesisTime": "The moment pillars begin producing momentums. Set it far enough out for all operators to bootstrap first.",
  "network.minPillars": "Finalize is blocked until at least the minimum number of pillars have registered.",
  "network.release": "Which go-zenon build nodes install. Empty commit pins are resolved to the ref's current commit at publish time, so every release is immutable.",
  "network.commitPin": "Optional. Full 40-character hash. Nodes refuse to start a binary whose embedded revision differs from the pin.",
  "network.applyAt": "Optional. All nodes switch to the new release at this moment instead of immediately — use it to coordinate upgrades.",
  "network.seeders": "How new nodes find the network. Generated seed nodes are added automatically; use the probe to add an external seeder by IP.",
  "network.sporks": "Protocol feature flags activated at a height. Most testnets launch with none.",
  "network.funds": "Extra genesis balances beyond pillar allocations — e.g. the faucet address.",
  "release.review": "A live preview built from current registrations and saved settings. Check pillar count, genesis time and funds before locking anything.",
  "release.finalize": "Locks the pillar set, funds and genesis time into a fixed genesis.json. You can re-finalize before publishing if something changes.",
  "release.publish": "Makes genesis.json, config.json and the node plan public, and instructs every bootstrapped node to install this release. Published releases are immutable — publishing again creates a new one.",
  "release.wipe": "When on, every node deletes its chain data and restarts from the new genesis — required for a relaunch, destructive otherwise. Toggle it on the Network page."
} as const;

export type TipKey = keyof typeof TIPS;

export const READINESS_TIPS: Record<string, string> = {
  "Minimum pillars": "Finalize is blocked until at least the minimum number of pillars have registered.",
  "Expected pillars": "Every expected pillar has registered from its operator login.",
  "Spork address": "The wallet that controls spork activation; generated on first start.",
  "Active sporks": "Protocol feature flags activated at a height. Most testnets launch with none.",
  Seeders: "New nodes use seeders to discover the network. Two or more is healthy.",
  "Bootstrap peers": "libp2p peers new nodes dial first; generated seed nodes are added automatically."
};
```

- [ ] **Step 2: Create `src/web/admin/Tooltip.tsx`**

```tsx
export function Tooltip({ text }: { text: string }) {
  return (
    <button type="button" className="tip" data-tip={text} aria-label={text} onClick={(event) => event.preventDefault()}>
      ?
    </button>
  );
}
```

- [ ] **Step 3: Append CSS**

```css
.tip {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  border: 1px solid #3d4442;
  border-radius: 50%;
  color: var(--muted);
  background: transparent;
  padding: 0;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  line-height: 1;
  vertical-align: middle;
  cursor: help;
}

.tip::after {
  content: attr(data-tip);
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 20;
  width: max-content;
  max-width: 270px;
  border: 1px solid #3d4442;
  border-radius: var(--radius);
  color: #e6ece9;
  background: #0e100f;
  padding: 9px 11px;
  font-family: "Space Grotesk", system-ui, sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
  white-space: normal;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.tip:hover::after,
.tip:focus-visible::after {
  opacity: 1;
}
```

- [ ] **Step 4: Place the tips**

Add `<Tooltip text={TIPS["..."]} />` next to the matching heading or label in each section:
- StatusView: Needs attention h2 (`status.attention`), Node health h2 (`status.health`), Current release h2 (`status.release`).
- LaunchOps: checklist h2 (`launch.checklist`); each readiness tile label gets `READINESS_TIPS[check.label]` when defined.
- UsersSection: Add a login h2 (`users.add`), Role label (`users.role`).
- NodesSection: Health h2 (`nodes.health`), Pillars h2 (`nodes.pillars`), Seed nodes h2 (`nodes.seeds`).
- NetworkSection: Genesis basics h2 (`network.genesis`), Genesis Start label (`network.genesisTime`), Minimum Pillars label (`network.minPillars`), Release target h2 (`network.release`), both Commit Pin labels (`network.commitPin`), Apply Release At label (`network.applyAt`), Seeders & bootstrap peers h2 (`network.seeders`), Sporks h2 (`network.sporks`), Funded addresses h2 (`network.funds`).
- ReleaseSection: card h2s (`release.review`, `release.finalize`, `release.publish`) and the wipe banner (`release.wipe`).

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`. In the browser: hover and Tab to a `?` and confirm the popover shows, that a click inside a form does not submit it, and that the last column's popover is not clipped (add `.tableWrap { overflow: visible }` exceptions only if needed).

- [ ] **Step 6: Commit**

```bash
git add src/web/admin src/web/styles.css
git -c commit.gpgsign=false commit -m "Add tooltips across the admin sections"
```

---

### Task 11: Nodes header summary, polish, and docs

**Files:**
- Modify: `src/web/admin/NodesSection.tsx`, `README.md`

- [ ] **Step 1: Health summary pills in the Nodes header**

In `NodesSection`, import `healthCounts` from `./statusAggregates`, compute `const counts = healthCounts(nodes);` and pass to `SectionHeader` `aside={counts.map((c) => <span key={c.label} className={`statusPill ${c.tone}`}>{c.count} {c.label}</span>)}`.

- [ ] **Step 2: README**

In the Admin Workflow section, rename the destinations to the new sections: step 2 "Users", steps 5-9 "Network", step 8 "Nodes", steps 10-12 "Release", and add one sentence at the top: "The admin console has six sections: Status, Launch Ops, Users, Nodes, Network, and Release. The launch bar's playbook (Launch, Relaunch, or Change release) tracks which step comes next." Replace "Settings panel" in Release Target Configuration with "the Network section".

- [ ] **Step 3: Full verification pass**

Run: `npm run typecheck && npm test && npm run build`. Then walk through the spec's Testing section manually: every playbook's stepper, all six sections, every existing action, keyboard focus on tooltips, reload on each hash, a narrow window (760px) for the stacked layout.

- [ ] **Step 4: Commit (stage 4 complete)**

```bash
git add src/web/admin README.md
git -c commit.gpgsign=false commit -m "Polish the admin console and update the README"
```

---

### Task 12: Open the pull request

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin admin-portal-redesign
gh pr create --base main --head admin-portal-redesign --title "Redesign the admin console into six sections with playbooks" --body "See docs/superpowers/specs/2026-09-13-admin-portal-redesign-design.md. Reviewable commit by commit: module split, launch bar and playbooks, Status view, tooltips and polish. Tests: npm test (playbooks, aggregates, telemetry, sections). No server changes."
```

- [ ] **Step 2: Address CodeRabbit comments** the same way as previous PRs: verify each against the code, fix valid ones, reply with reasoning on the rest.
