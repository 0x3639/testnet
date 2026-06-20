# Zenon Testnet Builder

Web tooling for coordinating a Zenon Network of Momentum testnet. The app lets an admin create operator logins, collect pillar registrations, generate operator wallet packages, build `genesis.json`, build a node `config.json`, and publish those files for unauthenticated `wget` access.

The backend is Node/Express. The frontend is React/Vite and follows the dark, compact NoM-style interface used by `digitalSloth/nom-ui`. Wallet and address generation uses `digitalSloth/znn-typescript-sdk`.

## Features

- Admin and operator logins backed by local persistent state.
- Admin-created operator credentials with password generation and copyable handoff text.
- Operator pillar registration by pillar name.
- Generated pillar, reward, and producer wallets for every registered operator.
- Operator ZIP packages with addresses, encrypted keyfiles, wallet passwords, seed words, producer config, and producer wallet file.
- Admin seed node discovery from a seed node IP address and RPC port.
- Admin overview of all pillar, reward, and producer addresses.
- Live and finalized `genesis.json` preview.
- Base non-producing `config.json` preview.
- Public publish step for `/genesis.json` and `/config.json`.
- Admin user and pillar deletion.
- A local four-node devnet generation script for validating the produced genesis/config artifacts.

## Planning Docs

- [Genesis release automation plan](docs/genesis-release-automation-plan.md): proposed event history, configurable `go-zenon` release targets, operator-specific bootstrap scripts, and node polling automation.

## Important Security Notes

Set `APP_SECRET` before using the app outside local testing. It is used as the server-side encryption key for sensitive stored wallet package secrets, especially wallet passwords.

Do not change `APP_SECRET` after operators register pillars. Existing encrypted wallet package secrets will no longer decrypt correctly if the secret changes.

Treat these as secret material:

- `data/app-state.json`
- operator ZIP packages
- wallet passwords
- wallet seed words
- generated devnet `network-private-key` files

The generated `data/`, `dist/`, `node_modules/`, and `devnet/four-node/` directories are intentionally ignored by git.

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

## Standalone Docker

Use `docker-compose.yml` when you want the repo to run its own Caddy container. This is the easiest local or single-host setup.

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
- `caddy`: a bundled reverse proxy exposed on `${HTTP_PORT:-8080}`.
- `testnet-data`: persistent app state mounted at `/app/data`.

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
- `TZ`: optional, defaults to `Etc/UTC`.

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

Sign in as `admin`, create operator accounts, collect pillar registrations, configure the seed node, finalize, and publish.

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
2. Create one operator login per expected pillar.
3. Send each operator the copied login URL, username, and password.
4. Ask each operator to sign in, choose a pillar name, and download their pillar package.
5. Add or probe the seed node in the admin panel so `Net.Seeders` contains the seed node enode.
6. Review the generated `genesis.json` and `config.json`.
7. Finalize the genesis when registrations are complete.
8. Publish the files so operators can fetch them without authentication.

Admins can also reset user passwords, delete users, delete pillar registrations, and download the spork wallet package.

## Operator Package

Each operator downloads a ZIP containing:

- `pillar-info.json`
- `config.json`
- encrypted keyfiles for producer, pillar, and reward wallets
- wallet passwords
- seed words for producer, pillar, and reward wallets

The package `config.json` is pillar-specific and includes the producer settings. The public `/config.json` is a generic non-producing node config.

## Published Files

After the admin clicks Publish, these files are served without authentication:

Standalone Docker:

```text
http://localhost:8080/genesis.json
http://localhost:8080/config.json
```

Portainer/Caddy:

```text
https://<TESTNET_HOST>/genesis.json
https://<TESTNET_HOST>/config.json
```

Publishing stores a snapshot. If settings, seeders, pillars, or finalized genesis data change later, publish again to update the public files.

## Seeders

In the admin panel, enter a seed node IP address and probe it before publishing the config. The app calls the seed node RPC on port `35997` by default, reads `stats.networkInfo.self.publicKey`, and saves an `enode://<public-key>@<ip>:35995` entry into `Net.Seeders`.

Use the node's public IP address. If RPC or p2p is exposed on non-default ports, adjust the ports in the seed node form before probing.

The public `config.json` includes the saved seeders and no `Producer` block. Operator package configs include producer settings and wallet references.

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

Admin-only downloads:

- `GET /api/admin/genesis.json`
- `GET /api/admin/config-template.json`
- `GET /api/admin/spork-package.zip`

Operator download:

- `GET /api/pillar/package`
