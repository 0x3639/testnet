# Cloudflare Origin Lockdown

Status: **planned, not yet applied.** The Cloudflare proxy settings in the first section are live; the Authenticated Origin Pulls procedure below has not been carried out.

Goal: make the Coolify host accept `testnet.zenon.info` traffic only when it arrives through Cloudflare, without affecting the other sites Coolify serves from the same host.

## Why Not A Host Firewall

Every site on the Coolify host shares one Traefik proxy on ports 80 and 443. A port-level firewall (ufw, nftables, a cloud security group) can only allow or block Cloudflare's address ranges for all sites at once, and Docker publishes the proxy ports around ufw unless `DOCKER-USER` chain rules are written by hand. Per-site enforcement therefore has to happen inside Traefik, where the hostname is known.

Two per-site options exist:

- **IP allowlist middleware** on the testnet router, listing Cloudflare's published ranges. Simple, but anything that can send traffic from a Cloudflare range (for example another customer's Worker) passes, and the range list must be refreshed by hand when Cloudflare changes it.
- **Authenticated Origin Pulls** (mutual TLS). Cloudflare presents a client certificate on every connection to the origin, and Traefik refuses the `testnet.zenon.info` TLS handshake without it. This is the chosen option.

## What Is Already Configured In Cloudflare

Zone `zenon.info`, hostname `testnet.zenon.info`:

- DNS record is proxied (orange cloud).
- SSL/TLS encryption mode: Automatic, currently running **Full (strict)**. Coolify's Let's Encrypt certificate on the origin satisfies it.
- Bot Fight Mode: off. Leaving it on would challenge the node agents, which are plain `curl` clients.
- Security → Security rules → Custom rules: one rule named **Testnet builder: skip WAF for node agents and published files**, action **Skip** (all rate limiting rules, all managed rules, all Super Bot Fight Mode rules, User Agent Blocking, Browser Integrity Check, Security Level), expression:

  ```text
  (http.host eq "testnet.zenon.info" and (
    starts_with(http.request.uri.path, "/api/bootstrap/") or
    http.request.uri.path eq "/api/node/status" or
    http.request.uri.path in {"/genesis.json" "/config.json" "/node-plan.json"}
  ))
  ```

  These are the paths the node agent and operators fetch non-interactively (see [Operator Bootstrap](../README.md#operator-bootstrap) and [Published Files](../README.md#published-files)). If a new agent endpoint is added under a different prefix, add it to this rule or the agent will start hitting challenges. The admin UI and `/api/*` routes outside that list stay behind the WAF.

Note that with the proxy on, the app sees Cloudflare edge addresses as the client IP, so its login rate limiter keys on those. See [Follow-Up: Real Client IPs](#follow-up-real-client-ips).

## How Authenticated Origin Pulls Works Here

1. Cloudflare, once the zone setting is on, sends a client certificate signed by Cloudflare's private **Origin Pull CA** on every connection to the origin. Origins that never ask for a client certificate ignore it, so turning the zone setting on changes nothing by itself.
2. Coolify's proxy is a stock Traefik container (`traefik:v3.x`). Coolify mounts the host directory `/data/coolify/proxy` at `/traefik` inside the container and runs Traefik's file provider on `/traefik/dynamic/`, which Coolify exposes in its UI as **Dynamic Configurations**.
3. A Traefik **TLS option** named `cloudflare-mtls` requires and verifies a client certificate against the Cloudflare CA. Traefik applies TLS options per SNI hostname, so attaching the option to the `testnet.zenon.info` router alone leaves every other site's handshake unchanged.
4. Traefik rejects requests whose TLS SNI and HTTP `Host` header map to different TLS options with `421 Misdirected Request`, so a client cannot handshake as another site on the host and then send a `Host: testnet.zenon.info` header to reach the app.

## Procedure

Do the steps in this order. Steps 1 to 3 change nothing visible; step 4 turns enforcement on.

### 1. Enable Authenticated Origin Pulls in Cloudflare

Zone `zenon.info` → **SSL/TLS** → **Origin Server** → **Authenticated Origin Pulls** → On.

The dashboard toggle is zone-wide. That is fine: other hostnames in the zone receive the client certificate too, and their Traefik routers ignore it because they carry no `clientAuth` option. Per-hostname mode exists only through the API and requires uploading your own certificate; it is not needed.

### 2. Put the Cloudflare CA on the Coolify host

As root on the Coolify server:

```bash
mkdir -p /data/coolify/proxy/certs
curl -fsSL https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem \
  -o /data/coolify/proxy/certs/cloudflare-origin-pull-ca.pem
openssl x509 -in /data/coolify/proxy/certs/cloudflare-origin-pull-ca.pem -noout -subject -enddate
```

Inside the proxy container the file is `/traefik/certs/cloudflare-origin-pull-ca.pem`. Note the `notAfter` date printed by `openssl` and put a reminder ahead of it (see [CA Rotation](#ca-rotation)).

### 3. Add the Traefik dynamic configuration

In Coolify: **Servers** → the server → **Proxy** → **Dynamic Configurations** → **Add**. File name `cloudflare-mtls.yaml`, contents:

```yaml
tls:
  options:
    cloudflare-mtls:
      minVersion: VersionTLS12
      clientAuth:
        caFiles:
          - /traefik/certs/cloudflare-origin-pull-ca.pem
        clientAuthType: RequireAndVerifyClientCert
```

Traefik's file provider watches the directory, so no proxy restart is needed. Immediately check the proxy logs (**Proxy** → **Logs**, or `docker logs coolify-proxy --since 2m` on the host). A wrong CA path or a YAML error is logged and the option is dropped, which would leave the router on the default (open) TLS options after step 4.

### 4. Attach the option to the testnet router

Coolify generates the HTTPS router for a compose service as `https-0-<resource-uuid>-<service>`, so for the `app` service it is `https-0-<resource-uuid>-app`. The resource UUID is the last path segment of the resource's URL in the Coolify UI. To confirm the exact name, run on the host:

```bash
docker inspect <app-container> --format '{{json .Config.Labels}}' | tr ',' '\n' | grep 'routers.https-0-'
```

Coolify generates the router's `tls=true` and `tls.certresolver=letsencrypt` labels but never a `tls.options` label, so a label from the compose file merges cleanly with Coolify's. Add it to the `app` service in `docker-compose.coolify.yml`:

```yaml
    labels:
      - traefik.http.routers.https-0-<resource-uuid>-app.tls.options=cloudflare-mtls@file
```

Commit, push, and redeploy the resource. From this point the origin refuses `testnet.zenon.info` handshakes that do not present Cloudflare's certificate.

### 5. Verify

Run these from a machine outside the Coolify host.

Direct to the origin, bypassing Cloudflare. This must fail during the TLS handshake (look for `alert certificate required`, `bad certificate`, or an empty reply), not return HTML:

```bash
curl -sv --resolve testnet.zenon.info:443:<origin-ip> https://testnet.zenon.info/ 2>&1 | tail -n 5
```

Handshaking as another site on the host and sending the testnet `Host` header must be refused with `421`:

```bash
curl -sk --resolve other.example.com:443:<origin-ip> -H 'Host: testnet.zenon.info' \
  -o /dev/null -w '%{http_code}\n' https://other.example.com/
```

Through Cloudflare, the site must still work:

```bash
curl -sI https://testnet.zenon.info/ | head -n 1
curl -s https://testnet.zenon.info/api/bootstrap/manifest -o /dev/null -w '%{http_code}\n'
```

A second site on the same host must still load without a client certificate. Finally, watch the admin portal's Nodes section: the agents report through Cloudflare, so status timestamps should keep advancing.

## Operations

### CA Rotation

Cloudflare rotates the Origin Pull CA occasionally and announces it in advance. During the overlap, download the new PEM next to the old one and list both files under `caFiles`; remove the old entry after Cloudflare has switched. Traefik reloads the dynamic file on save.

### Certificate Renewal

Coolify's Let's Encrypt resolver uses the HTTP-01 challenge on port 80, which is a plain-HTTP router that never consults TLS options, so renewals are unaffected.

### Rollback

1. Remove the `tls.options` label from `docker-compose.coolify.yml` and redeploy the resource. The router returns to the default TLS options and the site is reachable without a client certificate again.
2. Only then delete the `cloudflare-mtls.yaml` dynamic configuration. Deleting it first would leave the router pointing at a missing TLS option.
3. The Cloudflare zone toggle can stay on; it is harmless without an enforcing origin.

## Follow-Up: Real Client IPs

With the orange cloud on, Traefik's peer address is a Cloudflare edge, and the app's `TRUST_PROXY=uniquelocal` setting trusts only the proxy hop, so the login rate limiter (`AttemptLimiter`) currently keys on Cloudflare edge addresses. Once Authenticated Origin Pulls guarantees that every `testnet.zenon.info` request came through Cloudflare, the `CF-Connecting-IP` header can be trusted for that router. The change is app-side (read the header only when the immediate peer is trusted and the header is present) and should be made after step 5 passes, not before.
