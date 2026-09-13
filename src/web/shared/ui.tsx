import { CheckCircle2, Copy, RefreshCcw } from "lucide-react";
import { useState } from "react";
import type { RefreshState } from "./api";
import { copy, shortAddress } from "./format";

export function AddressValue({ value }: { value: string }) {
  return (
    <button className="address" type="button" onClick={() => copy(value)} title={value} aria-label="Copy address">
      <span>{shortAddress(value)}</span>
      <Copy size={14} />
    </button>
  );
}

export function Button({
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

export function RefreshButton({ refresh, state }: { refresh: () => Promise<void>; state: RefreshState }) {
  const label =
    state === "refreshing" ? "Refreshing" : state === "updated" ? "Updated" : state === "error" ? "Failed" : "Refresh";
  return (
    <Button
      variant="secondary"
      icon={<RefreshCcw className={state === "refreshing" ? "spinIcon" : undefined} size={18} />}
      onClick={() => void refresh().catch(() => undefined)}
      disabled={state === "refreshing"}
    >
      {label}
    </Button>
  );
}

export function EndpointRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="endpointRow"
      type="button"
      onClick={() => {
        copy(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      aria-label={`Copy ${label} endpoint`}
    >
      <span className="endpointLabel">{label}</span>
      <span className="endpointUrl mono">{url}</span>
      <span className={`endpointCopy${copied ? " copied" : ""}`}>
        {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="statTile">
      <span className="ledger">{label}</span>
      <strong className="mono">{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}
