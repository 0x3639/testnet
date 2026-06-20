import { hashPassword, randomId, randomPassword } from "./crypto.js";
import { updateState } from "./storage.js";
import type { AuthUser, Role } from "../shared/types.js";

export async function createAccount(username: string, role: Role, password = randomPassword()): Promise<{ user: AuthUser; password: string }> {
  const normalized = username.trim();
  if (!normalized) throw new Error("Username is required");

  const passwordHash = await hashPassword(password);
  const user = await updateState((state) => {
    const exists = state.users.some((candidate) => candidate.username.toLowerCase() === normalized.toLowerCase());
    if (exists) throw new Error(`User '${normalized}' already exists`);

    const stored = {
      id: randomId(),
      username: normalized,
      role,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    state.users.push(stored);
    return {
      id: stored.id,
      username: stored.username,
      role: stored.role
    };
  });

  return { user, password };
}

export async function resetAccountPassword(userId: string, password: string, keepActiveSessionUserId?: string): Promise<AuthUser> {
  const passwordHash = await hashPassword(password);
  return updateState((state) => {
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) throw new Error("User not found");

    user.passwordHash = passwordHash;
    if (user.id !== keepActiveSessionUserId) {
      state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role
    };
  });
}
