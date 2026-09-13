import type React from "react";

export function SectionHeader({
  kicker,
  title,
  description,
  aside
}: {
  kicker?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <header className="sectionHeader">
      <div>
        {kicker ? <span className="ledger">{kicker}</span> : null}
        <h1>{title}</h1>
        {description ? <p className="sectionCopy">{description}</p> : null}
      </div>
      {aside ? <div className="sectionAside">{aside}</div> : null}
    </header>
  );
}
