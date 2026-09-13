# Zenon Testnet Builder

Web tooling for coordinating a Zenon Network of Momentum testnet. The app lets an admin create operator logins, collect pillar and seed-node registrations, generate operator packages, build `genesis.json`, build a node `config.json`, and publish those files for unauthenticated `wget` access.

The backend is Node/Express. The frontend is React/Vite and follows the dark, compact NoM-style interface used by `digitalSloth/nom-ui`. Wallet and address generation uses `digitalSloth/znn-typescript-sdk`.

## Quick Start

Pick one of the two hosting paths. Both end with an admin login at your URL; the linked sections have the details.

**Coolify (hosted, TLS handled for you)**

1. Generate a secret once and keep it: `openssl rand -hex 32`.
2. In Coolify, add a **Docker Compose** resource from this Git repository (`https://github.com/0x3639/testnet.git`, branch `main`, compose file `docker-compose.coolify.yml`). See [Create The Resource](#create-the-resource).
3. Point a DNS `A` record at the Coolify server, then set the `app` service's domain to `https://<your-host>:8787` (the `:8787` is required). See [Set Up The Domain](#set-up-the-domain).
4. Set `APP_SECRET` to the secret from step 1 in the resource's environment variables; the other variables have working defaults. See [Environment Variables](#environment-variables).
5. Deploy, then open the `app` container's terminal and create the admin login with `setpriv --reuid=node --regid=node --init-groups node dist/server/server/cli.js create-admin --username admin`. See [Create The First Admin](#create-the-first-admin).
6. Sign in at `https://<your-host>` and follow the Launch Ops checklist.

**Docker on your own machine (plain HTTP, localhost only)**

1. `git clone https://github.com/0x3639/testnet.git && cd testnet`
2. `APP_SECRET="$(openssl rand -hex 32)" docker compose up -d --build` (save that secret; you need the same value on every restart).
3. `docker compose exec --user node app node dist/server/server/cli.js create-admin --username admin`
4. Open `http://localhost:8080` and sign in. See [Standalone Docker](#standalone-docker) for exposing it beyond localhost.

Both paths preapprove the same release repositories (`zenon-network/go-zenon`, `digitalSloth/go-zenon`, `0x3639/go-zenon`, and `hypercore-one/deployment`); see [Release Repository Policy](#release-repository-policy) to change that.

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
- Release repository allowlist, immutable published releases pinned to exact commits, and node-side verification of the built `znnd` binary before it can start.
- Admin user, pillar, and seed-node deletion.
- A local four-node devnet generation script for validating the produced genesis/config artifacts.

## Planning Docs

- [Genesis release automation plan](docs/genesis-release-automation-plan.md): proposed event history, configurable `go-zenon` release targets, operator-specific bootstrap scripts, and node polling automation.
- [Cloudflare origin lockdown](docs/cloudflare-origin-lockdown.md): the Cloudflare proxy settings in use for `testnet.zenon.info`, and the planned Authenticated Origin Pulls procedure that makes Coolify's proxy accept that hostname only through Cloudflare.

## Important Security Notes

Set `APP_SECRET` before using the app outside local testing. It is used as the server-side encryption key for sensitive stored wallet package secrets, especially wallet passwords. When `NODE_ENV=production` the server refuses to start unless `APP_SECRET` is set to at least 16 characters.

Do not change `APP_SECRET` after operators register pillars. Existing encrypted wallet package secrets will no longer decrypt correctly if the secret changes.

Treat these as secret material:

- `data/app-state.json`
- operator ZIP packages
- wallet passwords
- wallet seed words
- managed seed node network private keys
- generated devnet `network-private-key` files

The generated `data/`, `dist/`, `node_modules/`, and `devnet/four-node/` directories are intentionally ignored by git.

## Requirements

- Node.js 20 or newer for local development (the container image uses Node 24).
- Docker and Docker Compose for container deployment.
- A Coolify instance for the hosted deployment (it builds the image from this repository and terminates TLS).

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
npm test
npm run build
npm run account -- list
npm run account -- create-admin --username admin --password "change-me"
npm run account -- create-user --username pillar-a --password "change-me"
```

## Runtime Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_SECRET` | none (required in production) | Encryption key for stored wallet passwords, node keys, and status tokens. |
| `DATA_DIR` | `./data` | Location of `app-state.json`. Created with mode `0700`; the state file is written with mode `0600`. |
| `PUBLIC_URL` | none | Fixed public origin (for example `https://testnet.example.com`) used in generated bootstrap scripts and manifests. When unset the origin is derived from the request. |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` setting. Controls which peers may set `X-Forwarded-*` (and therefore the client address used by login rate limiting). Both compose files set `uniquelocal` because the reverse proxy (the bundled Caddy, or Coolify's proxy) reaches the app over a private Docker network; any peer in the trusted range can forge forwarded addresses, so keep it as narrow as your topology allows. |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS so the session cookie is only sent over TLS. |
| `ALLOWED_REPO_HOSTS` | `github.com` | Comma-separated hosts that release repositories may live on. |
| `ALLOWED_REPOS` | `zenon-network/go-zenon`, `digitalSloth/go-zenon`, `0x3639/go-zenon`, `hypercore-one/deployment` (plus `GO_ZENON_REPO` / `DEPLOYMENT_REPO` while this and `ALLOWED_REPO_HOSTS` are unset) | Comma-separated repository URLs an admin may publish (host compared case-insensitively, path exactly). Setting it replaces the default list; set to `*` to allow any repository on an allowed host. |
| `GO_ZENON_COMMIT`, `DEPLOYMENT_COMMIT` | none | Default commit pins for fresh installs (full 40-character hashes). |

The container runs the server as the unprivileged `node` user. The entrypoint starts as root only long enough to fix ownership of the data volume, so volumes created by earlier root-only images keep working without manual changes.

Login is rate limited: 10 attempts per account from one address, or 50 attempts from one address, within 15 minutes; further attempts return `429` until the window expires. At most 8 password checks run concurrently.

## Release Repository Policy

Operator nodes clone and run the published repositories as root, so the server only accepts release settings that pass the repository policy: `https://` URLs without embedded credentials, on a host in `ALLOWED_REPO_HOSTS`, and (unless `ALLOWED_REPOS=*`) exactly one of the allowed repositories. By default these are the go-zenon sources `zenon-network/go-zenon`, `digitalSloth/go-zenon`, and `0x3639/go-zenon`, plus `hypercore-one/deployment`, whose `zenon.sh` installer the node bootstrap runs. While `ALLOWED_REPOS` and `ALLOWED_REPO_HOSTS` keep their defaults, whatever `GO_ZENON_REPO` and `DEPLOYMENT_REPO` are set to is allowed as well, including their hosts; an explicit `ALLOWED_REPOS` or `ALLOWED_REPO_HOSTS` list replaces those defaults and must include them itself. Refs must satisfy the same rules as `git check-ref-format --branch`. The policy is enforced when settings are saved and again when a release is published; a previously published release that violates it is withheld from nodes. The admin settings form shows the active policy.

Every published release is immutable. Commit pins are full 40-character hashes; a pin left empty in the settings is resolved to the ref's current commit at publish time (by reading the repository's advertised refs over HTTPS), so the published plan always carries both pins and publishing fails if a ref cannot be resolved. Nodes then verify them:

- **Deployment commit.** The agent clones the deployment repository, fetches and checks out exactly the pinned commit (so the release stays installable after the branch moves forward), and refuses to run anything from it if the checkout cannot be moved to that commit. A pin that is no longer reachable from the ref (for example after a force-push) can only be installed if the Git host serves commits by hash, which GitHub does; otherwise the release fails verification and a new one must be published.
- **go-zenon commit.** The agent checks out go-zenon at the pinned commit locally and points the deployment script at that checkout, so the build is reproducible. The bootstrap also installs a systemd `ExecStartPre` hook (`znn-testnet-verify-znnd`) on the node service: before every start it reads the git revision Go embeds in the `znnd` binary (`go version -m`) and refuses to start unless it equals the pin and the metadata declares an unmodified tree. It also refuses to start when no release has been applied by the agent yet. The agent confirms the hook is active and runs the same check after the build; on failure it moves the binary aside as `znnd.unverified`, leaves the service stopped, and reports "Install failed" with the reason in the admin Node Status panel. A binary installed before pins were verified is rebuilt and verified the next time the agent runs.

Verification failures are recorded and not retried until a new release is published or an operator runs `znn-testnet-agent --retry` on the node, which clears the record and retries immediately. Other failures (network errors, a failed build) are retried by cron every minute.

Upgrade order: publish a release with this version of the builder before re-running the bootstrap on existing nodes, since the new agent only accepts pinned releases and the start-time hook refuses to start a node that has not applied one. Pillar configs generated by this version bind RPC to loopback; anything that queried a pillar's RPC directly must use the seed node instead.

Generated pillar configs bind RPC (ports `35997` and `35998`) to `127.0.0.1` with no browser origins; only the local bootstrap agent needs them. Seed / non-producing node configs keep RPC on all interfaces with `*` origins so the explorer and faucet can reach them.

## Release Target Configuration

The node bootstrap script reads its active install target from the admin settings. Fresh installs use these environment variables as defaults:

```text
GO_ZENON_REPO=https://github.com/zenon-network/go-zenon.git
GO_ZENON_REF=master
DEPLOYMENT_REPO=https://github.com/hypercore-one/deployment.git
DEPLOYMENT_REF=main
```

After the app is running, admins can edit the go-zenon repo/ref, deployment repo/ref, the optional commit pins, one-shot data wipe flag, and optional release apply time from the Network section. Saving these values only updates the draft settings. They do not reach `/node-plan.json` or authenticated bootstrap manifests until an admin clicks **Publish Release**, which resolves any empty commit pin to the ref's current commit so the published release is immutable. Set `GO_ZENON_REF` to a branch or tag that the deployment script can clone with `git clone -b`.

## Standalone Docker

Use `docker-compose.yml` when you want the repo to run its own Caddy container. This is the easiest local or single-host setup.

```bash
APP_SECRET="$(openssl rand -hex 32)" docker compose up -d --build
```

Create the first admin account inside the app container. Run it as the `node` user so the state file stays owned by the service account:

```bash
docker compose exec --user node app node dist/server/server/cli.js create-admin --username admin
```

Open the app:

```text
http://localhost:8080
```

The bundled Caddy serves plain HTTP and listens on `127.0.0.1` only. To expose it on other interfaces set `HTTP_BIND=0.0.0.0`, and put a TLS-terminating proxy in front of it before sending real credentials through it (set `COOKIE_SECURE=true` once TLS is in place).

The standalone stack contains:

- `app`: the Node/React application on internal port `8787`.
- `caddy`: a bundled reverse proxy exposed on `${HTTP_PORT:-8080}`.
- `testnet-data`: persistent app state mounted at `/app/data`.

## Coolify

Use `docker-compose.coolify.yml` to run the hosted testnet builder on Coolify. Coolify builds the image from this repository, terminates TLS with its own proxy, and routes the domain you configure to the app container. The compose file publishes no host ports: only Coolify's proxy reaches the container, over the Docker network Coolify creates for this resource.

### Create The Resource

In Coolify:

1. Open the project and environment you want to deploy into.
2. Click **New Resource** and choose **Docker Compose** from a **Git repository** (public repository, or a connected GitHub App for private ones).
3. Repository: `https://github.com/0x3639/testnet.git`, branch `main`.
4. Docker Compose location: `docker-compose.coolify.yml`.
5. After Coolify loads the compose file, set the domain for the `app` service as described in [Set Up The Domain](#set-up-the-domain).
6. Set the environment variables below.
7. Click **Deploy**.

Leave **Connect To Predefined Network** off. It is not needed, and keeping the resource on its own network means nothing except Coolify's proxy can reach the app or forge proxy headers.

### Set Up The Domain

The app listens on port `8787` inside the container, and Coolify's proxy routes a domain to port `80` unless the domain value says otherwise, so the port must be part of the domain value.

1. Create a DNS `A` record (and `AAAA` if the server has IPv6) for the hostname, for example `testnet.zenon.info`, pointing at the Coolify server that runs this resource. Wait until it resolves.
2. Make sure TCP ports `80` and `443` on that server reach Coolify's proxy; Let's Encrypt validation and the site itself use them.
3. In the resource, open the `app` service and find the **Domains for app** field.
4. Enter the domain with the `https://` scheme and the internal port suffix:

   ```text
   https://testnet.zenon.info:8787
   ```

   The `:8787` tells Coolify which container port to route to; the public site is still served on the standard HTTPS port. Using `https://` makes Coolify's proxy request and renew the TLS certificate automatically.
5. Save, then deploy (or redeploy) the resource so the proxy picks up the route.

For a quick test without DNS, leave the field empty and click **Generate Domain**: Coolify assigns a temporary `sslip.io` hostname (or one under the server's **Wildcard Domain** if configured). Replace it with the real hostname before inviting operators, because the generated bootstrap commands embed the public URL.

The compose file declares Coolify's `SERVICE_URL_APP_8787` magic variable, so Coolify fills `SERVICE_URL_APP` with `https://<domain>` (no port) and the app uses it as `PUBLIC_URL`. After the first deploy, confirm the operator bootstrap command shown on an operator's page starts with the right `https://<domain>`; if it does not, set `PUBLIC_URL` explicitly in the environment variables and redeploy.

### Environment Variables

Coolify shows every `${VARIABLE}` from the compose file in the resource's **Environment Variables** tab. Set:

- `APP_SECRET`: required. A stable secret, for example `openssl rand -hex 32`. Never change it after operators register pillars; it encrypts stored wallet package secrets.
- `PUBLIC_URL`: optional. Defaults to `SERVICE_URL_APP`, which Coolify fills from the domain set on the `app` service (see [Set Up The Domain](#set-up-the-domain)). Set it explicitly, for example `https://testnet.zenon.info`, if the public origin differs or the magic variable is not populated.
- `TRUST_PROXY`: optional, defaults to `uniquelocal` so Coolify's proxy may set forwarded headers.
- `TZ`: optional, defaults to `Etc/UTC`.
- `GO_ZENON_REPO`, `GO_ZENON_REF`, `GO_ZENON_COMMIT`, `DEPLOYMENT_REPO`, `DEPLOYMENT_REF`, `DEPLOYMENT_COMMIT`: optional initial release defaults; see [Release Target Configuration](#release-target-configuration).
- `ALLOWED_REPO_HOSTS`, `ALLOWED_REPOS`: optional repository policy; see [Release Repository Policy](#release-repository-policy).

`COOKIE_SECURE` is fixed to `true` in this compose file because Coolify serves the app over HTTPS.

After deployment the proxy routes:

```text
https://<domain>
https://<domain>/genesis.json
https://<domain>/config.json
https://<domain>/node-plan.json
```

The JSON files return `404` until an admin publishes them from the app.

### Create The First Admin

Open the `app` container's **Terminal** in Coolify (or `docker exec -it <container> sh` on the server) and run the CLI as the `node` user so the state file stays owned by the service account:

```bash
setpriv --reuid=node --regid=node --init-groups node dist/server/server/cli.js create-admin --username admin
```

The command prints the generated password once. Save it before closing the terminal. You can also set the initial password yourself with `--password "replace-this-password"`.

Then open `https://<domain>`, sign in as `admin`, create operator accounts, collect pillar and seed-node registrations, finalize, and publish.

### Updating

Push to `main` and redeploy from Coolify (or enable automatic deployments on push). Keep the same persistent volume and the same `APP_SECRET`. The app stores state in the named volume `testnet-data` at `/app/data`; the container starts as root only long enough to fix that volume's ownership before dropping to the `node` user.

### Migrating From Another Host

To move an existing testnet builder to Coolify without losing registrations:

1. Deploy the resource once so Coolify creates the `testnet-data` volume, then stop it.
2. Copy the old `app-state.json` into the new volume (for example with `docker run --rm -v <old-volume>:/from -v <new-volume>:/to alpine cp /from/app-state.json /to/`).
3. Set `APP_SECRET` in Coolify to exactly the old value; a different secret cannot decrypt the stored wallet passwords, node keys, and status tokens.
4. Start the resource, sign in, and click **Publish Release** before operators re-run the bootstrap on their nodes: the current agent only accepts pinned releases.
5. Have every operator re-run the bootstrap command shown on their operator page on the new site. Re-running it replaces the node's previous agent configuration so the node reports only to the new URL (see [Operator Bootstrap](#operator-bootstrap)). Until an operator does this, that node keeps reporting to the old URL and will not receive releases published from the new site.

### Putting Cloudflare In Front

The public hostname can be proxied through Cloudflare (orange cloud) with the encryption mode on **Full (strict)**, which Coolify's Let's Encrypt certificate satisfies. Because the node agents are plain `curl` clients, a WAF custom rule must skip bot and rate-limit checks for the agent and published-file paths, and Bot Fight Mode must stay off. The exact rule, and the planned procedure for making the origin refuse `testnet.zenon.info` connections that did not come through Cloudflare (Authenticated Origin Pulls with a per-router Traefik TLS option, so other sites on the same Coolify host are unaffected), are documented in [docs/cloudflare-origin-lockdown.md](docs/cloudflare-origin-lockdown.md).

## Admin Workflow

The admin console has six sections: Status, Launch Ops, Users, Nodes, Network, and Release. The launch bar's playbook (Launch, Relaunch, or Change release) tracks which step comes next. On the Release page, Finalize is required before the first Publish, and the page enforces that order.

1. Sign in as an admin.
2. In **Users**, create one operator login per expected pillar and managed seed node.
3. Send each operator the copied login URL, username, and password.
4. Ask pillar operators to sign in and choose a pillar name.
5. In **Network**, set the go-zenon and deployment repo/ref release target.
6. In **Network**, set **Genesis Start (UTC)** to the intended chain start time. For a coordinated restart, set it comfortably in the future.
7. In **Network**, optionally set **Apply Release At (UTC)** so nodes wait before stopping, wiping, downloading artifacts, and restarting.
8. In **Users**, create an operator login for each managed seed node; then in **Nodes**, use **Seed Nodes** to select that login, enter node name, public IP, and p2p port. The app generates the network private key, public key, enode, and libp2p multiaddr immediately.
9. In **Network**, add or probe any external seed nodes, and confirm managed seed nodes are present in `Net.Seeders` and `Net.BootstrapPeers`.
10. In **Release**, review the generated `genesis.json` and `config.json`.
11. In **Release**, finalize the genesis when registrations are complete.
12. In **Release**, click **Publish Release** when the current genesis, config, seeders, bootstrap peers, and release target should become active for operators.

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

After registering a pillar or seed node, the operator page shows a copyable command shaped like this:

```bash
curl -fsSL "https://<domain>/api/bootstrap/install.sh" | sudo env ZNN_BOOTSTRAP_TOKEN="<node-token>" ZNN_TESTNET_URL="https://<domain>" bash
```

Run it on the node host. The script is intended for the same Linux/systemd style environment supported by `hypercore-one/deployment`.

Re-running the command is safe and is how a node is moved to a new builder URL: the installer waits for any agent run in progress, removes the previous agent configuration (including any stray cron entries that would run the agent), installs the new one, and prints which URL it replaced. A node reports to exactly one builder, the one in the most recently run command. Node status tokens are stored in the builder's state, so after a migration that keeps `app-state.json` the same command and token keep working.
In **Node Deployment**, the go-zenon repo and branch/tag choose the node source code that gets built. The deployment script repo and branch/tag choose the installer scripts that clone, build, install, and manage the service. Every published release is pinned to exact commits: leave a commit pin empty to pin the branch tip at publish time, or fill it in to publish a specific commit.
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

1. Downloads the authenticated bootstrap manifest with the node token.
2. Records the pinned go-zenon commit for the systemd start-time verifier.
3. Clones the deployment repository and checks out exactly the pinned deployment commit.
4. Patches the deployment pre-flight CPU minimum to `ZNN_DEPLOYMENT_MIN_CPU_CORES`, default `2`, and changes the total RAM check to warning-only.
5. Checks out go-zenon at the pinned commit locally and runs `./zenon.sh --deploy zenon` against that checkout to build and install `znnd`.
6. Stops `go-zenon`, confirms the start-time verification hook is active, and verifies the built binary's embedded revision matches the pin (see [Release Repository Policy](#release-repository-policy)).
7. Wipes node data if the published node plan has `actions.wipeData: true`.
8. Writes `/root/.znn/genesis.json`.
9. Writes the node-specific `/root/.znn/config.json`.
10. For pillars, writes `/root/.znn/wallet/producer.json` and `/root/.znn/wallet/producer-password.txt`.
11. For managed seed nodes, writes `/root/.znn/network-private-key`.
12. Restarts `go-zenon` and sends a status report.

The wipe action is controlled by **Wipe node data on next Publish Release** in the Network section. It is one-shot: publishing a release snapshots the flag into `/node-plan.json`, then clears the draft checkbox. **Apply Release At (UTC)** is also one-shot: publishing snapshots it into `/node-plan.json`, then clears the draft field. The agent preserves `/root/.znn/wallet`, `/root/.znn/genesis.json`, `/root/.znn/config.json`, and `/root/.znn/network-private-key`, and removes other files/directories under `/root/.znn` before writing the published artifacts.

The token in the bootstrap command also authorizes node-specific downloads and node status reporting. Treat it like an operator secret.

## Node Status Reporting

Each registered pillar or managed seed node receives a private node status token in its operator package and bootstrap command. The installed agent uses that token to report health back to the orchestrator without exposing the app username or password.

Heartbeat reports are sent with a bearer token:

```bash
curl -fsS -X POST "https://<domain>/api/bootstrap/status" \
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

After the admin clicks **Publish Release**, these files are served without authentication. The Release page requires a completed Finalize before the first Publish.

Standalone Docker:

```text
http://localhost:8080/genesis.json
http://localhost:8080/config.json
http://localhost:8080/node-plan.json
```

Coolify:

```text
https://<domain>/genesis.json
https://<domain>/config.json
https://<domain>/node-plan.json
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

For an external already-running seed node, use the **External Seeder / RPC Probe** panel before publishing the config. The app calls the seed node RPC on port `35997` by default, reads `stats.networkInfo.self.publicKey`, and saves both an `enode://<public-key>@<ip>:35995` entry into `Net.Seeders` and a `/ip4/<ip>/tcp/35995/p2p/<peer-id>` entry into `Net.BootstrapPeers`.

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

Start the standalone builder first and make sure the admin login exists. The script defaults to builder URL `http://127.0.0.1:8080` and admin username `admin`; `ADMIN_PASSWORD` has no default and must be supplied.

Run:

```bash
BUILDER_URL=http://127.0.0.1:8080 \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD="<your admin password>" \
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
docker-compose.yml           Standalone app + Caddy stack (local / single host)
docker-compose.coolify.yml   App-only stack for Coolify (TLS and routing by Coolify's proxy)
```

## API Endpoints

Most API endpoints require an authenticated session cookie.

Public endpoints:

- `GET /api/health`
- `GET /api/public/stats`
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
- `GET /api/bootstrap/manifest`
- `GET /api/bootstrap/node-config.json`
- `GET /api/bootstrap/pillar-config.json`
- `GET /api/bootstrap/producer.json`
- `GET /api/bootstrap/producer-password.txt`
- `GET /api/bootstrap/network-private-key`
