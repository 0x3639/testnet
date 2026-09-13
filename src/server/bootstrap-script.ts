/**
 * Generates the operator bootstrap installer served at /api/bootstrap/install.sh. It installs a
 * cron-driven agent that applies published releases and a systemd ExecStartPre gate that refuses
 * to start a znnd binary whose embedded git revision differs from the pinned commit.
 *
 * The body is a JS template literal: `\${` produces a literal `${` in the emitted bash.
 */
export function bootstrapInstallScript(origin: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root, usually via sudo." >&2
  exit 1
fi

: "\${ZNN_BOOTSTRAP_TOKEN:?Set ZNN_BOOTSTRAP_TOKEN to the node bootstrap token from the testnet builder.}"

BASE_URL="\${ZNN_TESTNET_URL:-${origin}}"
ZNN_DIR="\${ZNN_DIR:-/root/.znn}"
DEPLOYMENT_DIR="\${ZNN_DEPLOYMENT_DIR:-/opt/zenon-deployment}"
DEPLOYMENT_MIN_CPU_CORES="\${ZNN_DEPLOYMENT_MIN_CPU_CORES:-2}"
SERVICE_NAME="\${ZNN_SERVICE_NAME:-go-zenon}"
RPC_URL="\${ZNN_RPC_URL:-http://127.0.0.1:35997}"
BOOTSTRAP_TRACE="\${ZNN_BOOTSTRAP_TRACE:-0}"

if ! [[ "$DEPLOYMENT_MIN_CPU_CORES" =~ ^[0-9]+$ ]] || (( DEPLOYMENT_MIN_CPU_CORES < 1 )); then
  DEPLOYMENT_MIN_CPU_CORES=2
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git jq util-linux
fi

STATE_DIR="\${ZNN_AGENT_STATE_DIR:-/var/lib/znn-testnet-agent}"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

# systemd runs this before every start of the node service. It refuses to let znnd start unless
# the binary's embedded git revision is exactly the commit pinned by the published release.
cat > /usr/local/bin/znn-testnet-verify-znnd <<'VERIFY'
#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${ZNN_AGENT_STATE_DIR:-/var/lib/znn-testnet-agent}"
DEPLOYMENT_DIR="\${ZNN_DEPLOYMENT_DIR:-/opt/zenon-deployment}"
expected="\${1:-}"
if [[ -z "$expected" ]]; then
  # No explicit argument: systemd is asking. The agent writes this file before it applies any
  # release; if it is missing, no release has been applied on this node and nothing may start.
  if [[ ! -r "$STATE_DIR/expected-znnd-commit" ]]; then
    echo "no release has been applied by the testnet agent yet ($STATE_DIR/expected-znnd-commit is missing); refusing to start" >&2
    exit 1
  fi
  expected="$(tr -d '[:space:]' < "$STATE_DIR/expected-znnd-commit")"
  if [[ -z "$expected" ]]; then
    echo "$STATE_DIR/expected-znnd-commit is empty; refusing to start" >&2
    exit 1
  fi
fi
expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
if ! [[ "$expected" =~ ^[0-9a-f]{40}$ ]]; then
  echo "pinned commit is not a full 40-character hash: $expected" >&2
  exit 1
fi
binary="$(command -v znnd || true)"
[[ -n "$binary" ]] || binary=/usr/local/bin/znnd
if [[ ! -x "$binary" ]]; then
  echo "znnd binary not found at $binary" >&2
  exit 1
fi
go_bin="$DEPLOYMENT_DIR/go/bin/go"
if [[ ! -x "$go_bin" ]]; then
  echo "go toolchain not found at $go_bin; cannot read build metadata" >&2
  exit 1
fi
info="$("$go_bin" version -m "$binary" 2>/dev/null || true)"
revision="$(printf '%s\\n' "$info" | awk '$1 == "build" && $2 ~ /^vcs\\.revision=/ { sub(/^vcs\\.revision=/, "", $2); print $2; exit }' | tr '[:upper:]' '[:lower:]')"
modified_lines="$(printf '%s\\n' "$info" | awk '$1 == "build" && $2 ~ /^vcs\\.modified=/ { sub(/^vcs\\.modified=/, "", $2); print $2 }')"
modified_count="$(printf '%s' "$modified_lines" | grep -c . || true)"
if ! [[ "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo "znnd binary has no embedded git revision; refusing to start an unverifiable build" >&2
  exit 1
fi
if [[ "$modified_count" != "1" || "$modified_lines" != "false" ]]; then
  echo "znnd binary build metadata does not declare exactly vcs.modified=false (revision $revision); refusing to start it" >&2
  exit 1
fi
if [[ "$revision" != "$expected" ]]; then
  echo "znnd binary revision $revision does not match the pinned commit $expected; refusing to start it" >&2
  exit 1
fi
echo "revision=$revision"
VERIFY
chmod 755 /usr/local/bin/znn-testnet-verify-znnd

mkdir -p "/etc/systemd/system/$SERVICE_NAME.service.d"
cat > "/etc/systemd/system/$SERVICE_NAME.service.d/10-znn-testnet-verify.conf" <<EOF
[Service]
Environment=ZNN_AGENT_STATE_DIR=$STATE_DIR
Environment=ZNN_DEPLOYMENT_DIR=$DEPLOYMENT_DIR
ExecStartPre=/usr/local/bin/znn-testnet-verify-znnd
EOF
if command -v systemctl >/dev/null 2>&1; then
  # Fatal on failure: without a reload the ExecStartPre gate would not be active.
  systemctl daemon-reload
fi

cat > /usr/local/bin/znn-testnet-agent <<'AGENT'
#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="\${ZNN_AGENT_ENV_FILE:-/etc/cron.d/znn-testnet-agent}"
if [[ -z "\${ZNN_BOOTSTRAP_TOKEN:-}" && -r "$ENV_FILE" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      ZNN_BOOTSTRAP_TOKEN|ZNN_TESTNET_URL|ZNN_DIR|ZNN_DEPLOYMENT_DIR|ZNN_DEPLOYMENT_MIN_CPU_CORES|ZNN_RPC_URL|ZNN_SERVICE_NAME|ZNN_AGENT_STATE_DIR|ZNN_BOOTSTRAP_TRACE)
        [[ -n "$value" ]] && export "$key=$value"
        ;;
    esac
  done < <(grep -E '^(ZNN_BOOTSTRAP_TOKEN|ZNN_TESTNET_URL|ZNN_DIR|ZNN_DEPLOYMENT_DIR|ZNN_DEPLOYMENT_MIN_CPU_CORES|ZNN_RPC_URL|ZNN_SERVICE_NAME|ZNN_AGENT_STATE_DIR|ZNN_BOOTSTRAP_TRACE)=' "$ENV_FILE" || true)
fi

: "\${ZNN_BOOTSTRAP_TOKEN:?Missing ZNN_BOOTSTRAP_TOKEN.}"

BASE_URL="\${ZNN_TESTNET_URL:-${origin}}"
ZNN_DIR="\${ZNN_DIR:-/root/.znn}"
DEPLOYMENT_DIR="\${ZNN_DEPLOYMENT_DIR:-/opt/zenon-deployment}"
DEPLOYMENT_MIN_CPU_CORES="\${ZNN_DEPLOYMENT_MIN_CPU_CORES:-2}"
RPC_URL="\${ZNN_RPC_URL:-http://127.0.0.1:35997}"
SERVICE_NAME="\${ZNN_SERVICE_NAME:-go-zenon}"
STATE_DIR="\${ZNN_AGENT_STATE_DIR:-/var/lib/znn-testnet-agent}"
BOOTSTRAP_TRACE="\${ZNN_BOOTSTRAP_TRACE:-0}"
INSTALL_STATE_FILE="$STATE_DIR/install-state.json"
STATUS_FILE="$STATE_DIR/status.json"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

if [[ "\${1:-}" == "--retry" ]]; then
  # Operator recovery: forget a recorded verification failure so the current release is retried.
  if [[ -s "$INSTALL_STATE_FILE" ]]; then
    jq 'del(.failedKey, .lastError, .failedAt)' "$INSTALL_STATE_FILE" > "$INSTALL_STATE_FILE.tmp" && mv "$INSTALL_STATE_FILE.tmp" "$INSTALL_STATE_FILE"
  fi
  echo "Cleared recorded release failure; the next run will retry the current release."
fi

if ! [[ "$DEPLOYMENT_MIN_CPU_CORES" =~ ^[0-9]+$ ]] || (( DEPLOYMENT_MIN_CPU_CORES < 1 )); then
  DEPLOYMENT_MIN_CPU_CORES=2
fi

auth_get() {
  curl -fsSL -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" "$1"
}

fetch_artifact() {
  # Downloads to a temporary file and moves it into place so a failed download never leaves a
  # truncated artifact behind.
  local url="$1" dest="$2" tmp
  tmp="$(mktemp "$dest.XXXXXX")" || return 1
  if ! auth_get "$url" > "$tmp" || [[ ! -s "$tmp" ]]; then
    rm -f "$tmp"
    echo "Failed to download $url" >&2
    return 1
  fi
  mv -f "$tmp" "$dest"
}

try_auth_get() {
  local tmp code
  tmp="$(mktemp)"
  code="$(curl -sS -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" -w "%{http_code}" -o "$tmp" "$1" || true)"
  if [[ "$code" == "200" ]]; then
    cat "$tmp"
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

rpc() {
  curl -fs --max-time 5 -H "Content-Type: application/json" \\
    -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"$1\\",\\"params\\":[]}" \\
    "$RPC_URL" 2>/dev/null | jq -c '.result // {}'
}

wipe_data_dir() {
  local item base
  mkdir -p "$ZNN_DIR"
  shopt -s dotglob nullglob
  for item in "$ZNN_DIR"/*; do
    base="$(basename "$item")"
    case "$base" in
      wallet|genesis.json|config.json|network-private-key)
        continue
        ;;
    esac
    rm -rf -- "$item"
  done
  shopt -u dotglob nullglob
}

verify_gate_active() {
  # Confirms systemd will run the verifier before every start of the node service.
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl is not available; cannot enforce the start-time verification gate"
    return 1
  fi
  if ! systemctl daemon-reload >/dev/null 2>&1; then
    echo "systemctl daemon-reload failed; cannot enforce the start-time verification gate"
    return 1
  fi
  local pre
  pre="$(systemctl show -p ExecStartPre --value "$SERVICE_NAME" 2>/dev/null || true)"
  if [[ "$pre" != *"znn-testnet-verify-znnd"* ]]; then
    echo "the $SERVICE_NAME unit does not run znn-testnet-verify-znnd before start; re-run the bootstrap installer"
    return 1
  fi
  return 0
}

checkout_pinned() {
  # Clones $1 at ref $2 into $4 and, when a commit $3 is given, moves the checkout to exactly that
  # commit (fetching it by hash if the ref has moved on, or the ref's full history when the server
  # does not serve commits by hash). Leaves a local branch "pinned" on it so the checkout can be
  # cloned again by branch name.
  # Exit codes: 0 ok; 1 transient (network/clone) failure, safe to retry; 2 the pinned commit is
  # not obtainable from the ref, which is an integrity failure and is not retried automatically.
  local repo="$1" ref="$2" commit="$3" dest="$4" head
  rm -rf "$dest"
  git clone --depth 1 --branch "$ref" -- "$repo" "$dest" || return 1
  if [[ -z "$commit" ]]; then
    return 0
  fi
  head="$(git -C "$dest" rev-parse HEAD 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)"
  if [[ "$head" != "$commit" ]]; then
    echo "Ref $ref is at \${head:-unknown}; fetching pinned commit $commit"
    if ! git -C "$dest" fetch --depth 1 origin "$commit"; then
      echo "Server did not serve the commit by hash; fetching the full history of $ref"
      git -C "$dest" fetch --unshallow origin "$ref" || return 1
    fi
    if ! git -C "$dest" cat-file -e "$commit^{commit}" 2>/dev/null; then
      echo "Pinned commit $commit is not reachable from $ref in $repo"
      return 2
    fi
    # The commit is present; a failure from here on is a local problem, not a bad pin.
    git -C "$dest" checkout --quiet --detach "$commit" || return 1
  fi
  head="$(git -C "$dest" rev-parse HEAD 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)"
  if [[ "$head" != "$commit" ]]; then
    echo "Checkout of $repo ended at \${head:-unknown}, not the pinned commit $commit"
    return 2
  fi
  git -C "$dest" checkout --quiet -B pinned "$commit" || return 1
  return 0
}

write_expected_commit() {
  # Atomically replaces the pin the systemd verifier reads, so a concurrent start never observes a
  # truncated file. Refuses to record an empty pin: current releases always carry one.
  local commit="$1" tmp
  if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Refusing to record an invalid or empty commit pin: '$commit'" >&2
    return 1
  fi
  tmp="$(umask 077 && mktemp "$STATE_DIR/.expected-znnd-commit.XXXXXX")" || return 1
  if ! printf '%s\\n' "$commit" > "$tmp" || ! chmod 600 "$tmp" || ! mv -f "$tmp" "$STATE_DIR/expected-znnd-commit"; then
    rm -f "$tmp"
    return 1
  fi
}

binary_fingerprint() {
  # SHA-256 of the installed znnd binary, or empty when there is none. Used to tell a binary the
  # current run built apart from one left over from an earlier release.
  local binary
  binary="$(command -v znnd || true)"
  [[ -n "$binary" ]] || binary=/usr/local/bin/znnd
  [[ -f "$binary" ]] || return 0
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$binary" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$binary" | cut -d ' ' -f 1
  else
    stat -c '%s-%Y' "$binary" 2>/dev/null || stat -f '%z-%m' "$binary"
  fi
}

verify_znnd_build() {
  # Runs the same check systemd applies before every start (see znn-testnet-verify-znnd) and
  # returns its diagnostic on stdout so it can be reported.
  local expected="$1" output
  if [[ ! -x /usr/local/bin/znn-testnet-verify-znnd ]]; then
    echo "znn-testnet-verify-znnd is not installed; re-run the bootstrap installer"
    return 1
  fi
  if output="$(/usr/local/bin/znn-testnet-verify-znnd "$expected" 2>&1)"; then
    printf '%s\\n' "$output" | sed -n 's/^revision=//p'
    return 0
  fi
  printf '%s\\n' "$output" | tail -n 1
  return 1
}

quarantine_binary() {
  local binary
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  binary="$(command -v znnd || true)"
  [[ -n "$binary" ]] || binary="/usr/local/bin/znnd"
  if [[ -f "$binary" ]]; then
    mv -f "$binary" "$binary.unverified"
    echo "Moved unverified binary to $binary.unverified; the service will not start it." >&2
  fi
}

record_install_failure() {
  # Deliberately replaces the whole install state rather than merging into it: after a failure the
  # node must not remember a desiredKey/verifiedCommit, or a later --retry could take the fast
  # path and report success without rebuilding and re-verifying the (possibly quarantined) binary.
  local failed_key="$1" event_id="$2" message="$3"
  echo "$message" >&2
  jq -n \\
    --arg failedKey "$failed_key" \\
    --arg eventId "$event_id" \\
    --arg lastError "$message" \\
    --arg failedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
    '{ failedKey: $failedKey, eventId: $eventId, lastError: $lastError, failedAt: $failedAt }' > "$INSTALL_STATE_FILE.tmp" || return 1
  mv -f "$INSTALL_STATE_FILE.tmp" "$INSTALL_STATE_FILE"
}

patch_deployment_preflight() {
  local preflight_file="$DEPLOYMENT_DIR/lib/preflight.sh"
  [[ -f "$preflight_file" ]] || return 0

  sed -i -E "s/cores < [0-9]+/cores < $DEPLOYMENT_MIN_CPU_CORES/" "$preflight_file" || return 1
  sed -i -E "s/Minimum [0-9]+ required\\./Minimum $DEPLOYMENT_MIN_CPU_CORES required./" "$preflight_file" || return 1
  sed -i -E '/mem_total_gb < [0-9]+/,/fi/ s/error_log "Total RAM \\$\\{mem_total_gb\\}GiB detected\\. Minimum [0-9]+GiB required\\."/warn_log "Total RAM \\\${mem_total_gb}GiB detected. 4GiB recommended for go-zenon builds."/' "$preflight_file" || return 1
  sed -i -E '/mem_total_gb < [0-9]+/,/fi/ s/^[[:space:]]*return 1[[:space:]]*$/:/' "$preflight_file" || return 1
  echo "Deployment pre-flight patch:"
  echo "  CPU minimum: $DEPLOYMENT_MIN_CPU_CORES core(s)"
  echo "  RAM check: warning only; 4GiB remains recommended"
  if [[ "$BOOTSTRAP_TRACE" == "1" || "$BOOTSTRAP_TRACE" == "true" ]]; then
    echo "Deployment pre-flight patch trace:"
    grep -E 'cores <|Minimum [0-9]+ required|mem_total_gb <|Total RAM|4GiB recommended' "$preflight_file" | sed 's/^/  /' || true
  fi
}

install_release() {
  local manifest="$1"
  local event_id node_type go_repo go_ref go_commit deployment_repo deployment_ref deployment_commit genesis_url config_url producer_url producer_password_url network_private_key_url wipe_data apply_at desired_key installed_key binary_key installed_binary_key installed_verified binary_missing artifacts_ready failed_key verify_output deploy_ok gate_output checkout_output checkout_rc build_repo build_ref binary_before binary_after

  event_id="$(printf '%s' "$manifest" | jq -r '.eventId')"
  node_type="$(printf '%s' "$manifest" | jq -r '.nodeType // "pillar"')"
  go_repo="$(printf '%s' "$manifest" | jq -r '.goZenon.repoUrl')"
  go_ref="$(printf '%s' "$manifest" | jq -r '.goZenon.ref')"
  go_commit="$(printf '%s' "$manifest" | jq -r '.goZenon.commit // empty' | tr '[:upper:]' '[:lower:]')"
  deployment_repo="$(printf '%s' "$manifest" | jq -r '.deployment.repoUrl')"
  deployment_ref="$(printf '%s' "$manifest" | jq -r '.deployment.ref')"
  deployment_commit="$(printf '%s' "$manifest" | jq -r '.deployment.commit // empty' | tr '[:upper:]' '[:lower:]')"
  wipe_data="$(printf '%s' "$manifest" | jq -r '.actions.wipeData // false')"
  apply_at="$(printf '%s' "$manifest" | jq -r '.actions.applyAt // empty')"
  genesis_url="$(printf '%s' "$manifest" | jq -r '.genesisUrl')"
  config_url="$(printf '%s' "$manifest" | jq -r '.configUrl')"
  producer_url="$(printf '%s' "$manifest" | jq -r '.producerKeyFileUrl // empty')"
  producer_password_url="$(printf '%s' "$manifest" | jq -r '.producerPasswordUrl // empty')"
  network_private_key_url="$(printf '%s' "$manifest" | jq -r '.networkPrivateKeyUrl // empty')"
  desired_key="$(printf '%s' "$manifest" | jq -r '[.eventId, (.nodeType // "pillar"), .goZenon.repoUrl, .goZenon.ref, (.goZenon.commit // ""), .deployment.repoUrl, .deployment.ref, (.deployment.commit // ""), (.actions.wipeData // false), (.actions.applyAt // "")] | @tsv')"
  binary_key="$(printf '%s' "$manifest" | jq -r '[.goZenon.repoUrl, .goZenon.ref, (.goZenon.commit // ""), .deployment.repoUrl, .deployment.ref, (.deployment.commit // "")] | @tsv')"
  installed_key="$(jq -r '.desiredKey // empty' "$INSTALL_STATE_FILE" 2>/dev/null || true)"
  installed_binary_key="$(jq -r '.binaryKey // empty' "$INSTALL_STATE_FILE" 2>/dev/null || true)"
  installed_verified="$(jq -r '.verifiedCommit // empty' "$INSTALL_STATE_FILE" 2>/dev/null || true)"
  failed_key="$(jq -r '.failedKey // empty' "$INSTALL_STATE_FILE" 2>/dev/null || true)"
  if [[ -n "$failed_key" && "$failed_key" == "$desired_key" ]]; then
    echo "Release $event_id previously failed verification; waiting for a new release." >&2
    return 1
  fi
  binary_missing=false
  if ! command -v znnd >/dev/null 2>&1; then
    binary_missing=true
  fi
  # A binary installed by an earlier agent that never verified pins must be rebuilt and verified.
  if [[ -n "$go_commit" && "$installed_verified" != "$go_commit" ]]; then
    binary_missing=true
  fi

  # Written before any deployment step so the systemd ExecStartPre gate applies to the very first
  # start of a freshly built binary. Explicitly fatal: without it nothing may start.
  if ! write_expected_commit "$go_commit"; then
    echo "Could not record the pinned commit in $STATE_DIR/expected-znnd-commit" >&2
    return 1
  fi

  artifacts_ready=false
  if [[ -s "$ZNN_DIR/genesis.json" && -s "$ZNN_DIR/config.json" ]]; then
    if [[ "$node_type" == "seed" && -s "$ZNN_DIR/network-private-key" ]]; then
      artifacts_ready=true
    elif [[ "$node_type" != "seed" && -s "$ZNN_DIR/wallet/producer.json" && -s "$ZNN_DIR/wallet/producer-password.txt" ]]; then
      artifacts_ready=true
    fi
  fi

  if [[ "$desired_key" == "$installed_key" && "$artifacts_ready" == "true" ]]; then
    if [[ -z "$go_commit" || "$installed_verified" == "$go_commit" ]]; then
      return 0
    fi
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi

  if [[ "$binary_key" != "$installed_binary_key" || "$binary_missing" == "true" ]]; then
    # If the unit already exists, the start-time gate must be active before anything is rebuilt.
    if command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
      if ! gate_output="$(verify_gate_active)"; then
        record_install_failure "$desired_key" "$event_id" "$gate_output"
        return 1
      fi
    fi

    # The deployment scripts run as root from this checkout, so it is moved to exactly the pinned
    # commit (or rejected) before any of them run.
    checkout_output="$(checkout_pinned "$deployment_repo" "$deployment_ref" "$deployment_commit" "$DEPLOYMENT_DIR" 2>&1)" && checkout_rc=0 || checkout_rc=$?
    if (( checkout_rc != 0 )); then
      rm -rf "$DEPLOYMENT_DIR"
      if (( checkout_rc == 2 )); then
        record_install_failure "$desired_key" "$event_id" "Deployment repository checkout failed: $(printf '%s' "$checkout_output" | tail -n 1)"
      else
        echo "Deployment repository checkout failed (will retry): $(printf '%s' "$checkout_output" | tail -n 1)" >&2
      fi
      return 1
    fi
    printf '%s\\n' "$checkout_output"
    chmod +x "$DEPLOYMENT_DIR/zenon.sh" || return 1
    patch_deployment_preflight || return 1

    # go-zenon is checked out at the pinned commit locally and the deployment script is pointed at
    # that checkout, so the build is reproducible even after the upstream ref moves. A clone of the
    # local checkout keeps the same commit hashes, so the embedded vcs.revision is the pin.
    build_repo="$go_repo"
    build_ref="$go_ref"
    if [[ -n "$go_commit" ]]; then
      checkout_output="$(checkout_pinned "$go_repo" "$go_ref" "$go_commit" "$DEPLOYMENT_DIR/go-zenon-pinned" 2>&1)" && checkout_rc=0 || checkout_rc=$?
      if (( checkout_rc != 0 )); then
        if (( checkout_rc == 2 )); then
          record_install_failure "$desired_key" "$event_id" "go-zenon checkout failed: $(printf '%s' "$checkout_output" | tail -n 1)"
        else
          echo "go-zenon checkout failed (will retry): $(printf '%s' "$checkout_output" | tail -n 1)" >&2
        fi
        return 1
      fi
      printf '%s\\n' "$checkout_output"
      build_repo="file://$DEPLOYMENT_DIR/go-zenon-pinned"
      build_ref="pinned"
    fi

    # zenon.sh builds, installs, and starts the service. The systemd drop-in installed by the
    # bootstrap runs znn-testnet-verify-znnd before any start, so a binary whose embedded revision
    # does not match the pinned commit is never executed, even by the deployment script.
    cd "$DEPLOYMENT_DIR" || return 1
    binary_before="$(binary_fingerprint)"
    deploy_ok=true
    if ! ./zenon.sh --deploy zenon "$build_repo" "$build_ref"; then
      deploy_ok=false
    fi
    binary_after="$(binary_fingerprint)"

    if command -v systemctl >/dev/null 2>&1; then
      systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi

    # A deployment that produced no unit or no binary failed before anything could run; that is a
    # build or environment problem and is retried by cron, never recorded as a verification failure.
    if [[ "$deploy_ok" != "true" ]]; then
      echo "zenon.sh deployment failed. Last deployment log lines:" >&2
      tail -120 "$DEPLOYMENT_DIR/.znnsh.log" >&2 2>/dev/null || true
    fi
    if ! command -v systemctl >/dev/null 2>&1 || ! systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
      echo "The $SERVICE_NAME unit does not exist after deployment; will retry." >&2
      return 1
    fi
    if ! command -v znnd >/dev/null 2>&1; then
      echo "No znnd binary was installed by the deployment; will retry." >&2
      return 1
    fi
    if [[ "$deploy_ok" != "true" && "$binary_after" == "$binary_before" ]]; then
      # The build failed before replacing the previous release's binary. It stays stopped (the
      # start-time gate holds the new pin) and cron retries; nothing about it is a verification result.
      echo "Deployment failed before replacing the existing znnd binary; leaving the service stopped and retrying." >&2
      return 1
    fi

    # This run produced a unit and a binary, so from here on a problem means the binary must not
    # run: the gate must be active and the binary must match the pin before it is ever restarted.
    if ! gate_output="$(verify_gate_active)"; then
      record_install_failure "$desired_key" "$event_id" "$gate_output"
      quarantine_binary
      return 1
    fi

    if [[ -n "$go_commit" ]]; then
      if ! verify_output="$(verify_znnd_build "$go_commit")"; then
        record_install_failure "$desired_key" "$event_id" "$verify_output"
        quarantine_binary
        return 1
      fi
      echo "Verified znnd build commit $verify_output matches the published pin."
    fi

    if [[ "$deploy_ok" != "true" ]]; then
      # Verified binary, but the deployment reported a failure (for example its own start step);
      # leave the service stopped and let cron retry.
      return 1
    fi
  fi

  if [[ "$wipe_data" == "true" ]]; then
    wipe_data_dir
  fi

  mkdir -p "$ZNN_DIR/wallet" || return 1
  fetch_artifact "$genesis_url" "$ZNN_DIR/genesis.json" || return 1
  fetch_artifact "$config_url" "$ZNN_DIR/config.json" || return 1
  if [[ -n "$producer_url" ]]; then
    fetch_artifact "$producer_url" "$ZNN_DIR/wallet/producer.json" || return 1
  fi
  if [[ -n "$producer_password_url" ]]; then
    fetch_artifact "$producer_password_url" "$ZNN_DIR/wallet/producer-password.txt" || return 1
  fi
  if [[ -n "$network_private_key_url" ]]; then
    fetch_artifact "$network_private_key_url" "$ZNN_DIR/network-private-key" || return 1
  fi

  chmod 700 "$ZNN_DIR" "$ZNN_DIR/wallet" || return 1
  chmod 600 "$ZNN_DIR/genesis.json" "$ZNN_DIR/config.json" || return 1
  for secret in "$ZNN_DIR/wallet/producer.json" "$ZNN_DIR/wallet/producer-password.txt" "$ZNN_DIR/network-private-key"; do
    if [[ -f "$secret" ]]; then
      chmod 600 "$secret" || return 1
    fi
  done

  if command -v systemctl >/dev/null 2>&1; then
    if ! systemctl restart "$SERVICE_NAME"; then
      echo "Failed to restart $SERVICE_NAME; see: journalctl -u $SERVICE_NAME" >&2
      return 1
    fi
  fi

  jq -n \\
    --arg desiredKey "$desired_key" \\
    --arg binaryKey "$binary_key" \\
    --arg eventId "$event_id" \\
    --arg installedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
    --arg goRepo "$go_repo" \\
    --arg goRef "$go_ref" \\
    --arg goCommit "$go_commit" \\
    --arg deploymentRepo "$deployment_repo" \\
    --arg deploymentRef "$deployment_ref" \\
    --arg deploymentCommit "$deployment_commit" \\
    --arg verifiedCommit "$go_commit" \\
    --arg nodeType "$node_type" \\
    --arg applyAt "$apply_at" \\
    --argjson wipeData "$wipe_data" \\
    '{
      desiredKey: $desiredKey,
      binaryKey: $binaryKey,
      eventId: $eventId,
      installedAt: $installedAt,
      nodeType: $nodeType,
      goZenon: { repoUrl: $goRepo, ref: $goRef, commit: $goCommit },
      deployment: { repoUrl: $deploymentRepo, ref: $deploymentRef, commit: $deploymentCommit },
      verifiedCommit: $verifiedCommit,
      actions: ({ wipeData: $wipeData } + (if $applyAt == "" then {} else { applyAt: $applyAt } end))
    }' > "$INSTALL_STATE_FILE.tmp" || return 1
  mv -f "$INSTALL_STATE_FILE.tmp" "$INSTALL_STATE_FILE" || return 1
}

report_status() {
  local manifest="\${1:-}"
  local waiting="\${2:-false}"
  local event_id go_repo go_ref go_commit sync_json network_json process_json service_active logs error_count warn_count recent_json payload last_error

  if [[ -n "$manifest" ]]; then
    event_id="$(printf '%s' "$manifest" | jq -r '.eventId')"
    go_repo="$(printf '%s' "$manifest" | jq -r '.goZenon.repoUrl')"
    go_ref="$(printf '%s' "$manifest" | jq -r '.goZenon.ref')"
    go_commit="$(printf '%s' "$manifest" | jq -r '.goZenon.commit // empty')"
  else
    event_id="waiting-for-release"
    go_repo=""
    go_ref=""
    go_commit=""
  fi

  last_error="$(jq -r '.lastError // empty' "$INSTALL_STATE_FILE" 2>/dev/null || true)"
  sync_json="$(rpc stats.syncInfo || echo '{}')"
  network_json="$(rpc stats.networkInfo || echo '{}')"
  process_json="$(rpc stats.processInfo || echo '{}')"
  service_active=false
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE_NAME"; then
    service_active=true
  fi

  logs="$(journalctl -u "$SERVICE_NAME" --since '1 minute ago' --no-pager 2>/dev/null | grep -Eai 'error|warn|panic|fatal|failed|exception' | tail -20 || true)"
  error_count="$(printf '%s\\n' "$logs" | grep -Eai 'error|panic|fatal|failed|exception' | grep -c . || true)"
  warn_count="$(printf '%s\\n' "$logs" | grep -Eai 'warn' | grep -c . || true)"
  recent_json="$(printf '%s\\n' "$logs" | jq -R . | jq -s .)"

  payload="$(jq -n \\
    --arg eventId "$event_id" \\
    --arg reportedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
    --arg hostname "$(hostname)" \\
    --arg goRepo "$go_repo" \\
    --arg goRef "$go_ref" \\
    --arg goCommit "$go_commit" \\
    --arg lastError "$last_error" \\
    --argjson serviceActive "$service_active" \\
    --argjson waiting "$waiting" \\
    --argjson sync "$sync_json" \\
    --argjson network "$network_json" \\
    --argjson process "$process_json" \\
    --argjson errors "$error_count" \\
    --argjson warnings "$warn_count" \\
    --argjson recent "$recent_json" \\
    '{
      eventId: $eventId,
      reportedAt: $reportedAt,
      node: ({
        hostname: $hostname,
        serviceActive: $serviceActive,
        waitingForRelease: $waiting,
        installedRepo: $goRepo,
        installedRef: $goRef,
        installedCommit: $goCommit
      } + (if $lastError == "" then {} else { lastError: $lastError } end)),
      sync: ({
      } + (if ($sync.state // null) == null then {} else { state: $sync.state } end)
        + (if ($sync.currentHeight // null) == null then {} else { currentHeight: $sync.currentHeight } end)
        + (if ($sync.targetHeight // null) == null then {} else { targetHeight: $sync.targetHeight } end)),
      network: ({
        peerCount: (($network.peers // []) | length)
      } + (if ($network.self.publicKey // null) == null then {} else { selfPublicKey: $network.self.publicKey } end)
        + (if ($network.self.ip // null) == null then {} else { selfIp: $network.self.ip } end)
        + {
          peers: (($network.peers // []) | map(
            {}
            + (if (.publicKey // null) == null then {} else { publicKey: .publicKey } end)
            + (if (.ip // null) == null then {} else { ip: .ip } end)
            + (if (.name // null) == null then {} else { name: .name } end)
            + (if (.version // null) == null then {} else { version: .version } end)
          ) | .[0:20])
        }),
      process: ({
      } + (if ($process.version // null) == null then {} else { version: $process.version } end)
        + (if ($process.commit // null) == null then {} else { commit: $process.commit } end)),
      logs: {
        errorCountLastMinute: $errors,
        warningCountLastMinute: $warnings,
        recent: $recent
      }
    }')"

  curl -fsS -X POST "$BASE_URL/api/bootstrap/status" \\
    -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "$payload" >/dev/null || true

  printf '%s\\n' "$payload" > "$STATUS_FILE"
}

# install_release runs as a plain statement so that errexit stays active inside it: any
# unhandled failure aborts the run and this trap reports it, instead of continuing with partial
# state. (A function called inside "if !" would have errexit suppressed throughout its body.)
manifest_for_report=""
on_exit() {
  local rc=$?
  if (( rc != 0 )); then
    echo "Bootstrap agent run failed (exit $rc)." >&2
    report_status "$manifest_for_report" false || true
  fi
}
trap on_exit EXIT

manifest="$(try_auth_get "$BASE_URL/api/bootstrap/manifest" || true)"
if [[ -z "$manifest" ]]; then
  report_status "" true
  echo "No published release is available yet. Waiting for Publish Release."
  exit 0
fi
manifest_for_report="$manifest"

apply_at="$(printf '%s' "$manifest" | jq -r '.actions.applyAt // empty')"
if [[ -n "$apply_at" ]]; then
  apply_at_epoch="$(date -u -d "$apply_at" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date -u +%s)"
  if [[ "$apply_at_epoch" =~ ^[0-9]+$ ]] && (( apply_at_epoch > now_epoch )); then
    report_status "$manifest" true
    echo "Published release applies at $apply_at. Waiting."
    exit 0
  fi
fi

install_release "$manifest"
report_status "$manifest" false
AGENT

chmod 700 /usr/local/bin/znn-testnet-agent

cat > /etc/cron.d/znn-testnet-agent <<EOF
ZNN_BOOTSTRAP_TOKEN=$ZNN_BOOTSTRAP_TOKEN
ZNN_TESTNET_URL=$BASE_URL
ZNN_DIR=$ZNN_DIR
ZNN_DEPLOYMENT_DIR=$DEPLOYMENT_DIR
ZNN_AGENT_STATE_DIR=$STATE_DIR
ZNN_DEPLOYMENT_MIN_CPU_CORES=$DEPLOYMENT_MIN_CPU_CORES
ZNN_RPC_URL=$RPC_URL
ZNN_SERVICE_NAME=$SERVICE_NAME
ZNN_BOOTSTRAP_TRACE=$BOOTSTRAP_TRACE
*/1 * * * * root flock -n /var/lock/znn-testnet-agent.lock /usr/local/bin/znn-testnet-agent
EOF
chmod 600 /etc/cron.d/znn-testnet-agent

flock -n /var/lock/znn-testnet-agent.lock /usr/local/bin/znn-testnet-agent || true

echo "Zenon testnet bootstrap installed. The agent will apply the release after Publish Release."
`;
}
