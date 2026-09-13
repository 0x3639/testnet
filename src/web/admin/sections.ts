export const SECTION_IDS = ["status", "launch", "users", "nodes", "network", "release"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  status: "Status",
  launch: "Launch Ops",
  users: "Users",
  nodes: "Nodes",
  network: "Network",
  release: "Release"
};

export function parseSection(hash: string, fallback: SectionId): SectionId {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  return (SECTION_IDS as readonly string[]).includes(value) ? (value as SectionId) : fallback;
}

export function defaultSection(published: boolean): SectionId {
  return published ? "status" : "launch";
}
