import type { NextFunction, Request, Response } from "express";
import { randomId, sha256, verifyPassword } from "./crypto.js";
import { readState, updateState } from "./storage.js";
import type { AuthUser, Role, StoredSession, StoredUser } from "../shared/types.js";

const SESSION_COOKIE = "zenon_session";
const SESSION_DAYS = 7;

export interface AuthedRequest extends Request {
  user: AuthUser;
}

export function publicUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
}

export async function login(username: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
  const state = await readState();
  const user = state.users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());
  if (!user) return null;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  const token = randomId(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await updateState((draft) => {
    draft.sessions = draft.sessions.filter((session) => new Date(session.expiresAt) > now);
    draft.sessions.push({
      tokenHash: sha256(token),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
  });

  return { token, user: publicUser(user) };
}

export async function logout(token?: string): Promise<void> {
  if (!token) return;
  const tokenHash = sha256(token);
  await updateState((draft) => {
    draft.sessions = draft.sessions.filter((session) => session.tokenHash !== tokenHash);
  });
}

export async function currentUser(token?: string): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = sha256(token);
  const now = new Date();
  const state = await readState();
  const session = state.sessions.find((candidate: StoredSession) => candidate.tokenHash === tokenHash);
  if (!session || new Date(session.expiresAt) <= now) return null;

  const user = state.users.find((candidate) => candidate.id === session.userId);
  return user ? publicUser(user) : null;
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function requireAuth(role?: Role) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const user = await currentUser(request.cookies?.[SESSION_COOKIE]);
    if (!user) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (role && user.role !== role) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    (request as AuthedRequest).user = user;
    next();
  };
}

export function sessionTokenFromRequest(request: Request): string | undefined {
  return request.cookies?.[SESSION_COOKIE];
}
