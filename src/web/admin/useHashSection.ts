import { useCallback, useEffect, useState } from "react";
import { parseSection, type SectionId } from "./sections";

/** The active admin section, kept in window.location.hash so reloads and links preserve it. */
export function useHashSection(fallback: SectionId): [SectionId, (section: SectionId) => void] {
  const [section, setSectionState] = useState<SectionId>(() => parseSection(window.location.hash, fallback));

  useEffect(() => {
    const onHashChange = () => setSectionState(parseSection(window.location.hash, fallback));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [fallback]);

  const setSection = useCallback((next: SectionId) => {
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setSectionState(next);
  }, []);

  return [section, setSection];
}
