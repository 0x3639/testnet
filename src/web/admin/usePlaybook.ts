import { useCallback, useState } from "react";
import { parsePlaybookId, PLAYBOOK_STORAGE_KEY, type PlaybookId } from "./playbooks";

function readStored(): PlaybookId {
  try {
    return parsePlaybookId(window.localStorage.getItem(PLAYBOOK_STORAGE_KEY));
  } catch {
    return "launch";
  }
}

export function usePlaybook(): [PlaybookId, (id: PlaybookId) => void] {
  const [playbook, setPlaybookState] = useState<PlaybookId>(readStored);
  const setPlaybook = useCallback((id: PlaybookId) => {
    setPlaybookState(id);
    try {
      window.localStorage.setItem(PLAYBOOK_STORAGE_KEY, id);
    } catch {
      // storage unavailable; the choice just does not persist
    }
  }, []);
  return [playbook, setPlaybook];
}
