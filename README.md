# Zenon Testnet Builder

Web tooling for coordinating a Zenon Network of Momentum testnet. The app lets an admin create operator logins, collect pillar and seed-node registrations, generate operator packages, build `genesis.json`, build a node `config.json`, and publish those files for unauthenticated `wget` access.

The backend is Node/Express. The frontend is React/Vite and follows the dark, compact NoM-style interface used by `digitalSloth/nom-ui`. Wallet and address generation uses `digitalSloth/znn-typescript-sdk`.

## Features

- Admin and operator logins backed by local persistent state.
- Admin-created operator credentials with password generation and copyable handoff text.
- Operator registration as either a pillar or a managed non-producing seed node.
- Generated pillar, reward, and producer wallets for every registered operator.
- Operator ZIP packages with addresses, encrypted keyfiles, wallet passwords, seed words, producer config, and producer wallet file.
- Managed seed-node packages with generated network private key, enode, libp2p multiaddr, config, and status token.
- Admin-generated seed node enodes and libp2p multiaddrs from operator login, node name, public IP, and p2p port.
- Admin seed node discovery from a seed node IP address and RPC port.
- Admin overview of all pillar, reward, producer, managed seed-node enodes, and libp2p multiaddrs.
- Live and finalized `genesis.json` preview.
- Base non-producing `config.json` preview.
- Human-readable UTC genesis start time and optional release apply time.
- Public publish step for `/genesis.json`, `/config.json`, and `/node-plan.json`.
- Operator bootstrap command that installs go-zenon with `hypercore-one/deployment`, then writes the node-specific genesis, config, producer files for pillars, or network private key for seed nodes.
- Per-node status reporting from the bootstrap agent.
- Admin user, pillar, and seed-node deletion.
- A local four-node devnet generation script for validating the produced genesis/config artifacts.

## Planning Docs

- [Genesis release automation plan](docs/genesis-release-automation-plan.md): proposed event history, configurable `go-zenon` release targets, operator-specific bootstrap scripts, and node polling automation.
- [Loupe security scanning](docs/loupe-security-scanning.md): guarded repository registration, scanner scope, and baseline/incremental scan commands.

## Important Security Notes

Set `APP_SECRET` before using the app outside local testing. It is used as the server-side encryption key for sensitive stored wallet package secrets, especially wallet passwords. Production startup fails when this value is missing, shorter than 32 characters, or still uses the known development default.

Do not change `APP_SECRET` after operators register pillars. Existing encrypted wallet package secrets will no longer decrypt correctly if the secret changes.

Treat these as secret material:

- `data/app-state.json`
- operator ZIP packages
- wallet passwords
- wallet seed words
- managed seed node network private keys
- generated devnet `network-private-key` files

The generated `data/`, `dist/`, `node_modules/`, and `devnet/four-node/` directories are intentionally ignored by git.

The application container runs as the bundled non-root `node` user, and its named data volume is initialized for that user. Custom bind mounts must grant that user write access without making the state directory broadly readable. Authentication endpoints also apply bounded per-account and per-source delays and temporary lockouts; retain a proxy-level rate limit as an additional deployment control.

Browser responses include a restrictive security-header baseline and use only local system fonts. HSTS is emitted when `COOKIE_SECURE=true`, which must only be enabled behind confirmed HTTPS termination. Secret-bearing downloads explicitly disable intermediary and browser caching.

## Requirements

- Node.js 20 or newer for local development.
- Docker and Docker Compose for container deployment.
- A Caddy Docker Proxy network named `root_proxy-net` when using the Portainer compose file.

## Local Development

Install dependencies and create initial credentials:

```bash
npm install
npm run account -- create-admin --username admin
npm run account -- create-user --username pillar-a
npm run dev
```

The web app runs at `http://localhost:5173` and proxies API requests to `http://localhost:8787`.

Useful commands:

```bash
npm run typecheck
npm run build
npm run account -- list
npm run account -- create-admin --username admin --password "change-me"
npm run account -- create-user --username pillar-a --password "change-me"
```

## Release Target Configuration

The node bootstrap script reads its active install target from the admin settings. Fresh installs use these environment variables as defaults:

```text
GO_ZENON_REPO=https://github.com/zenon-network/go-zenon.git
GO_ZENON_REF=master
GO_ZENON_COMMIT=<full-commit-id>
DEPLOYMENT_REPO=https://github.com/hypercore-one/deployment.git
DEPLOYMENT_REF=main
DEPLOYMENT_COMMIT=<full-commit-id>
```

After the app is running, admins can edit the go-zenon and deployment repositories, refs, immutable commit pins, one-shot data wipe flag, and optional release apply time from the Settings panel. Saving these values only updates the draft settings. They do not reach `/node-plan.json` or authenticated bootstrap manifests until an admin clicks **Publish Release**.

Both full commit pins are required before publishing. Each ref is fetched and must resolve to its configured commit exactly; a mismatch aborts before deployment code is executed. This prevents a moved branch or tag from silently changing privileged installation inputs.

## Standalone Docker

Use `docker-compose.yml` when you want the repo to run its own Caddy container for local access. The bundled HTTP endpoint is bound to host loopback and must not be exposed directly to another network.

```bash
APP_SECRET="$(openssl rand -hex 32)" docker compose up -d --build
```

Create the first admin account inside the app container:

```bash
docker compose exec app node dist/server/server/cli.js create-admin --username admin
```

Open the app:

```text
http://localhost:8080
```

The standalone stack contains:

- `app`: the Node/React application on internal port `8787`.
- `caddy`: a bundled reverse proxy exposed only on `127.0.0.1:${HTTP_PORT:-8080}`.
- `testnet-data`: persistent app state mounted at `/app/data`.

For remote access, use the Portainer profile behind its HTTPS proxy or an equivalent deployment that terminates TLS and sets secure cookies. Do not change the standalone binding to `0.0.0.0`; the bundled Caddy profile serves cleartext HTTP.

The supplied Compose profiles set a canonical `PUBLIC_BASE_URL` and one trusted reverse-proxy hop. Custom production deployments must also set `PUBLIC_BASE_URL` to the exact external HTTPS origin and set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops. Request `Host` and forwarded-host headers are not used to construct privileged bootstrap URLs when the canonical origin is present.

## Portainer With Existing Caddy

Use `docker-compose.portainer.yml` when an existing Caddy Docker Proxy stack already handles TLS certificates and routing. This stack runs only the app container and attaches it to the external `root_proxy-net` network.

### Prerequisites

Before creating the Portainer stack, confirm:

- DNS for your testnet host points at the server running Caddy.
- Your existing Caddy Docker Proxy stack is running.
- Caddy Docker Proxy is connected to the Docker network named `root_proxy-net`.
- The Docker network `root_proxy-net` exists before this stack starts.

If the proxy network does not exist yet, create it on the Docker host:

```bash
docker network create root_proxy-net
```

If Caddy is already running from another stack, make sure that Caddy service also joins `root_proxy-net`. The testnet builder does not publish any host ports in Portainer mode; Caddy reaches it over this shared Docker network.

### Create The Stack From Git

The recommended Portainer setup is a Git repository stack. This lets Portainer clone the repository and use `build.context: .` from `docker-compose.portainer.yml`.

In Portainer:

1. Open **Stacks**.
2. Click **Add stack**.
3. Name the stack, for example `zenon-testnet-builder`.
4. Select **Git Repository** as the build method.
5. Repository URL:

   ```text
   https://github.com/0x3639/testnet.git
   ```

6. Repository reference:

   ```text
   refs/heads/main
   ```

7. Compose path:

   ```text
   docker-compose.portainer.yml
   ```

8. Add the environment variables below.
9. Click **Deploy the stack**.

Set these stack environment variables:

- `APP_SECRET`: a stable secret, for example the output of `openssl rand -hex 32`.
- `TESTNET_HOST`: the public host Caddy should route, for example `testnet.zenon.info`.
- `PUBLIC_BASE_URL`: derived by the supplied stack as `https://<TESTNET_HOST>`; set it explicitly for custom deployments.
- `TRUST_PROXY_HOPS`: set to `1` by the supplied proxy topology; custom deployments must match their exact trusted proxy chain.
- `TZ`: optional, defaults to `Etc/UTC`.
- `GO_ZENON_REPO`: optional initial default, defaults to `https://github.com/zenon-network/go-zenon.git`.
- `GO_ZENON_REF`: optional initial default, defaults to `master`.
- `GO_ZENON_COMMIT`: optional initial full commit pin; required before publishing.
- `DEPLOYMENT_REPO`: optional initial default, defaults to `https://github.com/hypercore-one/deployment.git`.
- `DEPLOYMENT_REF`: optional initial default, defaults to `main`.
- `DEPLOYMENT_COMMIT`: optional initial full commit pin; required before publishing.

Example values:

```text
APP_SECRET=replace-with-a-long-random-secret
TESTNET_HOST=testnet.zenon.info
TZ=Etc/UTC
```

You can generate `APP_SECRET` on any trusted machine:

```bash
openssl rand -hex 32
```

Keep this value somewhere safe. Do not change it after operators register pillars because it encrypts stored wallet package secrets.

The Portainer stack uses these Caddy Docker Proxy labels:

```yaml
caddy: ${TESTNET_HOST:-testnet.zenon.info}
caddy.encode: zstd gzip
caddy.reverse_proxy: "{{upstreams 8787}}"
```

After deployment, Caddy should route:

```text
https://<TESTNET_HOST>
https://<TESTNET_HOST>/genesis.json
https://<TESTNET_HOST>/config.json
```

The JSON files return `404` until an admin publishes them from the app.

### Create The First Admin

After the stack is running, create the first admin account from the `testnet-builder` container.

In Portainer:

1. Open **Containers**.
2. Open the `testnet-builder` container from the stack.
3. Open **Console**.
4. Connect with `/bin/sh`.
5. Run:

```bash
node dist/server/server/cli.js create-admin --username admin
```

The command prints the generated password once. Save it before closing the console.

You can also set the initial password yourself:

```bash
node dist/server/server/cli.js create-admin --username admin --password "replace-this-password"
```

Then open:

```text
https://<TESTNET_HOST>
```

Sign in as `admin`, create operator accounts, collect pillar and seed-node registrations, finalize, and publish.

### Updating The Stack

When new commits are pushed to `main`:

1. Open the stack in Portainer.
2. Pull and redeploy the Git stack.
3. Keep the same persistent volume and the same `APP_SECRET`.

The app stores state in the named volume `zenon_testnet_builder_data` at `/app/data`.

### Web Editor Alternative

If you create a Portainer stack with the Web Editor instead of the Git Repository method, `build.context: .` will not have the repository files unless you provide them another way. For Web Editor deployments, build and publish an image first, then remove the `build:` block and set `image:` to your published image.

## Admin Workflow

1. Sign in as an admin.
2. Create one operator login per expected pillar and managed seed node.
3. Send each operator the copied login URL, username, and password.
4. Ask pillar operators to sign in and choose a pillar name.
5. Set the go-zenon and deployment repo/ref release target in Settings.
6. Set **Genesis Start (UTC)** to the intended chain start time. For a coordinated restart, set it comfortably in the future.
7. Optionally set **Apply Release At (UTC)** so nodes wait before stopping, wiping, downloading artifacts, and restarting.
8. For managed seed nodes, create an operator login, then use **Seed Nodes** to select that login, enter node name, public IP, and p2p port. The app generates the network private key, public key, enode, and libp2p multiaddr immediately.
9. Add or probe any external seed nodes, and confirm managed seed nodes are present in `Net.Seeders` and `Net.BootstrapPeers`.
10. Review the generated `genesis.json` and `config.json`.
11. Finalize the genesis when registrations are complete.
12. Click **Publish Release** when the current genesis, config, seeders, bootstrap peers, and release target should become active for operators.

Admins can also reset user passwords, delete users, delete pillar registrations, delete managed seed nodes, and download the spork wallet package.

## Operator Packages

Pillar operators download a ZIP containing:

- `pillar-info.json`
- `config.json`
- encrypted keyfiles for producer, pillar, and reward wallets
- wallet passwords
- seed words for producer, pillar, and reward wallets
- `node/status-token.txt` for authenticated node status reporting
- `node/status-report-example.sh` with a minimal heartbeat POST example

The package `config.json` is pillar-specific and includes the producer settings. The public `/config.json` is a generic non-producing node config.

Managed seed-node operators download a ZIP containing:

- `seed-node-info.json`
- `config.json`
- `network-private-key`
- `node/status-token.txt`

Seed-node packages do not include pillar, reward, or producer wallets. The seed node enode is automatically added to draft `Net.Seeders` when the admin creates the managed seed node or when an operator self-registers one.

## Operator Bootstrap

After registering a pillar or seed node, the operator page shows a one-time enrollment token and a copyable command shaped like this:

```bash
read -rsp 'Enrollment token: ' ZNN_ENROLLMENT_TOKEN && printf '\n' && \
printf '%s' "$ZNN_ENROLLMENT_TOKEN" | sudo install -m 600 /dev/stdin /run/znn-testnet-enrollment-token && \
unset ZNN_ENROLLMENT_TOKEN && \
curl -fsSL "https://<TESTNET_HOST>/api/bootstrap/install.sh" | sudo env ZNN_ENROLLMENT_TOKEN_FILE=/run/znn-testnet-enrollment-token ZNN_TESTNET_URL="https://<TESTNET_HOST>" bash
```

Run it on the node host. The script is intended for the same Linux/systemd style environment supported by `hypercore-one/deployment`.
Paste the enrollment token only at the hidden prompt. It is written through standard input to a root-owned mode-`0600` file and is not embedded in shell history, environment values, cron content, or command arguments.
In **Node Deployment**, the go-zenon and deployment refs select the source revisions to fetch. Both refs must resolve exactly to their required full commit pins. The agent aborts before executing deployment code when either commit does not match.
For testnet operators, the bootstrap agent relaxes the deployment script CPU pre-flight minimum from 4 cores to 2 cores by default. Override it by adding `ZNN_DEPLOYMENT_MIN_CPU_CORES="<cores>"` to the bootstrap command if a stricter minimum is needed.
The agent also changes the deployment script's total RAM check from a hard failure to a warning. A 4 GB VPS can report as `3GiB` after integer rounding, so the script will log the RAM finding and keep going. 4 GiB remains the recommended minimum for builds.
The initial bootstrap run and the one-minute cron job share `/var/lock/znn-testnet-agent.lock`, so a long go-zenon build cannot be started twice. If `zenon.sh` reports `Failed to build binary`, check `/opt/zenon-deployment/.znnsh.log` for the underlying Go compiler error.
For development diagnostics, add `ZNN_BOOTSTRAP_TRACE=1` to the install command. The default output stays concise; trace mode also prints the patched deployment pre-flight lines.

The bootstrap flow before a release is published:

1. Installs basic dependencies.
2. Installs `/usr/local/bin/znn-testnet-agent`.
3. Installs a one-minute cron entry.
4. Reports a `Waiting` node status to the admin panel.
5. Keeps polling until an admin clicks **Publish Release**.

After **Publish Release**, the agent waits until `actions.applyAt` if that timestamp is present and in the future. When the apply time has arrived, the agent:

1. Reads the authenticated manifest with the enrollment token.
2. At the release apply time, exchanges enrollment once for a node-status token and a 30-minute secret-download token.
3. Downloads missing producer or network secrets immediately with the short-lived token.
4. Fetches `DEPLOYMENT_REF` and verifies that it resolves exactly to `DEPLOYMENT_COMMIT`.
5. Fetches `GO_ZENON_REF`, verifies `GO_ZENON_COMMIT`, and exposes only that verified local source to the pinned deployment script.
6. Patches the deployment pre-flight CPU minimum to `ZNN_DEPLOYMENT_MIN_CPU_CORES`, default `2`, and changes the total RAM check to warning-only.
7. Builds and installs go-zenon from the verified local revision.
8. Stops `go-zenon`.
9. Wipes node data if the published node plan has `actions.wipeData: true`.
10. Writes `/root/.znn/genesis.json` and the node-specific `/root/.znn/config.json`.
11. Restores the local producer password into pillar config without sending it through the long-lived status credential.
12. Restarts `go-zenon`, revokes the short-lived server capability, deletes the local secret-download token, and sends a status report.

The wipe action is controlled by **Wipe node data on next Publish Release** in admin Settings. It is one-shot: publishing a release snapshots the flag into `/node-plan.json`, then clears the draft checkbox. **Apply Release At (UTC)** is also one-shot: publishing snapshots it into `/node-plan.json`, then clears the draft field. The agent preserves `/root/.znn/wallet`, `/root/.znn/genesis.json`, `/root/.znn/config.json`, and `/root/.znn/network-private-key`, and removes other files/directories under `/root/.znn` before writing the published artifacts.

Enrollment tokens expire after seven days and can be used once. Rotating enrollment credentials invalidates the previous node-status credential. The issued status token can read manifests and non-secret node configuration and submit status, but it cannot download producer key files, producer passwords, or seed-node network private keys.

## Node Status Reporting

Each registered pillar or managed seed node receives a private node status token in its operator package. The bootstrap agent receives the current status token only through the one-time enrollment exchange and stores it in a root-owned credential file. It uses that token to report health without exposing the app username or password.

Heartbeat reports are sent with a bearer token:

```bash
curl -fsS -X POST "https://<TESTNET_HOST>/api/bootstrap/status" \
  -H "Authorization: Bearer <node-status-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "node": {
      "hostname": "pillar-node-1",
      "serviceActive": true,
      "installedRepo": "https://github.com/zenon-network/go-zenon.git",
      "installedRef": "devnet-v1.0.0-rc1"
    },
    "sync": {
      "state": 2,
      "currentHeight": 12345,
      "targetHeight": 12345
    },
    "network": {
      "peerCount": 4,
      "selfPublicKey": "..."
    },
    "process": {
      "version": "v0.0.8",
      "commit": "9cde165877a1e4ff47d0df6cf8b8a65b121d550c"
    },
    "logs": {
      "errorCountLastMinute": 0,
      "warningCountLastMinute": 0,
      "recent": []
    }
  }'
```

The installed agent collects `stats.syncInfo`, `stats.networkInfo`, and `stats.processInfo` from the local node RPC. Immediately after install or restart, RPC may not be listening yet; in that case the agent reports service and log status first, then fills in sync, network, and process fields on a later one-minute check. The admin panel shows the latest report for each pillar and managed seed node, including last seen time, service status, sync height, height lag, peer count, running process version, running process commit, installed ref, and recent log error counts. The server keeps a rolling 24-hour minute-sample history per node and the latest full report.

## Published Files

After the admin clicks **Publish Release**, these files are served without authentication:

Standalone Docker:

```text
http://localhost:8080/genesis.json
http://localhost:8080/config.json
http://localhost:8080/node-plan.json
```

Portainer/Caddy:

```text
https://<TESTNET_HOST>/genesis.json
https://<TESTNET_HOST>/config.json
https://<TESTNET_HOST>/node-plan.json
```

Publishing stores a snapshot. If settings, seeders, bootstrap peers, pillars, finalized genesis data, release target values, or the wipe flag change later, save them as draft changes first, then click **Publish Release** again to update the public files and node plan. Saving settings alone does not force an upgrade or wipe.

`/node-plan.json` includes:

- `genesisStartAt`: the UTC time converted from `GenesisTimestampSec`.
- `actions.applyAt`: optional UTC time when agents should apply the published release.
- `actions.wipeData`: whether agents should wipe node data before writing the release artifacts.

For a coordinated devnet restart, publish the release with `actions.applyAt` before `genesisStartAt`. With the bundled one-minute cron, a 10-30 minute gap is usually enough for all nodes to stop, wipe if requested, download artifacts, restart, and then wait inside go-zenon for the future genesis timestamp.

## Seeders And Managed Seed Nodes

For managed seed nodes, create an operator user, then use the admin **Seed Nodes** panel to select that login and enter the seed node name, public IP, and p2p port. The app generates the network private key, derives the legacy enode and libp2p multiaddr, saves them in draft `Net.Seeders` and `Net.BootstrapPeers`, and gives the assigned operator a seed-node bootstrap command when they log in. Managed seed nodes are non-producing nodes and are not included in `genesis.json` pillar allocations.

This managed flow does not query the seed node RPC and does not require the seed node to be running before genesis/config are published. The enode and libp2p multiaddr are deterministic from the generated network private key plus public IP/port.

For an external already-running seed node, use the **External Seeder / RPC Probe** panel before publishing the config. The app calls the seed node RPC on port `35997` by default, reads `stats.networkInfo.self.publicKey`, and saves both an `enode://<public-key>@<ip>:35995` entry into `Net.Seeders` and a `/ip4/<ip>/tcp/35995/p2p/<peer-id>` entry into `Net.BootstrapPeers`. The probe accepts publicly routable literal IP addresses only, rejects local and special-use ranges, and does not follow redirects.

Use the node's public IP address. If RPC or p2p is exposed on non-default ports, adjust the ports in the external seeder probe form before probing.

The public `config.json` includes the saved seeders, saved bootstrap peers, and no `Producer` block. Pillar package configs include producer settings and wallet references. Managed seed-node configs exclude their own enode from `Net.Seeders` and their own multiaddr from `Net.BootstrapPeers`.

## Genesis Policy

For each registered pillar, the generated genesis gives:

- `50,000 ZNN` and `500,000 QSR` to the pillar address.
- `15,000 ZNN` pillar stake inside the Pillar contract.
- `1,000 QSR` fused plasma for the producer address.
- `1,000 QSR` fused plasma for the pillar address.
- `1,000 QSR` fused plasma for the reward address.

The app defaults to:

- `minPillars = 3`
- `expectedPillars = 4`
- Accelerator, HTLC, and Bridge/Liquidity sporks active at height `0`
- DS test sporks `dynamic-plasma`, `libp2p`, and `governance` present but inactive by default, with activation heights `10`, `20`, and `30`

Admins can add, edit, activate/deactivate, and remove sporks from the `genesis.json` tab in the admin preview panel. Each spork is written into `SporkConfig.Sporks` in the next generated `genesis.json` with its configured ID, name, description, activation flag, and activation height.

The generated token supply is reconciled against the genesis balances and embedded contract balances.

## Four-Node Devnet Validation

The helper script `scripts/create-four-node-devnet.mjs` can exercise the builder and generate a local four-node devnet package under `devnet/four-node/`.

Start the standalone builder first and make sure the admin login exists. The script defaults to:

- builder URL: `http://127.0.0.1:8080`
- admin username: `admin`
- admin password: `admin-pass-123`

Run:

```bash
BUILDER_URL=http://127.0.0.1:8080 \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=admin-pass-123 \
node scripts/create-four-node-devnet.mjs
```

The generated `devnet/four-node/` directory contains wallet packages, node configs, node private keys, and operator credentials. It is ignored by git and should be treated as local secret material.

## Repository Layout

```text
src/server/                  Express API, auth, storage, genesis/config builders
src/web/                     React admin/operator interface
src/shared/                  Shared TypeScript types
scripts/create-four-node-devnet.mjs
docker/caddy/Caddyfile       Standalone Docker Caddy config
docker-compose.yml           Standalone app + Caddy stack
docker-compose.portainer.yml App-only stack for existing Caddy Docker Proxy
```

## API Endpoints

Most API endpoints require an authenticated session cookie.

Public endpoints:

- `GET /api/health`
- `GET /genesis.json`
- `GET /config.json`
- `GET /node-plan.json`

Admin-only downloads:

- `GET /api/admin/genesis.json`
- `GET /api/admin/config-template.json`
- `GET /api/admin/spork-package.zip`

Admin seed-node management:

- `POST /api/admin/seed-nodes`
- `DELETE /api/admin/seed-nodes/:seedNodeId`
- `POST /api/admin/seeders/probe`

Operator download:

- `GET /api/pillar/package`

Node heartbeat reporting:

- `POST /api/bootstrap/status`
- `POST /api/node/status`

Operator bootstrap:

- `GET /api/bootstrap/install.sh`
- `POST /api/bootstrap/enroll`
- `POST /api/bootstrap/complete`
- `POST /api/bootstrap/enrollment-token`
- `GET /api/bootstrap/manifest`
- `GET /api/bootstrap/node-config.json`
- `GET /api/bootstrap/pillar-config.json`
- `GET /api/bootstrap/producer.json`
- `GET /api/bootstrap/producer-password.txt`
- `GET /api/bootstrap/network-private-key`
