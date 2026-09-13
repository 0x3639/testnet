import { LogOut, Server } from "lucide-react";
import type { AuthUser } from "../../shared/types";
import { SECTION_IDS, SECTION_LABELS, type SectionId } from "./sections";

export function Sidebar({
  user,
  section,
  onNavigate,
  badges,
  onLogout
}: {
  user: AuthUser;
  section: SectionId;
  onNavigate: (section: SectionId) => void;
  badges: Partial<Record<SectionId, string>>;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar adminSidebar">
      <div className="brand">
        <div className="logoBox">
          <Server size={22} />
        </div>
        <div>
          <strong>NoM Testnet</strong>
          <span>Admin console</span>
        </div>
      </div>
      <nav className="sideNav" aria-label="Admin sections">
        {SECTION_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`sideNavItem${section === id ? " active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-current={section === id ? "page" : undefined}
          >
            <span>{SECTION_LABELS[id]}</span>
            {badges[id] ? <span className="sideNavBadge">{badges[id]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="userBadge">
        <span>{user.username.slice(0, 2).toUpperCase()}</span>
        <div>
          <strong>{user.username}</strong>
          <small>Admin</small>
        </div>
        <button type="button" className="btn ghost iconOnly" onClick={onLogout} aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}
