import { Copy, KeyRound, Trash2, UserPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import type { AuthUser, ManagedUser, Role } from "../../shared/types";
import { copy, generatePassword, loginUrl } from "../shared/format";
import { Button } from "../shared/ui";
import { SectionHeader } from "./SectionHeader";
import { Tooltip } from "./Tooltip";
import { TIPS } from "./tooltips";

export interface CreateUserInput {
  username: string;
  password: string;
  role: Role;
}

export interface CreatedCredential {
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

export function UsersSection({
  users,
  currentUser,
  createdCredential,
  onCredentialChange,
  onCreate,
  onResetPassword,
  onDeleteUser
}: {
  users: ManagedUser[];
  currentUser: AuthUser;
  createdCredential: CreatedCredential | null;
  onCredentialChange: (credential: CreatedCredential | null) => void;
  onCreate: (input: CreateUserInput) => Promise<void>;
  onResetPassword: (userId: string, password: string) => Promise<void>;
  onDeleteUser: (user: ManagedUser) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [resetOpenFor, setResetOpenFor] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
    setSuccess("");
    try {
      const createdUsername = username;
      const createdPassword = password;
      await onCreate({ username, password, role });
      setSuccess(`Created ${createdUsername}`);
      onCredentialChange({
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
      setResetOpenFor(null);
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
    <>
      <SectionHeader
        title="Users"
        description="One login per pillar or seed node operator. They sign in to register their node and download their package."
      />
      <section className="panel">
        <div className="panelHeader">
          <div>
            <span className="ledger">Access</span>
            <h2>Add a login<Tooltip text={TIPS["users.add"]} /></h2>
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
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
              <Button variant="secondary" icon={<KeyRound size={18} />} onClick={fillGeneratedPassword}>
                Generate
              </Button>
            </div>
          </label>
          <label>
            <span>Role<Tooltip text={TIPS["users.role"]} /></span>
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
            <div className="toolbar compactToolbar">
              <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(credentialText(createdCredential))}>
                Copy Login
              </Button>
              <Button variant="ghost" onClick={() => onCredentialChange(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
        <div className="tableCaption mono mutedText">
          {users.length} login{users.length === 1 ? "" : "s"}
        </div>
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
                    {resetOpenFor === user.id ? (
                      <form className="resetPasswordForm" onSubmit={(event) => resetPassword(event, user)}>
                        <input
                          type="password"
                          value={resetPasswords[user.id] ?? ""}
                          onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                          autoComplete="new-password"
                          placeholder="New password"
                        />
                        <Button type="submit" variant="secondary" icon={<KeyRound size={18} />} disabled={busy === user.id}>
                          {busy === user.id ? "Saving" : "Reset"}
                        </Button>
                      </form>
                    ) : (
                      <Button variant="secondary" icon={<KeyRound size={18} />} onClick={() => setResetOpenFor(user.id)}>
                        Reset password
                      </Button>
                    )}
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
    </>
  );
}
