# Loupe Security Scanning

This repository carries a Project Loupe scanner profile at
`.loupe/scanner-config.json`. The profile covers the TypeScript application
and the operational files that automatic package-root discovery would not
normally include, especially the devnet wallet-generation script, container
definitions, Caddy configuration, and Vite configuration.

The profile relies on per-repository scanner configuration, including
`extra_source_paths`. Use the compatible Loupe fork at
`https://github.com/edgepillar/loupe.git`, pinned to commit
`5c8744c1b2823415fe851d17bae92ff8f7193a15`. Do not silently substitute a
Loupe revision that does not implement these scanner fields.

## Register the repository

Run these commands from a checkout of this repository after the Loupe server,
worker, and `loupectl` client are configured:

```bash
loupectl repo add \
  --clone-url https://github.com/0x3639/testnet.git \
  --branch main \
  --scanner-config-file .loupe/scanner-config.json \
  --no-reporting \
  --verification-enabled \
  --require-approval
```

The safe initial policy is deliberate:

- `max_concurrent_files` remains `1` to bound provider usage and keep the pilot
  deliberately serial. Increase it only after reviewing measured usage and
  scan behavior.
- `--no-reporting` keeps findings in Loupe for manual triage until a tracker
  repository and scoped GitHub token are selected.
- `--verification-enabled` asks a second agent to validate each candidate.
- `--require-approval` prevents a confirmed finding from being dispatched
  without an operator decision.
- No scan interval is set, so the first runs are explicitly controlled and
  their provider usage can be observed.

The command prints the assigned repository ID. Start the baseline scan with:

```bash
loupectl repo scan <repo-id>
```

Inspect progress and results with:

```bash
loupectl job list
loupectl finding list <repo-id>
loupectl finding show <finding-id>
```

After the baseline completes, scan later changes incrementally:

```bash
loupectl repo scan <repo-id> --incremental
```

## Profile lifecycle

Loupe stores the scanner JSON when the repository is registered. If
`.loupe/scanner-config.json` changes, reload it without discarding prior jobs
or findings:

```bash
loupectl repo update <repo-id> \
  --scanner-config-file .loupe/scanner-config.json
```

Do not put Loupe credentials, API keys, GitHub tokens, wallet material, or
testnet operator secrets in this profile.
