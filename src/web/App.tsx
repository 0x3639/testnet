import { ArrowLeft, Copy, Download, FileJson, KeyRound, LogOut, Server, Shield, Terminal, UserPlus } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { AdminOverview, AuthUser, PublicStats, Role, UserOverview } from "../shared/types";
import { AdminApp } from "./admin/AdminApp";
import { api, type RefreshState, type Session } from "./shared/api";
import { bootstrapCommand, copy, download, formatUtc, isHttpUrl, repoShortName } from "./shared/format";
import { AddressValue, Button, EndpointRow, StatTile } from "./shared/ui";

function Login({ onLogin, onBack }: { onLogin: (session: Session) => void; onBack?: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      const session = await api<Session>(result.user.role === "admin" ? "/api/admin/overview" : "/api/me");
      onLogin(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <section className="loginPanel">
        <div className="brandMark">
          <Shield size={34} />
        </div>
        <h1>Zenon Testnet Builder</h1>
        <form onSubmit={submit} className="stack">
          <label>
            <span>Username</span>
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <div className="alert">{error}</div> : null}
          <Button type="submit" icon={<KeyRound size={18} />} disabled={loading}>
            {loading ? "Signing in" : "Sign in"}
          </Button>
          {onBack ? (
            <Button variant="ghost" icon={<ArrowLeft size={18} />} onClick={onBack}>
              Back to testnet info
            </Button>
          ) : null}
        </form>
      </section>
    </main>
  );
}

const RPC_ENDPOINTS = [
  { label: "WebSocket", url: "wss://rpc.testnet.zenon.info" },
  { label: "HTTPS", url: "https://rpc.testnet.zenon.info" }
];

function Landing({ onLogin }: { onLogin: (session: Session) => void }) {
  const [showLogin, setShowLogin] = useState(false);
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void api<PublicStats>("/api/public/stats")
        .then((next) => {
          if (!cancelled) setStats(next);
        })
        .catch(() => undefined);
    };
    load();
    const interval = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (showLogin) {
    return <Login onLogin={onLogin} onBack={() => setShowLogin(false)} />;
  }

  const networkLive = Boolean(stats && stats.activeNodes > 0);
  return (
    <div className="landing">
      <header className="landingTopbar">
        <div className="brand">
          <div className="logoBox">
            <Server size={22} />
          </div>
          <div>
            <strong>Zenon Testnet</strong>
            <span>Network of Momentum</span>
          </div>
        </div>
        <Button variant="secondary" icon={<KeyRound size={18} />} onClick={() => setShowLogin(true)}>
          Operator Login
        </Button>
      </header>

      <main className="landingMain">
        <section className="landingHero">
          <span className="ledger">Public testnet</span>
          <h1>Build on the Network of Momentum</h1>
          <p>
            A community-run Zenon testnet for wallets, tooling, and protocol experiments. Connect over RPC, fund an
            address from the faucet, and start sending transactions.
          </p>
          <div className="endpointBlock">
            {RPC_ENDPOINTS.map((endpoint) => (
              <EndpointRow key={endpoint.url} label={endpoint.label} url={endpoint.url} />
            ))}
            <small className="endpointNote">Standard TLS ports — nothing to append.</small>
          </div>
        </section>

        <section className="landingStats">
          <div className="statsHeader">
            <span className={`liveDot${networkLive ? " on" : ""}`} aria-hidden="true" />
            <span className="ledger">{networkLive ? "Network live" : "Network status"}</span>
          </div>
          <div className="statTiles">
            <StatTile
              label="Active nodes"
              value={stats ? `${stats.activeNodes}/${stats.totalNodes}` : "—"}
              hint="reported in last 5 min"
            />
            <StatTile
              label="Pillars"
              value={stats ? `${stats.pillarCount}/${stats.expectedPillars}` : "—"}
              hint="registered/expected"
            />
            <StatTile label="Seed nodes" value={stats ? stats.seedNodeCount : "—"} />
            <StatTile label="Chain ID" value={stats ? stats.chainIdentifier : "—"} />
            <StatTile
              label="Node software"
              value={
                stats ? (
                  isHttpUrl(stats.goZenonRepo) ? (
                    <a href={stats.goZenonRepo.replace(/\.git$/, "")} target="_blank" rel="noreferrer">
                      {repoShortName(stats.goZenonRepo)}
                    </a>
                  ) : (
                    repoShortName(stats.goZenonRepo)
                  )
                ) : (
                  "—"
                )
              }
              hint={stats ? `${stats.goZenonRef}${stats.goZenonCommit ? ` @ ${stats.goZenonCommit.slice(0, 8)}` : ""}` : undefined}
            />
            <StatTile
              label="Genesis"
              value={stats ? new Date(stats.genesisTimestampSec * 1000).toISOString().slice(0, 10) : "—"}
              hint={stats?.publishedAt ? `published ${formatUtc(stats.publishedAt)}` : undefined}
            />
          </div>
        </section>

        <section className="linkCards">
          <a className="linkCard" href="https://faucet.zenonhub.io/" target="_blank" rel="noreferrer">
            <span className="ledger">Faucet</span>
            <strong>Get testnet ZNN &amp; QSR</strong>
            <span className="linkCardUrl mono">faucet.zenonhub.io</span>
          </a>
          <a className="linkCard" href="https://explorer.testnet.zenon.info" target="_blank" rel="noreferrer">
            <span className="ledger">Explorer</span>
            <strong>Track momentums &amp; transactions</strong>
            <span className="linkCardUrl mono">explorer.testnet.zenon.info</span>
          </a>
        </section>

        <section className="landingFiles">
          <span className="ledger">Network files</span>
          <div className="fileLinks">
            <a className="fileLink mono" href="/genesis.json" target="_blank" rel="noreferrer">
              <FileJson size={16} />
              genesis.json
            </a>
            <a className="fileLink mono" href="/config.json" target="_blank" rel="noreferrer">
              <FileJson size={16} />
              config.json
            </a>
          </div>
          <small>Published with each release — use them to run your own node against this network.</small>
        </section>

        <section className="landingSteps">
          <span className="ledger">Using the testnet</span>
          <ol>
            <li>
              <strong>Connect</strong>
              <span>Point znn-cli, an SDK, or your wallet at either RPC endpoint above.</span>
            </li>
            <li>
              <strong>Get funded</strong>
              <span>Request testnet ZNN and QSR from the faucet for an address you control.</span>
            </li>
            <li>
              <strong>Verify</strong>
              <span>Watch your transactions land in the explorer.</span>
            </li>
          </ol>
        </section>
      </main>

      <footer className="landingFooter">
        <span>Running a pillar or seed node for this testnet?</span>
        <button className="linkButton" type="button" onClick={() => setShowLogin(true)}>
          Sign in to manage your node
        </button>
      </footer>
    </div>
  );
}

function Shell({ user, children, onLogout }: { user: AuthUser; children: React.ReactNode; onLogout: () => void }) {
  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logoBox">
            <Server size={22} />
          </div>
          <div>
            <strong>NoM Testnet</strong>
            <span>{user.role}</span>
          </div>
        </div>
        <div className="userBadge">
          <span>{user.username.slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{user.username}</strong>
            <small>{user.role === "admin" ? "Admin" : "Operator"}</small>
          </div>
        </div>
        <Button variant="ghost" icon={<LogOut size={18} />} onClick={onLogout}>
          Sign out
        </Button>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

function OperatorView({ session, refresh }: { session: UserOverview; refresh: () => Promise<void> }) {
  const [pillarName, setPillarName] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [seedPublicIp, setSeedPublicIp] = useState("");
  const [seedP2pPort, setSeedP2pPort] = useState(35995);
  const [registerSeedNode, setRegisterSeedNode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const command = session.bootstrap?.statusToken ? bootstrapCommand(session.bootstrap.statusToken) : "";
  const hasNode = Boolean(session.pillar || session.seedNode);
  const displayName = session.pillar?.pillarName ?? session.seedNode?.nodeName ?? "Register Node";

  async function register(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/api/pillar", {
        method: "POST",
        body: JSON.stringify(
          registerSeedNode
            ? { nodeType: "seed", nodeName, publicIp: seedPublicIp, p2pPort: seedP2pPort }
            : { nodeType: "pillar", pillarName }
        )
      });
      setPillarName("");
      setNodeName("");
      setSeedPublicIp("");
      setSeedP2pPort(35995);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pageGrid">
      <section>
        <div className="sectionTitle">
          <span className="ledger">Operator</span>
          <h1>{displayName}</h1>
        </div>
        {session.pillar ? (
          <div className="panel">
            <div className="detailGrid">
              <Field label="Pillar Address" value={<AddressValue value={session.pillar.pillarAddress} />} />
              <Field label="Reward Address" value={<AddressValue value={session.pillar.rewardAddress} />} />
              <Field label="Producer Address" value={<AddressValue value={session.pillar.producerAddress} />} />
              <Field label="Producer Index" value={<span className="mono">{session.pillar.producerIndex}</span>} />
            </div>
            <div className="toolbar">
              <Button icon={<Download size={18} />} onClick={() => download("/api/pillar/package")}>
                Download Package
              </Button>
              {command ? (
                <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(command)}>
                  Copy Bootstrap
                </Button>
              ) : null}
            </div>
            {command ? (
              <div className="bootstrapBlock">
                <div className="panelHeader">
                  <div>
                    <span className="ledger">Node Bootstrap</span>
                    <h2>Install command</h2>
                  </div>
                  <Terminal size={20} />
                </div>
                <pre className="commandBlock">{command}</pre>
              </div>
            ) : null}
          </div>
        ) : session.seedNode ? (
          <div className="panel">
            <div className="detailGrid">
              <Field label="Public IP" value={<span className="mono">{session.seedNode.publicIp}</span>} />
              <Field label="P2P Port" value={<span className="mono">{session.seedNode.p2pPort}</span>} />
              <Field label="Public Key" value={<AddressValue value={session.seedNode.publicKey} />} />
              <Field label="Enode" value={<AddressValue value={session.seedNode.enode} />} />
              <Field label="Multiaddr" value={<AddressValue value={session.seedNode.multiaddr} />} />
            </div>
            <div className="toolbar">
              <Button icon={<Download size={18} />} onClick={() => download("/api/pillar/package")}>
                Download Package
              </Button>
              {command ? (
                <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(command)}>
                  Copy Bootstrap
                </Button>
              ) : null}
            </div>
            {command ? (
              <div className="bootstrapBlock">
                <div className="panelHeader">
                  <div>
                    <span className="ledger">Node Bootstrap</span>
                    <h2>Install command</h2>
                  </div>
                  <Terminal size={20} />
                </div>
                <pre className="commandBlock">{command}</pre>
              </div>
            ) : null}
          </div>
        ) : (
          <form className="panel stack" onSubmit={register}>
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={registerSeedNode}
                onChange={(event) => setRegisterSeedNode(event.target.checked)}
              />
              <span>Register this account as a seed node</span>
            </label>
            {registerSeedNode ? (
              <>
                <label>
                  <span>Seed Node Name</span>
                  <input value={nodeName} onChange={(event) => setNodeName(event.target.value)} maxLength={40} />
                </label>
                <div className="formGrid">
                  <label>
                    <span>Public IP</span>
                    <input className="mono" value={seedPublicIp} onChange={(event) => setSeedPublicIp(event.target.value)} />
                  </label>
                  <label>
                    <span>P2P Port</span>
                    <input
                      className="mono"
                      type="number"
                      min={1}
                      max={65535}
                      value={seedP2pPort}
                      onChange={(event) => setSeedP2pPort(Number(event.target.value))}
                    />
                  </label>
                </div>
              </>
            ) : (
              <label>
                <span>Pillar Name</span>
                <input value={pillarName} onChange={(event) => setPillarName(event.target.value)} maxLength={40} />
              </label>
            )}
            {error ? <div className="alert">{error}</div> : null}
            <Button type="submit" icon={<UserPlus size={18} />} disabled={loading}>
              {loading ? "Creating" : registerSeedNode ? "Create Seed Node" : "Create Pillar"}
            </Button>
          </form>
        )}
      </section>
      {session.seedNode && !session.pillar ? (
        <section className="panel mutedPanel">
          <span className="ledger">Seed Node</span>
          <div className="detailGrid singleColumn">
            <Field label="Producer" value={<span className="mutedText">Not used</span>} />
            <Field label="Pillar Wallet" value={<span className="mutedText">Not used</span>} />
            <Field label="Seeder" value={<span className="mono">Managed enode + multiaddr</span>} />
          </div>
        </section>
      ) : (
        <section className="panel mutedPanel">
          <span className="ledger">{hasNode ? "Allocation" : "Pillar Allocation"}</span>
          <div className="amountRows">
            <AmountRow label="Pillar" znn="50,000" qsr="500,000" />
            <AmountRow label="Fused Producer" qsr="1,000" />
            <AmountRow label="Fused Pillar" qsr="1,000" />
            <AmountRow label="Fused Reward" qsr="1,000" />
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="field">
      <span className="ledger">{label}</span>
      {value}
    </div>
  );
}

function AmountRow({ label, znn, qsr }: { label: string; znn?: string; qsr?: string }) {
  return (
    <div className="amountRow">
      <span>{label}</span>
      <strong className="mono">{znn ? `${znn} ZNN` : ""}</strong>
      <strong className="mono">{qsr ? `${qsr} QSR` : ""}</strong>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const refreshSequence = useRef(0);

  async function loadCurrentSession(role?: Role): Promise<Session> {
    if (role === "admin") return api<AdminOverview>("/api/admin/overview");
    return api<UserOverview>("/api/me");
  }

  async function refresh() {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    setRefreshState("refreshing");
    try {
      setSession(await loadCurrentSession(session?.user.role));
      setRefreshState("updated");
      window.setTimeout(() => {
        if (refreshSequence.current === sequence) setRefreshState("idle");
      }, 1200);
    } catch (error) {
      setRefreshState("error");
      window.setTimeout(() => {
        if (refreshSequence.current === sequence) setRefreshState("idle");
      }, 1600);
      throw error;
    }
  }

  useEffect(() => {
    api<UserOverview>("/api/me")
      .then(async (current) => {
        if (current.user.role === "admin") {
          setSession(await api<AdminOverview>("/api/admin/overview"));
        } else {
          setSession(current);
        }
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    const role = session.user.role;
    const interval = window.setInterval(() => {
      void loadCurrentSession(role)
        .then(setSession)
        .catch(() => undefined);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [session?.user.id, session?.user.role]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setSession(null);
  }

  if (loading) return <div className="loading">Loading</div>;
  if (!session) return <Landing onLogin={setSession} />;

  if (session.user.role === "admin") {
    return <AdminApp session={session as AdminOverview} refresh={refresh} refreshState={refreshState} onLogout={logout} />;
  }

  return (
    <Shell user={session.user} onLogout={logout}>
      <OperatorView session={session as UserOverview} refresh={refresh} />
    </Shell>
  );
}
