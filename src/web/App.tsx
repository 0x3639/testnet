import {
  CheckCircle2,
  Copy,
  Download,
  FileJson,
  KeyRound,
  LogOut,
  RefreshCcw,
  Save,
  Search,
  Server,
  Shield,
  Terminal,
  Trash2,
  TriangleAlert,
  UserPlus
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AdminOverview,
  AuthUser,
  ManagedUser,
  PublishedArtifactsInfo,
  PublicNetworkSettings,
  PublicPillar,
  PublicSeedNode,
  ReadinessCheck,
  Role,
  SeedNodeProbeResult,
  UserOverview
} from "../shared/types";

type Session = UserOverview | AdminOverview;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const json = response.headers.get("content-type")?.includes("application/json") ? await response.json() : undefined;
  if (!response.ok) {
    throw new Error(json?.error ?? response.statusText);
  }
  return json as T;
}

function download(path: string): void {
  window.location.assign(path);
}

function shortAddress(value: string): string {
  if (!value) return "";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function copy(value: string): void {
  void navigator.clipboard.writeText(value);
}

function loginUrl(): string {
  return new URL("/", window.location.href).toString();
}

function publicUrl(path: string): string {
  return new URL(path, window.location.href).toString();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function bootstrapCommand(token: string): string {
  const baseUrl = publicUrl("/").replace(/\/$/, "");
  return `curl -fsSL ${shellQuote(publicUrl("/api/bootstrap/install.sh"))} | sudo env ZNN_BOOTSTRAP_TOKEN=${shellQuote(
    token
  )} ZNN_TESTNET_URL=${shellQuote(baseUrl)} bash`;
}

function toUtcDateTimeInput(seconds?: number): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 16);
}

function fromUtcDateTimeInput(value: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(`${value}:00Z`);
  return Number.isNaN(timestamp) ? undefined : Math.floor(timestamp / 1000);
}

function utcSecondsFromNow(minutes: number): number {
  return Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
}

function formatUtc(value: string): string {
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function generatePassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function AddressValue({ value }: { value: string }) {
  return (
    <button className="address" type="button" onClick={() => copy(value)} title={value} aria-label="Copy address">
      <span>{shortAddress(value)}</span>
      <Copy size={14} />
    </button>
  );
}

function Button({
  children,
  icon,
  variant = "primary",
  type = "button",
  onClick,
  disabled
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`btn ${variant}`} type={type} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
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
        </form>
      </section>
    </main>
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
            <Field label="Seeder" value={<span className="mono">Managed enode</span>} />
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

function StatusGrid({ readiness }: { readiness: ReadinessCheck[] }) {
  return (
    <div className="statusGrid">
      {readiness.map((item) => (
        <div className="statusItem" key={item.label}>
          {item.ok ? <CheckCircle2 className="ok" size={18} /> : <TriangleAlert className="warn" size={18} />}
          <div>
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface CreateUserInput {
  username: string;
  password: string;
  role: Role;
}

interface CreatedCredential {
  username: string;
  password: string;
  url: string;
}

function credentialText(credential: CreatedCredential): string {
  return `Zenon testnet login
URL: ${credential.url}
Username: ${credential.username}
Password: ${credential.password}`;
}

function UserManagement({
  users,
  currentUser,
  onCreate,
  onResetPassword,
  onDeleteUser
}: {
  users: ManagedUser[];
  currentUser: AuthUser;
  onCreate: (input: CreateUserInput) => Promise<void>;
  onResetPassword: (userId: string, password: string) => Promise<void>;
  onDeleteUser: (user: ManagedUser) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
    setSuccess("");
    setCreatedCredential(null);
    try {
      const createdUsername = username;
      const createdPassword = password;
      await onCreate({ username, password, role });
      setSuccess(`Created ${createdUsername}`);
      setCreatedCredential({
        username: createdUsername,
        password: createdPassword,
        url: loginUrl()
      });
      setUsername("");
      setPassword("");
      setRole("user");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  function fillGeneratedPassword() {
    setPassword(generatePassword());
    setError("");
  }

  async function resetPassword(event: FormEvent, user: ManagedUser) {
    event.preventDefault();
    setBusy(user.id);
    setError("");
    setSuccess("");
    try {
      await onResetPassword(user.id, resetPasswords[user.id] ?? "");
      setSuccess(`Updated password for ${user.username}`);
      setResetPasswords((current) => ({ ...current, [user.id]: "" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function deleteUser(user: ManagedUser) {
    const nodeText = user.nodeName ? ` and remove ${user.nodeType === "seed" ? "seed node" : "pillar"} ${user.nodeName}` : "";
    if (!window.confirm(`Delete user ${user.username}${nodeText}?`)) return;

    setBusy(`delete:${user.id}`);
    setError("");
    setSuccess("");
    setCreatedCredential(null);
    try {
      await onDeleteUser(user);
      setSuccess(`Deleted ${user.username}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <span className="ledger">Access</span>
          <h2>User Logins</h2>
        </div>
      </div>
      <form className="userCreateGrid" onSubmit={createUser}>
        <label>
          <span>Username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
        </label>
        <label>
          <span>Password</span>
          <div className="passwordEntry">
            <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            <Button variant="secondary" icon={<KeyRound size={18} />} onClick={fillGeneratedPassword}>
              Generate
            </Button>
          </div>
        </label>
        <label>
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="user">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <Button type="submit" icon={<UserPlus size={18} />} disabled={busy === "create"}>
          {busy === "create" ? "Adding" : "Add User"}
        </Button>
      </form>
      {error ? <div className="alert">{error}</div> : null}
      {success ? <div className="successLine">{success}</div> : null}
      {createdCredential ? (
        <div className="credentialCard">
          <div className="credentialRows">
            <span>URL</span>
            <strong className="mono">{createdCredential.url}</strong>
            <span>Username</span>
            <strong className="mono">{createdCredential.username}</strong>
            <span>Password</span>
            <strong className="mono">{createdCredential.password}</strong>
          </div>
          <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(credentialText(createdCredential))}>
            Copy Login
          </Button>
        </div>
      ) : null}
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Node</th>
              <th>Created</th>
              <th>Password</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.username}
                  {user.id === currentUser.id ? <span className="currentUserTag">You</span> : null}
                </td>
                <td className="mono">{user.role === "admin" ? "admin" : "operator"}</td>
                <td>
                  {user.nodeName ? (
                    <>
                      {user.nodeName}
                      <span className="currentUserTag">{user.nodeType === "seed" ? "Seed" : "Pillar"}</span>
                    </>
                  ) : (
                    <span className="mutedText">None</span>
                  )}
                </td>
                <td className="mono">{new Date(user.createdAt).toLocaleString()}</td>
                <td>
                  <form className="resetPasswordForm" onSubmit={(event) => resetPassword(event, user)}>
                    <input
                      value={resetPasswords[user.id] ?? ""}
                      onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                      autoComplete="new-password"
                      placeholder="New password"
                    />
                    <Button type="submit" variant="secondary" icon={<KeyRound size={18} />} disabled={busy === user.id}>
                      {busy === user.id ? "Saving" : "Reset"}
                    </Button>
                  </form>
                </td>
                <td>
                  <Button
                    variant="danger"
                    icon={<Trash2 size={18} />}
                    onClick={() => deleteUser(user)}
                    disabled={user.id === currentUser.id || busy === `delete:${user.id}`}
                  >
                    {busy === `delete:${user.id}` ? "Deleting" : "Delete"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PublishedArtifacts({ published }: { published: PublishedArtifactsInfo }) {
  const genesisUrl = publicUrl(published.genesisPath);
  const configUrl = publicUrl(published.configPath);
  const nodePlanUrl = published.nodePlanPath ? publicUrl(published.nodePlanPath) : "";
  const wgetCommands = [`wget ${genesisUrl}`, `wget ${configUrl}`, nodePlanUrl ? `wget ${nodePlanUrl}` : ""].filter(Boolean).join("\n");

  return (
    <div className="publishedBlock">
      <div className="publishedHeader">
        <div>
          <span className="ledger">Published</span>
          <strong>{new Date(published.publishedAt).toLocaleString()}</strong>
        </div>
        <div className="toolbar">
          <span className="mono mutedText">chain {published.chainIdentifier}</span>
          <span className="mono mutedText">{published.seeders.length} seeder{published.seeders.length === 1 ? "" : "s"}</span>
          {published.genesisStartAt ? <span className="mono mutedText">genesis {formatUtc(published.genesisStartAt)}</span> : null}
          {published.actions?.applyAt ? <span className="statusPill warn">Apply {formatUtc(published.actions.applyAt)}</span> : null}
          {published.release ? <span className="mono mutedText">{published.release.goZenon.ref}</span> : null}
          {published.actions?.wipeData ? <span className="statusPill warn">Wipe data</span> : null}
          <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(wgetCommands)}>
            Copy wget
          </Button>
        </div>
      </div>
      <div className="publishedRows">
        <div className="publishedRow">
          <span className="ledger">Genesis</span>
          <a className="mono" href={genesisUrl}>
            {genesisUrl}
          </a>
          <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(genesisUrl)}>
            Copy
          </Button>
        </div>
        <div className="publishedRow">
          <span className="ledger">Config</span>
          <a className="mono" href={configUrl}>
            {configUrl}
          </a>
          <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(configUrl)}>
            Copy
          </Button>
        </div>
        {nodePlanUrl ? (
          <div className="publishedRow">
            <span className="ledger">Node Plan</span>
            <a className="mono" href={nodePlanUrl}>
              {nodePlanUrl}
            </a>
            <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(nodePlanUrl)}>
              Copy
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatAge(value?: string): string {
  if (!value) return "No report";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function syncStateLabel(value?: number): string {
  if (value === 1) return "Syncing";
  if (value === 2) return "Synced";
  if (value === 0) return "Unknown";
  return value === undefined ? "Unknown" : String(value);
}

type TelemetryNode = {
  id: string;
  name: string;
  nodeType: "pillar" | "seed";
  nodeStatus?: PublicPillar["nodeStatus"];
};

function heightLag(node: TelemetryNode): string {
  const sync = node.nodeStatus?.latest?.sync;
  if (sync?.currentHeight === undefined || sync.targetHeight === undefined) return "-";
  return String(Math.max(0, sync.targetHeight - sync.currentHeight));
}

function nodeHealth(node: TelemetryNode): { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  const latest = node.nodeStatus?.latest;
  if (!latest) return { label: "No report", tone: "muted" };

  const ageMs = Date.now() - Date.parse(latest.receivedAt);
  if (!Number.isNaN(ageMs) && ageMs > 5 * 60 * 1000) return { label: "Stale", tone: "bad" };
  if (latest.node?.waitingForRelease) return { label: "Waiting", tone: "warn" };
  if (latest.node?.serviceActive === false) return { label: "Service down", tone: "bad" };
  if ((latest.logs?.errorCountLastMinute ?? 0) > 0) return { label: "Errors", tone: "bad" };
  if (latest.sync?.state !== undefined && latest.sync.state !== 2) return { label: syncStateLabel(latest.sync.state), tone: "warn" };
  if (latest.sync?.currentHeight !== undefined && latest.sync.targetHeight !== undefined && latest.sync.targetHeight - latest.sync.currentHeight > 5) {
    return { label: "Lagging", tone: "warn" };
  }
  return { label: "Online", tone: "ok" };
}

function NodeStatusPanel({ nodes, refresh }: { nodes: TelemetryNode[]; refresh: () => Promise<void> }) {
  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <span className="ledger">Telemetry</span>
          <h2>Node Status</h2>
        </div>
        <Button variant="secondary" icon={<RefreshCcw size={18} />} onClick={refresh}>
          Refresh
        </Button>
      </div>
      <div className="tableWrap">
        <table className="nodeStatusTable">
          <thead>
            <tr>
              <th>Node</th>
              <th>Type</th>
              <th>Health</th>
              <th>Last Seen</th>
              <th>Height</th>
              <th>Lag</th>
              <th>Sync</th>
              <th>Peers</th>
              <th>Version</th>
              <th>Service</th>
              <th>Logs</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => {
              const latest = node.nodeStatus?.latest;
              const health = nodeHealth(node);
              const recentLogs = latest?.logs?.recent?.join(" | ") ?? "";
              return (
                <tr key={node.id}>
                  <td>{node.name}</td>
                  <td className="mono">{node.nodeType}</td>
                  <td>
                    <span className={`statusPill ${health.tone}`}>{health.label}</span>
                  </td>
                  <td className="mono">{formatAge(latest?.receivedAt)}</td>
                  <td className="mono">{latest?.sync?.currentHeight ?? "-"}</td>
                  <td className="mono">{heightLag(node)}</td>
                  <td>{syncStateLabel(latest?.sync?.state)}</td>
                  <td className="mono">{latest?.network?.peerCount ?? "-"}</td>
                  <td className="mono">{latest?.node?.waitingForRelease ? "waiting" : latest?.node?.installedRef ?? "-"}</td>
                  <td>{latest?.node?.waitingForRelease ? "waiting" : latest?.node?.serviceActive === undefined ? "-" : latest.node.serviceActive ? "active" : "down"}</td>
                  <td>
                    <span className="mono">
                      E:{latest?.logs?.errorCountLastMinute ?? 0} W:{latest?.logs?.warningCountLastMinute ?? 0}
                    </span>
                    {recentLogs ? (
                      <div className="logSnippet" title={recentLogs}>
                        {recentLogs}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface ProbeSeedInput {
  ip: string;
  rpcPort: number;
  p2pPort: number;
}

interface CreateSeedNodeInput {
  userId: string;
  nodeName: string;
  publicIp: string;
  p2pPort: number;
}

function SettingsForm({
  settings,
  onSave,
  onProbeSeed
}: {
  settings: PublicNetworkSettings;
  onSave: (settings: PublicNetworkSettings) => Promise<void>;
  onProbeSeed: (seed: ProbeSeedInput) => Promise<{ seed: SeedNodeProbeResult; settings: PublicNetworkSettings }>;
}) {
  const [draft, setDraft] = useState(settings);
  const [seedIp, setSeedIp] = useState("");
  const [seedRpcPort, setSeedRpcPort] = useState(35997);
  const [seedP2pPort, setSeedP2pPort] = useState(35995);
  const [seedResult, setSeedResult] = useState("");
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setDraft(settings), [settings]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        seeders: draft.seeders.filter(Boolean),
        sporks: draft.sporks
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function probeSeed() {
    setProbing(true);
    setError("");
    setSeedResult("");
    try {
      const result = await onProbeSeed({
        ip: seedIp,
        rpcPort: seedRpcPort,
        p2pPort: seedP2pPort
      });
      setDraft(result.settings);
      setSeedResult(result.seed.enode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }

  return (
    <form className="panel settingsForm" onSubmit={submit}>
      <div className="formGrid">
        <label>
          <span>Chain Identifier</span>
          <input
            className="mono"
            type="number"
            value={draft.chainIdentifier}
            onChange={(event) => setDraft({ ...draft, chainIdentifier: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Genesis Start (UTC)</span>
          <input
            className="mono"
            type="datetime-local"
            value={toUtcDateTimeInput(draft.genesisTimestampSec)}
            onChange={(event) => {
              const value = fromUtcDateTimeInput(event.target.value);
              if (value) setDraft({ ...draft, genesisTimestampSec: value });
            }}
          />
        </label>
        <label>
          <span>Minimum Pillars</span>
          <input
            className="mono"
            type="number"
            value={draft.minPillars}
            onChange={(event) => setDraft({ ...draft, minPillars: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Expected Pillars</span>
          <input
            className="mono"
            type="number"
            value={draft.expectedPillars}
            onChange={(event) => setDraft({ ...draft, expectedPillars: Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        <span>Extra Data</span>
        <input value={draft.extraData} onChange={(event) => setDraft({ ...draft, extraData: event.target.value })} />
      </label>
      <div className="seedProbe">
        <div className="panelHeader">
          <div>
            <span className="ledger">Release Target</span>
            <h2>Node Deployment</h2>
          </div>
        </div>
        <div className="formGrid">
          <label>
            <span>go-zenon Repo</span>
            <input
              className="mono"
              value={draft.goZenonRepo}
              onChange={(event) => setDraft({ ...draft, goZenonRepo: event.target.value })}
            />
          </label>
          <label>
            <span>go-zenon Ref</span>
            <input
              className="mono"
              value={draft.goZenonRef}
              onChange={(event) => setDraft({ ...draft, goZenonRef: event.target.value })}
            />
          </label>
          <label>
            <span>go-zenon Commit</span>
            <input
              className="mono"
              value={draft.goZenonCommit ?? ""}
              onChange={(event) => setDraft({ ...draft, goZenonCommit: event.target.value })}
              placeholder="optional"
            />
          </label>
          <label>
            <span>Deployment Ref</span>
            <input
              className="mono"
              value={draft.deploymentRef}
              onChange={(event) => setDraft({ ...draft, deploymentRef: event.target.value })}
            />
          </label>
        </div>
        <label>
          <span>Deployment Repo</span>
          <input
            className="mono"
            value={draft.deploymentRepo}
            onChange={(event) => setDraft({ ...draft, deploymentRepo: event.target.value })}
          />
        </label>
        <label>
          <span>Apply Release At (UTC)</span>
          <input
            className="mono"
            type="datetime-local"
            value={toUtcDateTimeInput(draft.releaseApplyAtSec)}
            onChange={(event) => setDraft({ ...draft, releaseApplyAtSec: fromUtcDateTimeInput(event.target.value) })}
          />
        </label>
        <div className="toolbar compactToolbar">
          <Button variant="secondary" onClick={() => setDraft({ ...draft, releaseApplyAtSec: utcSecondsFromNow(30) })}>
            Apply +30m
          </Button>
          <Button variant="secondary" onClick={() => setDraft({ ...draft, releaseApplyAtSec: utcSecondsFromNow(60) })}>
            Apply +60m
          </Button>
          <Button variant="ghost" onClick={() => setDraft({ ...draft, releaseApplyAtSec: undefined })}>
            Clear
          </Button>
        </div>
        <label className="checkboxRow">
          <input
            type="checkbox"
            checked={draft.wipeDataOnPublish}
            onChange={(event) => setDraft({ ...draft, wipeDataOnPublish: event.target.checked })}
          />
          <span>Wipe node data on next Publish Release</span>
        </label>
      </div>
      <div className="seedProbe">
        <div className="panelHeader">
          <div>
            <span className="ledger">External Seeder</span>
            <h2>RPC Probe</h2>
          </div>
        </div>
        <div className="seedProbeGrid">
          <label>
            <span>Seeder IP</span>
            <input className="mono" value={seedIp} onChange={(event) => setSeedIp(event.target.value)} placeholder="203.0.113.10" />
          </label>
          <label>
            <span>RPC Port</span>
            <input
              className="mono"
              type="number"
              min={1}
              max={65535}
              value={seedRpcPort}
              onChange={(event) => setSeedRpcPort(Number(event.target.value))}
            />
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
        <div className="toolbar">
          <Button variant="secondary" icon={<Search size={18} />} onClick={probeSeed} disabled={probing}>
            {probing ? "Probing" : "Probe External Seed"}
          </Button>
        </div>
        {seedResult ? (
          <button className="seedResult mono" type="button" onClick={() => copy(seedResult)} title="Copy enode">
            {seedResult}
          </button>
        ) : null}
      </div>
      <label>
        <span>Seeders</span>
        <textarea
          value={draft.seeders.join("\n")}
          onChange={(event) => setDraft({ ...draft, seeders: event.target.value.split("\n").map((line) => line.trim()) })}
          rows={4}
        />
      </label>
      {error ? <div className="alert">{error}</div> : null}
      <Button type="submit" icon={<Save size={18} />} disabled={saving}>
        {saving ? "Saving" : "Save Settings"}
      </Button>
    </form>
  );
}

function AdminView({ session, refresh }: { session: AdminOverview; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState<"genesis" | "config">("genesis");
  const json = useMemo(() => JSON.stringify(tab === "genesis" ? session.genesis : session.configTemplate, null, 2), [session, tab]);
  const telemetryNodes: TelemetryNode[] = useMemo(
    () => [
      ...session.pillars.map((pillar) => ({
        id: pillar.id,
        name: pillar.pillarName,
        nodeType: "pillar" as const,
        nodeStatus: pillar.nodeStatus
      })),
      ...session.seedNodes.map((seedNode) => ({
        id: seedNode.id,
        name: seedNode.nodeName,
        nodeType: "seed" as const,
        nodeStatus: seedNode.nodeStatus
      }))
    ],
    [session.pillars, session.seedNodes]
  );
  const userById = useMemo(() => new Map(session.users.map((user) => [user.id, user])), [session.users]);
  const availableSeedNodeUsers = useMemo(
    () => session.users.filter((user) => user.role === "user" && !user.nodeName),
    [session.users]
  );
  const [adminError, setAdminError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [seedNodeInput, setSeedNodeInput] = useState<CreateSeedNodeInput>({
    userId: "",
    nodeName: "",
    publicIp: "",
    p2pPort: 35995
  });
  const [seedNodeBusy, setSeedNodeBusy] = useState(false);
  const [seedNodeError, setSeedNodeError] = useState("");
  const [generatedSeedEnode, setGeneratedSeedEnode] = useState("");

  async function saveSettings(settings: PublicNetworkSettings) {
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        chainIdentifier: settings.chainIdentifier,
        extraData: settings.extraData,
        expectedPillars: settings.expectedPillars,
        minPillars: settings.minPillars,
        genesisTimestampSec: settings.genesisTimestampSec,
        releaseApplyAtSec: settings.releaseApplyAtSec,
        goZenonRepo: settings.goZenonRepo,
        goZenonRef: settings.goZenonRef,
        goZenonCommit: settings.goZenonCommit,
        deploymentRepo: settings.deploymentRepo,
        deploymentRef: settings.deploymentRef,
        wipeDataOnPublish: settings.wipeDataOnPublish,
        seeders: settings.seeders,
        sporks: settings.sporks
      })
    });
    await refresh();
  }

  async function probeSeed(seed: ProbeSeedInput) {
    const result = await api<{ seed: SeedNodeProbeResult; settings: PublicNetworkSettings }>("/api/admin/seeders/probe", {
      method: "POST",
      body: JSON.stringify(seed)
    });
    await refresh();
    return result;
  }

  async function createUser(input: CreateUserInput) {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(input)
    });
    await refresh();
  }

  async function resetUserPassword(userId: string, password: string) {
    await api(`/api/admin/users/${userId}/password`, {
      method: "PUT",
      body: JSON.stringify({ password })
    });
    await refresh();
  }

  async function deleteUser(user: ManagedUser) {
    await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
    await refresh();
  }

  async function deletePillar(pillar: PublicPillar) {
    if (!window.confirm(`Delete pillar ${pillar.pillarName}?`)) return;
    setAdminError("");
    try {
      await api(`/api/admin/pillars/${pillar.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function createManagedSeedNode(event: FormEvent) {
    event.preventDefault();
    setSeedNodeBusy(true);
    setSeedNodeError("");
    setGeneratedSeedEnode("");
    try {
      const result = await api<{ seedNode: PublicSeedNode; settings: PublicNetworkSettings }>("/api/admin/seed-nodes", {
        method: "POST",
        body: JSON.stringify(seedNodeInput)
      });
      setGeneratedSeedEnode(result.seedNode.enode);
      setSeedNodeInput({
        userId: "",
        nodeName: "",
        publicIp: "",
        p2pPort: 35995
      });
      await refresh();
    } catch (err) {
      setSeedNodeError((err as Error).message);
    } finally {
      setSeedNodeBusy(false);
    }
  }

  async function deleteSeedNode(seedNode: PublicSeedNode) {
    if (!window.confirm(`Delete seed node ${seedNode.nodeName}?`)) return;
    setAdminError("");
    try {
      await api(`/api/admin/seed-nodes/${seedNode.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function finalize() {
    await api("/api/admin/finalize", { method: "POST" });
    await refresh();
  }

  async function publish() {
    setPublishing(true);
    setAdminError("");
    try {
      await api("/api/admin/publish", { method: "POST" });
      await refresh();
    } catch (err) {
      setAdminError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="adminLayout">
      <section className="sectionTitle wide">
        <span className="ledger">Admin</span>
        <h1>Genesis Control</h1>
      </section>
      <StatusGrid readiness={session.readiness} />
      {adminError ? <div className="alert wide">{adminError}</div> : null}
      <UserManagement
        users={session.users}
        currentUser={session.user}
        onCreate={createUser}
        onResetPassword={resetUserPassword}
        onDeleteUser={deleteUser}
      />
      <NodeStatusPanel nodes={telemetryNodes} refresh={refresh} />
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <span className="ledger">Pillars</span>
            <h2>{session.pillars.length} Registered</h2>
          </div>
          <div className="toolbar">
            <Button variant="secondary" icon={<RefreshCcw size={18} />} onClick={refresh}>
              Refresh
            </Button>
            <Button variant="secondary" icon={<KeyRound size={18} />} onClick={() => download("/api/admin/spork-package.zip")}>
              Spork Wallet
            </Button>
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Pillar</th>
                <th>Reward</th>
                <th>Producer</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {session.pillars.map((pillar: PublicPillar) => (
                <tr key={pillar.id}>
                  <td>{pillar.pillarName}</td>
                  <td>
                    <AddressValue value={pillar.pillarAddress} />
                  </td>
                  <td>
                    <AddressValue value={pillar.rewardAddress} />
                  </td>
                  <td>
                    <AddressValue value={pillar.producerAddress} />
                  </td>
                  <td className="mono">{new Date(pillar.createdAt).toLocaleString()}</td>
                  <td>
                    <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => deletePillar(pillar)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel wide">
        <div className="panelHeader">
          <div>
            <span className="ledger">Seed Nodes</span>
            <h2>{session.seedNodes.length} Managed</h2>
          </div>
          <Button variant="secondary" icon={<RefreshCcw size={18} />} onClick={refresh}>
            Refresh
          </Button>
        </div>
        <form className="seedCreateGrid" onSubmit={createManagedSeedNode}>
          <label>
            <span>Operator Login</span>
            <select
              value={seedNodeInput.userId}
              onChange={(event) => setSeedNodeInput({ ...seedNodeInput, userId: event.target.value })}
              disabled={!availableSeedNodeUsers.length}
            >
              <option value="">{availableSeedNodeUsers.length ? "Select user" : "No unused operator users"}</option>
              {availableSeedNodeUsers.map((user) => (
                <option value={user.id} key={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Seed Node Name</span>
            <input value={seedNodeInput.nodeName} onChange={(event) => setSeedNodeInput({ ...seedNodeInput, nodeName: event.target.value })} />
          </label>
          <label>
            <span>Public IP</span>
            <input
              className="mono"
              value={seedNodeInput.publicIp}
              onChange={(event) => setSeedNodeInput({ ...seedNodeInput, publicIp: event.target.value })}
              placeholder="203.0.113.10"
            />
          </label>
          <label>
            <span>P2P Port</span>
            <input
              className="mono"
              type="number"
              min={1}
              max={65535}
              value={seedNodeInput.p2pPort}
              onChange={(event) => setSeedNodeInput({ ...seedNodeInput, p2pPort: Number(event.target.value) })}
            />
          </label>
          <Button type="submit" icon={<Server size={18} />} disabled={seedNodeBusy || !availableSeedNodeUsers.length}>
            {seedNodeBusy ? "Generating" : "Generate Enode"}
          </Button>
        </form>
        {seedNodeError ? <div className="alert">{seedNodeError}</div> : null}
        {generatedSeedEnode ? (
          <button className="seedResult mono" type="button" onClick={() => copy(generatedSeedEnode)} title="Copy generated enode">
            {generatedSeedEnode}
          </button>
        ) : null}
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Operator</th>
                <th>IP</th>
                <th>P2P</th>
                <th>Public Key</th>
                <th>Enode</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {session.seedNodes.map((seedNode) => (
                <tr key={seedNode.id}>
                  <td>{seedNode.nodeName}</td>
                  <td>{userById.get(seedNode.userId)?.username ?? <span className="mutedText">Unknown</span>}</td>
                  <td className="mono">{seedNode.publicIp}</td>
                  <td className="mono">{seedNode.p2pPort}</td>
                  <td>
                    <AddressValue value={seedNode.publicKey} />
                  </td>
                  <td>
                    <AddressValue value={seedNode.enode} />
                  </td>
                  <td className="mono">{new Date(seedNode.createdAt).toLocaleString()}</td>
                  <td>
                    <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => deleteSeedNode(seedNode)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <SettingsForm settings={session.settings} onSave={saveSettings} onProbeSeed={probeSeed} />
      <section className="panel jsonPanel">
        <div className="panelHeader">
          <div className="tabs">
            <button className={tab === "genesis" ? "active" : ""} type="button" onClick={() => setTab("genesis")}>
              genesis.json
            </button>
            <button className={tab === "config" ? "active" : ""} type="button" onClick={() => setTab("config")}>
              config.json
            </button>
          </div>
          <div className="toolbar">
            <Button variant="secondary" icon={<FileJson size={18} />} onClick={() => download("/api/admin/genesis.json")}>
              Genesis
            </Button>
            <Button variant="secondary" icon={<FileJson size={18} />} onClick={() => download("/api/admin/config-template.json")}>
              Config
            </Button>
            <Button icon={<CheckCircle2 size={18} />} onClick={finalize}>
              Finalize
            </Button>
            <Button icon={<Server size={18} />} onClick={publish} disabled={publishing}>
              {publishing ? "Publishing" : "Publish Release"}
            </Button>
          </div>
        </div>
        {session.finalizedAt ? <div className="successLine">Finalized {new Date(session.finalizedAt).toLocaleString()}</div> : null}
        {session.published ? <PublishedArtifacts published={session.published} /> : null}
        <pre>{json}</pre>
      </section>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const current = session?.user.role === "admin" ? await api<AdminOverview>("/api/admin/overview") : await api<UserOverview>("/api/me");
    setSession(current);
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

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setSession(null);
  }

  if (loading) return <div className="loading">Loading</div>;
  if (!session) return <Login onLogin={setSession} />;

  return (
    <Shell user={session.user} onLogout={logout}>
      {session.user.role === "admin" ? (
        <AdminView session={session as AdminOverview} refresh={refresh} />
      ) : (
        <OperatorView session={session as UserOverview} refresh={refresh} />
      )}
    </Shell>
  );
}
