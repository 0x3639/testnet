import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AdminOverview,
  ManagedUser,
  PublicNetworkSettings,
  PublicPillar,
  PublicSeedNode,
  SeedNodeProbeResult
} from "../../shared/types";
import { api, type RefreshState } from "../shared/api";
import { settingsKey } from "../shared/format";
import { LaunchBar } from "./LaunchBar";
import { LaunchOps } from "./LaunchOps";
import { NetworkSection, type ProbeSeedInput } from "./NetworkSection";
import { NodesSection, type CreateSeedNodeInput } from "./NodesSection";
import { evaluatePlaybook } from "./playbooks";
import { ReleaseSection } from "./ReleaseSection";
import { defaultSection, type SectionId } from "./sections";
import { Sidebar } from "./Sidebar";
import { StatusView } from "./StatusView";
import { nodeHealth, telemetryNodes } from "./telemetry";
import { useHashSection } from "./useHashSection";
import { usePlaybook } from "./usePlaybook";
import { UsersSection, type CreateUserInput } from "./UsersSection";

export function AdminApp({
  session,
  refresh,
  refreshState,
  onLogout
}: {
  session: AdminOverview;
  refresh: () => Promise<void>;
  refreshState: RefreshState;
  onLogout: () => void;
}) {
  const fallback = defaultSection(Boolean(session.published));
  const [section, setSection] = useHashSection(fallback);
  const nodes = useMemo(() => telemetryNodes(session), [session.pillars, session.seedNodes]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(Date.now());
  useEffect(() => setLastUpdatedAt(Date.now()), [session]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (section !== "status") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [section]);
  const [settingsDraft, setSettingsDraft] = useState(session.settings);
  const [settingsBase, setSettingsBase] = useState(session.settings);
  const settingsBaseRef = useRef(session.settings);
  const settingsDirty = useMemo(() => settingsKey(settingsDraft) !== settingsKey(settingsBase), [settingsDraft, settingsBase]);
  const [adminError, setAdminError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [playbook, setPlaybook] = usePlaybook();
  const evaluation = useMemo(
    () => evaluatePlaybook(playbook, { overview: session, draft: settingsDraft, settingsDirty }),
    [playbook, session, settingsDraft, settingsDirty]
  );

  useEffect(() => {
    const previousBase = settingsBaseRef.current;
    settingsBaseRef.current = session.settings;
    setSettingsBase(session.settings);
    setSettingsDraft((currentDraft) => (settingsKey(currentDraft) === settingsKey(previousBase) ? session.settings : currentDraft));
  }, [session.settings]);

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
        deploymentCommit: settings.deploymentCommit,
        wipeDataOnPublish: settings.wipeDataOnPublish,
        seeders: settings.seeders,
        bootstrapPeers: settings.bootstrapPeers,
        sporks: settings.sporks,
        genesisFunds: settings.genesisFunds
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

  async function createSeedNode(input: CreateSeedNodeInput): Promise<PublicSeedNode> {
    const result = await api<{ seedNode: PublicSeedNode; settings: PublicNetworkSettings }>("/api/admin/seed-nodes", {
      method: "POST",
      body: JSON.stringify(input)
    });
    // The node exists once the POST returns; a failed refresh must not discard its enode/multiaddr.
    // The 30-second poll corrects the overview.
    await refresh().catch(() => undefined);
    return result.seedNode;
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
    if (settingsDirty) {
      setAdminError("Save Settings before finalizing the genesis.");
      return;
    }
    setAdminError("");
    try {
      await api("/api/admin/finalize", { method: "POST" });
      await refresh();
    } catch (err) {
      setAdminError((err as Error).message);
    }
  }

  async function publish() {
    if (settingsDirty) {
      setAdminError("Save Settings before publishing a release.");
      return;
    }
    if (
      settingsDraft.wipeDataOnPublish &&
      !window.confirm(
        "Wipe node data on publish is ON. Every node will delete its chain data and restart from the new genesis. Publish anyway?"
      )
    ) {
      return;
    }
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

  const staleCount = nodes.filter((node) => nodeHealth(node).label === "Stale").length;
  const badges: Partial<Record<SectionId, string>> = {};
  if (staleCount) badges.nodes = `${staleCount} stale`;
  if (settingsDirty) badges.network = "draft";

  return (
    <div className="appShell adminShell">
      <Sidebar user={session.user} section={section} onNavigate={setSection} badges={badges} onLogout={onLogout} />
      <main className="content adminContent">
        <LaunchBar playbook={playbook} onPlaybookChange={setPlaybook} evaluation={evaluation} onNavigate={setSection} />
        {adminError ? <div className="alert">{adminError}</div> : null}
        {section === "status" ? (
          <StatusView
            overview={session}
            nodes={nodes}
            refresh={refresh}
            refreshState={refreshState}
            lastUpdatedAt={lastUpdatedAt}
            onNavigate={setSection}
          />
        ) : null}
        {section === "launch" ? (
          <LaunchOps overview={session} nodes={nodes} settingsDirty={settingsDirty} evaluation={evaluation} onNavigate={setSection} />
        ) : null}
        {section === "users" ? (
          <UsersSection
            users={session.users}
            currentUser={session.user}
            onCreate={createUser}
            onResetPassword={resetUserPassword}
            onDeleteUser={deleteUser}
          />
        ) : null}
        {section === "nodes" ? (
          <NodesSection
            overview={session}
            nodes={nodes}
            refresh={refresh}
            refreshState={refreshState}
            onDeletePillar={deletePillar}
            onDeleteSeedNode={deleteSeedNode}
            onCreateSeedNode={createSeedNode}
          />
        ) : null}
        {section === "network" ? (
          <NetworkSection
            draft={settingsDraft}
            setDraft={setSettingsDraft}
            settingsDirty={settingsDirty}
            repoPolicy={session.repoPolicy}
            onSave={saveSettings}
            onProbeSeed={probeSeed}
          />
        ) : null}
        {section === "release" ? (
          <ReleaseSection
            overview={session}
            settingsDirty={settingsDirty}
            wipeOnPublish={settingsDraft.wipeDataOnPublish}
            publishing={publishing}
            error=""
            onFinalize={finalize}
            onPublish={publish}
          />
        ) : null}
      </main>
    </div>
  );
}
