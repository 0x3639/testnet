import type { AdminOverview, UserOverview } from "../../shared/types";

export type Session = UserOverview | AdminOverview;
export type RefreshState = "idle" | "refreshing" | "updated" | "error";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
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
