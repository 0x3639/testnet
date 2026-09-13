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
