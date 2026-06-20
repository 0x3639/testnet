# Genesis Release Automation Plan

This plan describes the next iteration of the Zenon Testnet Builder: each testnet launch becomes a managed genesis event with a configurable `go-zenon` source, operator-specific bootstrap scripts, historical artifact retention, and a simple node-side automation loop.

The goal is that an operator can:

1. Receive a login from the admin.
2. Register a pillar name in the web app.
3. Copy one bootstrap command from the web app.
4. Run that command on a fresh node.
5. Let the script download the deployment tooling, producer wallet, pillar config, genesis, and release target automatically.

## Core Concepts

### Genesis Event

A genesis event is one launch or relaunch of a devnet. It owns the exact set of pillars, settings, artifacts, and release target used for that network.

Each genesis event should keep:

- event id
- display name
- status
- registration open and close times
- expected pillars
- minimum pillars
- selected pillar records
- removed or excluded pillar records
- finalized `genesis.json`
- published public `config.json`
- generated artifact hashes
- `go-zenon` repo URL
- `go-zenon` ref, tag, or branch
- optional pinned commit SHA
- deployment repo URL and ref
- publish timestamps
- release notes or admin message

Suggested statuses:

- `draft`
- `registration_open`
- `registration_closed`
- `finalized`
- `published`
- `upgrade_available`
- `paused`
- `archived`

### Pillar Registration

Pillar records should become event-scoped. A user can register a pillar for the current event without losing the historical record of prior events.

Admins should be able to:

- add operator users
- reset operator passwords
- remove a pillar from the current event
- mark a pillar as unresponsive
- exclude a pillar from the next finalized genesis
- keep prior event pillar data read-only

Removing a pillar from a new genesis event should not delete the historical record. It should only exclude that pillar from the active event's finalized artifacts.

### Configurable go-zenon Source

The admin panel should expose release fields per genesis event:

- `goZenonRepoUrl`
- `goZenonRef`
- `goZenonCommit`
- `deploymentRepoUrl`
- `deploymentRef`
- `notBefore`
- `staggerSeconds`
- rollout status
- admin release message

The initial default can remain:

```text
https://github.com/zenon-network/go-zenon.git
master
```

For testing a dev release, the admin can change the repo and ref to a fork, branch, or pre-release tag.

## Public Endpoints

Public endpoints are safe for anyone to fetch. They must not include producer wallet material or passwords.

```text
GET /genesis.json
GET /config.json
GET /node-plan.json
GET /events.json
GET /events/:eventId/genesis.json
GET /events/:eventId/config.json
```

### `/node-plan.json`

This endpoint tells nodes what release target should be running.

Example:

```json
{
  "schemaVersion": 1,
  "eventId": "devnet-2026-06",
  "networkId": "znn-devnet-2026-06",
  "status": "upgrade_available",
  "genesisUrl": "https://testnet.zenon.info/genesis.json",
  "configUrl": "https://testnet.zenon.info/config.json",
  "genesisSha256": "abc...",
  "configSha256": "def...",
  "goZenon": {
    "repoUrl": "https://github.com/zenon-network/go-zenon.git",
    "ref": "devnet-v1.0.0-rc1",
    "commit": "optional-pinned-commit"
  },
  "deployment": {
    "repoUrl": "https://github.com/hypercore-one/deployment.git",
    "ref": "main"
  },
  "notBefore": "2026-06-27T18:00:00Z",
  "staggerSeconds": 900,
  "message": "Devnet release candidate is ready"
}
```

## Operator-Specific Bootstrap Endpoints

Producer material must be authenticated and scoped to one pillar.

Do not embed the operator's website username and password in the script. Instead, the app should generate a scoped bootstrap token for the registered pillar.

Suggested endpoints:

```text
GET /api/bootstrap/install.sh?token=...
GET /api/bootstrap/manifest
GET /api/bootstrap/pillar-config.json
GET /api/bootstrap/producer.json
GET /api/bootstrap/producer-password.txt
POST /api/bootstrap/status
```

The token should authorize only one pillar for one genesis event. The admin and operator should be able to rotate or revoke it.

### Bootstrap Manifest

The authenticated manifest combines public network info with pillar-specific artifact URLs.

Example:

```json
{
  "schemaVersion": 1,
  "eventId": "devnet-2026-06",
  "pillarName": "example-pillar",
  "pillarAddress": "z1...",
  "rewardAddress": "z1...",
  "producerAddress": "z1...",
  "genesisUrl": "https://testnet.zenon.info/genesis.json",
  "configUrl": "https://testnet.zenon.info/api/bootstrap/pillar-config.json",
  "producerKeyFileUrl": "https://testnet.zenon.info/api/bootstrap/producer.json",
  "producerPasswordUrl": "https://testnet.zenon.info/api/bootstrap/producer-password.txt",
  "nodePlanUrl": "https://testnet.zenon.info/node-plan.json",
  "goZenon": {
    "repoUrl": "https://github.com/zenon-network/go-zenon.git",
    "ref": "devnet-v1.0.0-rc1"
  },
  "deployment": {
    "repoUrl": "https://github.com/hypercore-one/deployment.git",
    "ref": "main"
  }
}
```

## Bootstrap Script Behavior

The operator page should show a command similar to:

```bash
curl -fsSL "https://testnet.zenon.info/api/bootstrap/install.sh?token=<token>" | sudo bash
```

The script should:

1. Require root.
2. Detect supported Linux architecture.
3. Install basic dependencies if missing.
4. Create `/root/.znn` and `/root/.znn/wallet`.
5. Download the authenticated bootstrap manifest.
6. Download and verify `genesis.json`.
7. Download the pillar-specific `config.json`.
8. Download the producer keyfile and password.
9. Write files with strict permissions.
10. Clone or update `hypercore-one/deployment`.
11. Install a cron job or systemd timer for polling.
12. Run the deployment script when the node plan indicates an actionable release.

The deployment repo already supports non-interactive deployment:

```bash
sudo ./zenon.sh --deploy zenon "$GO_ZENON_REPO" "$GO_ZENON_REF"
```

## Cron Or Timer Polling

The node should poll every 10 minutes. Use a lock so only one run can execute at a time.

Cron shape:

```cron
*/10 * * * * flock -n /var/lock/znn-testnet-agent.lock /usr/local/bin/znn-testnet-agent
```

The agent should store local state:

```text
/var/lib/znn-testnet-agent/state.json
```

State should include:

- last event id
- installed go-zenon repo
- installed go-zenon ref
- installed go-zenon commit if known
- last genesis hash
- last config hash
- last successful run
- last error

## Config Rules

There are two config types:

- public generic `config.json`
- authenticated pillar-specific `config.json`

The public config must not include a `Producer` block.

The pillar-specific config must include:

- producer address
- producer wallet path
- producer password
- seeders
- genesis file path
- RPC settings
- network settings

The bootstrap script should never overwrite a pillar config with the generic public config after the first install. If seeders change, the script should either download a fresh pillar-specific config or merge only safe network fields while preserving the `Producer` block.

## Admin Panel Updates

### Genesis Events

Add a Genesis Events admin area:

- create new event
- open registration
- close registration
- remove or exclude pillars
- finalize genesis
- publish artifacts
- archive event
- view historical finalized and published artifacts

### Release Target

Add per-event release fields:

- go-zenon repo URL
- go-zenon ref
- optional pinned commit SHA
- deployment repo URL
- deployment ref
- not-before time
- stagger seconds
- release status
- release message

### Operator Bootstrap

Add per-pillar controls:

- bootstrap token status
- rotate bootstrap token
- revoke bootstrap token
- copy bootstrap command
- last bootstrap timestamp
- last node poll timestamp
- last node-reported version
- last node-reported error

## Historical Artifact Retention

Finalized and published artifacts should be immutable records. Publishing a new event should not overwrite old event artifacts.

Suggested public layout:

```text
/genesis.json                         latest published event
/config.json                          latest published event
/node-plan.json                       latest published event
/events.json                          index of published events
/events/:eventId/genesis.json         immutable historical genesis
/events/:eventId/config.json          immutable historical config
/events/:eventId/node-plan.json       immutable historical plan
```

The admin panel should show all prior events with:

- finalized time
- published time
- included pillars
- excluded pillars
- go-zenon repo/ref
- artifact hashes
- download links

## Data Model Sketch

```ts
interface GenesisEvent {
  id: string;
  name: string;
  status: GenesisEventStatus;
  createdAt: string;
  registrationOpenedAt?: string;
  registrationClosedAt?: string;
  finalizedAt?: string;
  publishedAt?: string;
  settings: NetworkSettings;
  release: ReleaseTarget;
  pillarIds: string[];
  excludedPillarIds: string[];
  artifacts?: PublishedEventArtifacts;
}

interface ReleaseTarget {
  goZenonRepoUrl: string;
  goZenonRef: string;
  goZenonCommit?: string;
  deploymentRepoUrl: string;
  deploymentRef: string;
  notBefore?: string;
  staggerSeconds: number;
  status: "waiting" | "upgrade_available" | "paused";
  message?: string;
}

interface BootstrapToken {
  id: string;
  eventId: string;
  pillarId: string;
  tokenHash: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

interface PublishedEventArtifacts {
  genesis: unknown;
  config: unknown;
  nodePlan: unknown;
  genesisSha256: string;
  configSha256: string;
  nodePlanSha256: string;
}
```

## Implementation Phases

### Phase 1: Event History And Release Target

- Add event-scoped genesis state.
- Add configurable `go-zenon` repo/ref in the admin panel.
- Keep immutable finalized and published artifacts per event.
- Expose latest and historical public endpoints.
- Preserve existing ZIP package download as a manual fallback.

### Phase 2: Operator Bootstrap

- Add per-pillar bootstrap tokens.
- Add authenticated bootstrap manifest endpoint.
- Add authenticated producer config/keyfile/password endpoints.
- Add generated install script.
- Add operator UI copy command.

### Phase 3: Node Agent

- Add node-side polling script.
- Install cron or systemd timer.
- Download artifacts and call `hypercore-one/deployment`.
- Store local state to avoid repeated upgrades.
- Report status back to the control panel.

### Phase 4: Rollout Safety

- Add artifact hashes.
- Add commit pinning.
- Add repo allowlist.
- Add token rotation/revocation UI.
- Add canary rollout support.
- Add rollback target support.
- Consider signed node plans.

## Open Decisions

- Whether the bootstrap token should be one-time for initial producer download or reusable for future config refreshes.
- Whether status reporting should be required before a pillar counts as responsive.
- Whether removed pillars should be eligible for re-registration in the same event.
- Whether public latest endpoints should redirect to event-scoped endpoints or serve the latest JSON directly.
- Whether node automation should use cron first or systemd timers from the first release.
