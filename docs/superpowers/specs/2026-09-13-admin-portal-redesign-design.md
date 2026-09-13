# Admin Portal Redesign

Date: 2026-09-13. Status: approved design, pending implementation plan.

## Goal

Split the single admin "Genesis Control" page into six focused sections behind a left sidebar, add a persistent launch bar with playbook-driven steps, add a post-launch Network Status view, and put hover tooltips on every non-obvious control. Reorganization plus guidance: every existing admin capability, API call, confirm dialog, and error display is preserved. The visual theme, tokens, fonts, and existing component classes in `src/web/styles.css` are unchanged. The server is untouched.

The design reference is a clickable HTML prototype (`design_handoff_admin_portal/Admin Redesign B.dc.html`, kept out of the repo). This spec restates everything the implementation needs.

## Decisions taken

- One branch (`admin-portal-redesign`), one PR, four staged commits (see Commit plan).
- The active section is stored in the URL hash (`#status`, `#launch`, `#users`, `#nodes`, `#network`, `#release`), so reloads and links keep the section. No router library.
- The playbook choice is stored in `localStorage` (`znn.admin.playbook`).
- The admin moves out of `src/web/App.tsx` into `src/web/admin/`. Operators keep the existing shell and view untouched.
- Pure logic (playbook evaluation, Status aggregates, hash parsing) is unit-tested with `node:test`; UI is verified manually. No React test harness.

## File layout

```
src/web/admin/
  AdminApp.tsx          shell, sidebar, launch bar, section switch; owns draft settings + handlers (today's AdminView state)
  useHashSection.ts     read/write window.location.hash; parseSection(hash, defaultSection)
  playbooks.ts          playbook data + evaluatePlaybook() (pure)
  statusAggregates.ts   tiles, health roll-up, attention list (pure)
  tooltips.ts           all tooltip copy as constants
  Tooltip.tsx           (?) trigger + popover
  StatusView.tsx
  LaunchOps.tsx
  UsersSection.tsx      wraps UserManagement
  NodesSection.tsx      NodeStatusPanel + pillars + seed nodes
  NetworkSection.tsx    SettingsForm fields regrouped + spork/funding editors + sticky save bar
  ReleaseSection.tsx    three action cards + PublishedArtifacts
```

Existing components `UserManagement`, `NodeStatusPanel`, `SettingsForm` (its field groups), `GenesisSporkEditor`, `GenesisFundingEditor`, `PublishedArtifacts`, `RefreshButton`, `Button`, `AddressValue`, `StatTile`, and helpers `nodeHealth`, `formatAge`, `heightLag`, `shortCommit`, `settingsKey`, `copy`, `download` move to `src/web/admin/` (or a small `src/web/shared/` where the landing page also uses them) without behavior changes. `App.tsx` keeps login, landing, operator view, session loading, and the 30-second poll.

## Shell

- Grid `220px` sidebar + `1fr` content. Sidebar: `#111312`, right border `1px solid var(--border)`, padding 20px; brand block at top (existing `logoBox`, "NoM Testnet" / "Admin console"); bottom: existing `userBadge` and an icon-only ghost sign-out button (34x34).
- Nav: vertical buttons, min-height 40px, radius `var(--radius)`. Active: `var(--panel)` bg, `var(--border)` border, `var(--text)`, weight 600. Inactive: transparent, `var(--muted)`. Optional right-aligned badge (mono, 0.68rem, uppercase, warn palette): "N stale" on Nodes when any node is Stale; "draft" on Network when `settingsDirty`.
- Sections and order: Status, Launch Ops, Users, Nodes, Network, Release. Default section: Status if `published` exists, else Launch Ops.
- Type scale: h1 2.2rem, h2 1.2rem, body 0.9-0.95rem, table/meta 0.85rem, ledger 0.72rem.

## Launch bar (persistent, above every section)

Sticky under the top of the content column: bg `#181b1a`, bottom border `var(--border)`, padding 12px 24px, flex, wraps.

- Left: playbook `<select>` with "Launch a new testnet", "Relaunch (new genesis)", "Change release / upgrade".
- Center (flex 1): stepper of 26px circles joined by 26x2px connectors. Done: border `rgba(0,213,87,.38)`, bg `rgba(0,213,87,.12)`, green check; connector after a done step `rgba(0,213,87,.4)`, otherwise `#2a302d`. Current: bg `var(--green)`, number in `#041008`, border `rgba(0,213,87,.6)`. Pending: bg `#181b1a`, border `#313735`, number `#6f7772`. Each circle is a button navigating to the step's section; `title` = label.
- Right: "Next: **label**" and a small gradient "Go" button navigating to the current step's section. When all steps are done: "All steps complete".

## Playbooks (`playbooks.ts`)

Input: `{ overview: AdminOverview, settingsDirty: boolean }`. Output per step: `{ id, label, description, section, state: "done" | "current" | "pending" }`, plus `currentIndex`, `doneCount`, `total`. Current = first not-done step; steps after it are pending even if their predicate holds (a step never shows done before an earlier one).

Helpers: `healthy(node) = nodeHealth(node).label === "Online"`; `allNodes = pillars + seedNodes`; `readinessOk(label)` looks up the server readiness check by label.

Launch checklist:
1. Create operator logins, "One login per pillar or seed node." -> Users. Done: `users.filter(u => u.role === "user").length >= 1`.
2. Register nodes, "Operators create pillars; you generate seeds." -> Nodes. Done: `pillars.length >= settings.minPillars`.
3. Configure network, "Chain ID, genesis time, release target." -> Network. Done: genesis time is in the future or a release is finalized, and readiness "Seeders" ok.
4. Save settings, "Persist the draft so it can be finalized." -> Network. Done: `!settingsDirty`.
5. Finalize genesis, "Lock pillars and funds into genesis.json." -> Release. Done: `finalizedAt` set.
6. Publish release, "Go public and instruct nodes to install." -> Release. Done: `published` set.
7. Verify nodes online, "All nodes report Online before genesis time." -> Nodes. Done: `allNodes.length > 0 && allNodes.every(healthy)`.

Relaunch checklist:
1. Set a new genesis time, "Pick a fresh start in Genesis basics." -> Network. Done: `settings.genesisTimestampSec` is in the future and differs from the published snapshot's value.
2. Enable data wipe, "Turn on wipe node data on publish." -> Network. Done: `settings.wipeDataOnPublish`.
3. Save settings, "Persist the new draft." -> Network. Done: `!settingsDirty`.
4. Finalize genesis, "Re-lock genesis with the new time." -> Release. Done: `finalizedAt` is later than `published.publishedAt` (or published is absent).
5. Publish release, "Nodes wipe chain data and restart." -> Release. Done: `published.publishedAt` is later than or equal to `finalizedAt` and `published.actions.wipeData` is true.
6. Verify nodes rejoin, "Watch health return to Online." -> Nodes. Done: all nodes healthy.

Release change checklist:
1. Edit release target, "New repo, branch/tag or commit pins." -> Network. Done: draft release target (repo, ref, commit for go-zenon and deployment) differs from the published release, or no release is published.
2. Set apply time (optional), "Coordinate the switch-over moment." -> Network. Optional step: shows done when `releaseApplyAtSec` is set; is skipped (never current) when unset.
3. Save settings, "Persist the new target." -> Network. Done: `!settingsDirty`.
4. Publish release, "Nodes build, verify and restart on it." -> Release. Done: published release target equals the draft target.
5. Watch nodes apply, "Version column shows the new build." -> Nodes. Done: every node's latest `process.commit` starts with the published go-zenon commit.

Optional steps are rendered with a muted "(optional)" suffix and do not block the current pointer.

## Status view (`statusAggregates.ts` + `StatusView.tsx`)

Header: kicker `Testnet-<chainIdentifier> · running` (or `· not launched` before publish), h1 "Network Status" with a 12px green dot (`box-shadow: 0 0 0 4px rgba(0,213,87,.15)`, existing `livePulse` animation). Right: "Auto-refreshes every 30s · last update Ns ago" and `RefreshButton`.

Tiles (`repeat(auto-fit, minmax(200px,1fr))`, existing `statTile`): Momentum height (max `sync.currentHeight` over nodes; hint "target N · in sync" when max lag is 0, else "N behind"), Active nodes `a / t` (reported within 5 minutes), Pillars producing `p / total pillars` (pillars that are healthy), Avg peers (mean `network.peerCount` over reporting nodes), Release `ref @ shortCommit` (hint: published time), Genesis date/time (hint: chain id). Values show "—" when no data.

Needs attention panel: one row-button per node whose health is not Online, showing name (min-width 110px), a message, and a "NODES →" affordance navigating to Nodes. Messages by health label: Stale -> "No report for <age> — check the machine or re-run the bootstrap command."; Syncing/Lagging -> "Syncing, N momentums behind — catching up normally."; Service down -> "Service is not running."; Errors -> "N errors in the last minute."; Install failed -> the node's `lastError`; Clock skew -> "Clock is N s off."; No report -> "Has not reported yet — run the bootstrap command." When all nodes are healthy show a muted "All nodes online" line instead.

Bottom two columns (`auto-fit minmax(300px,1fr)`): Node health roll-up (name, mono type, mono last seen, right-aligned `statusPill`; footer "Full telemetry" -> Nodes) and Current release (rows: go-zenon `ref @ commit`, deployment `ref @ commit`, published time; one copy-button row per public artifact showing green mono filename, truncated URL, copy icon; footer "Release details" -> Release; empty state when nothing is published).

## Launch Ops

Header: kicker `Testnet-<chainId> · genesis <time>`, h1 "Launch Ops"; right: status dot + "N of M steps done". Section cards (`auto-fit minmax(230px,1fr)`, whole card is a button to its section): Users (count, "1 admin · 3 operators"), Nodes (healthy/total; danger border and message when any node needs attention), Network ("Draft" with warn border and "Unsaved changes — save to unlock Finalize" when dirty, else "Saved"), Release ("—" or published stamp). Checklist panel: playbook title ("Launch checklist" / "Relaunch checklist" / "Release change checklist") with a tooltip; one row-button per step with the stepper's state circle, bold label (min-width 180px, muted when pending), muted description, right-aligned uppercase mono target section. Readiness tiles: the server `readiness` checks as dot (green ok / amber not ok), label, tooltip, muted detail.

## Users

h1 "Users" and "One login per pillar or seed node operator. They sign in to register their node and download their package." Add-a-login panel: existing `userCreateGrid` form; tooltips on the panel and on Role. Keep the created-credential card and Copy Login. Logins table: Username (green "YOU" tag), mono role, node (name + type), muted mono created, actions "Reset password" (opens the inline reset input on demand) and "Delete" (danger, disabled for self, existing cascading-delete confirm).

## Nodes

h1 "Nodes" and "Pillars register themselves; seed nodes are generated here. Health reports arrive once nodes run the bootstrap." Right: summary pills counting nodes per health tone ("3 ONLINE", "1 SYNCING", "1 STALE"; mono uppercase, statusPill palette). Health panel: existing telemetry table with default columns Node, Type, Health (pill `title` = lastError), Last seen, Height, Lag, Peers, Version, Service; a "Detailed" toggle adds Clock, Commit, Logs. Refresh button in the header. Pillars panel (grid `auto-fit minmax(340px,1fr)` with seeds): "Pillars · n of expected", Spork Wallet download, rows: name, `AddressValue` for the pillar address (reward and producer addresses in the row `title` and an expandable line), danger Delete with the existing confirm. Seed nodes panel: rows (name, mono `ip:port`, enode `AddressValue`, Delete), then the existing create form (operator login select limited to unused operator users, name, public IP, P2P port default 35995, gradient "Generate Seed Node") and the `resultStack` after creation.

## Network

h1 "Network" and "Draft settings. Nothing reaches nodes until you Save here, then Finalize and Publish on the Release page." Right: "UNSAVED CHANGES" warn pill when dirty, else muted "Saved". Panels, fields identical to today's `SettingsForm`: Genesis basics (Chain Identifier, Genesis Start UTC, Min / Expected Pillars paired, Extra Data); Release target (go-zenon repo with the repo-policy hint, branch/tag, commit pin with placeholder "resolved at publish", deployment repo/ref/pin, Apply Release At with Now / +10 / +30 / +60 / Clear, and the wipe checkbox styled as a warning row); Seeders & bootstrap peers (two textareas side by side, then the external seeder RPC probe with results as copyable rows); Sporks and Funded addresses side by side using the existing editors with "Add" buttons and empty states. Sticky save bar at the bottom, only when dirty: warn border, "Unsaved draft — Finalize and Publish are locked until you save." and gradient Save Settings. This replaces the page-top dirty alert.

## Release

"Three actions, in order. Each unlocks the next." Numbered cards; the number circle turns green when that stage is complete.
1. Review artifacts: tabs `genesis.json` / `config.json` over the JSON `<pre>`, Download genesis / Download config secondary buttons (existing endpoints).
2. Finalize genesis: status line "Not finalized yet. Requires saved settings and N of M pillars." or "Finalized <time>"; gradient Finalize, disabled while dirty.
3. Publish release: "Locked until the genesis is finalized." Button disabled until finalized and clean. Below, "Wipe node data on publish: off/on" banner, danger styling when on; when on, publish asks `window.confirm` first.
Published artifacts panel: existing `PublishedArtifacts`; dashed empty state before the first publish.

## Tooltips

Trigger: 16px circle, border `1px solid #3d4442`, radius 50%, mono 10px "?" in `var(--muted)`, `cursor: help`, `tabindex=0`, `aria-describedby`. Popover: bg `#0e100f`, border `#3d4442`, radius `var(--radius)`, text `#e6ece9` 12.5px/1.5 Space Grotesk, padding 9px 11px, max-width 270px, shadow `0 10px 28px rgba(0,0,0,.45)`; shown on hover and `:focus-visible`. Copy (verbatim from the prototype) in `tooltips.ts`:

- status.attention: Anything not reporting Online shows up here. Click an item to jump to its node.
- status.health: Live roll-up from each node's bootstrap agent. Full telemetry table is on the Nodes page.
- status.release: What every node is running right now. Public URLs are what operators and explorers download.
- launch.checklist: Pick a playbook in the top bar. Steps check themselves off as the network state changes; click any step to jump to the right page.
- users.add: Use Generate for a strong password, then Copy Login to send URL + credentials to the operator in one message.
- users.role: Operators manage a single node. Admins see this console. You almost always want Operator.
- nodes.health: Each node's bootstrap agent reports every minute. Stale means no report for 5+ minutes — check the machine or re-run the bootstrap command.
- nodes.pillars: Registered by operators from their own logins. Deleting a pillar frees its login for reuse and removes it from the genesis.
- nodes.seeds: You generate seed nodes for an unused operator login. The generated enode and multiaddr are added to Seeders and Bootstrap Peers automatically.
- network.genesis: Chain identifier and genesis time are baked into genesis.json. Changing them after launch means a relaunch — every node wipes and restarts from the new genesis.
- network.genesisTime: The moment pillars begin producing momentums. Set it far enough out for all operators to bootstrap first.
- network.minPillars: Finalize is blocked until at least the minimum number of pillars have registered.
- network.release: Which go-zenon build nodes install. Empty commit pins are resolved to the ref's current commit at publish time, so every release is immutable.
- network.commitPin: Optional. Full 40-character hash. Nodes refuse to start a binary whose embedded revision differs from the pin.
- network.applyAt: Optional. All nodes switch to the new release at this moment instead of immediately — use it to coordinate upgrades.
- network.seeders: How new nodes find the network. Generated seed nodes are added automatically; use the probe to add an external seeder by IP.
- network.sporks: Protocol feature flags activated at a height. Most testnets launch with none.
- network.funds: Extra genesis balances beyond pillar allocations — e.g. the faucet address.
- release.review: A live preview built from current registrations and saved settings. Check pillar count, genesis time and funds before locking anything.
- release.finalize: Locks the pillar set, funds and genesis time into a fixed genesis.json. You can re-finalize before publishing if something changes.
- release.publish: Makes genesis.json, config.json and the node plan public, and instructs every bootstrapped node to install this release. Published releases are immutable — publishing again creates a new one.
- release.wipe: When on, every node deletes its chain data and restarts from the new genesis — required for a relaunch, destructive otherwise. Toggle it on the Network page.

Readiness tile tooltips, keyed by the server readiness labels: Minimum pillars: "Finalize is blocked until at least the minimum number of pillars have registered."; Expected pillars: "Every expected pillar has registered from its operator login."; Spork address: "The wallet that controls spork activation; generated on first start."; Active sporks: "Protocol feature flags activated at a height. Most testnets launch with none."; Seeders: "New nodes use seeders to discover the network. Two or more is healthy."; Bootstrap peers: "libp2p peers new nodes dial first; generated seed nodes are added automatically."

## Behavior

- Section switching via the hash; badge counts and the stepper stay live across sections. The existing 30-second poll of `/api/admin/overview` continues.
- All mutations unchanged: create/delete/reset users, delete pillar/seed, create seed node, probe seeder, save settings, finalize, publish. Existing `window.confirm` guards and `alert` error styling stay.
- Copy affordances use the existing `copy()` and keep the brief "Copied" feedback where it exists.
- Finalize and Publish stay disabled while `settingsDirty`; the sticky bar and the Release card status lines surface it.

## Testing

- `src/web/admin/playbooks.test.ts`: each playbook against fixture overviews (empty, registered, dirty, finalized, published, all healthy, relaunch in progress, change in progress); current pointer and optional-step handling.
- `src/web/admin/statusAggregates.test.ts`: tiles with no nodes, mixed health, lag, average peers; attention messages per health label.
- `src/web/admin/useHashSection.test.ts`: `parseSection` for valid, invalid, and empty hashes with both defaults.
- `npm test` gains the web glob; `tsconfig.test.json` includes `src/web/admin/*.test.ts` and the pure modules import nothing from React or the DOM.
- Manual: `npm run typecheck`, `npm run build`, then walk every section against a local server with a seeded state, checking each playbook's stepper, the Status tiles, tooltips on hover and keyboard focus, and every existing action.

## Commit plan (one branch, one PR)

1. Module split: admin moved to `src/web/admin/`, sidebar + hash navigation, sections holding today's components regrouped, sticky save bar, Release cards. Typechecks and builds; visually close to today apart from navigation.
2. Launch bar, Launch Ops, `playbooks.ts` with tests.
3. Status view, `statusAggregates.ts` with tests.
4. Tooltips, nav badges, detailed-columns toggle, polish.

## Out of scope

Operator view, landing page, and login screen changes. Any server change.
