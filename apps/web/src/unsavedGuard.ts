import { useRef, useState } from "react";
import type { PanelApi } from "./EventPanel";

// Leaving the Event panel (for another Event, a new one, or closing it) asks first when the panel
// has unsaved changes. `apply` does the leaving. `force` skips the question, for changes the user
// did not choose and for Cancel.
export function useUnsavedGuard<T>(apply: (next: T | undefined) => void) {
  // The open panel, which knows whether it has unsaved changes.
  const panelApi = useRef<PanelApi | undefined>(undefined);
  // Where the user was heading when the question came up.
  const [pending, setPending] = useState<{ next: T | undefined } | undefined>();
  // A save started from the question is running.
  const [busy, setBusy] = useState(false);

  function select(next: T | undefined, force = false) {
    if (force) {
      setPending(undefined);
      apply(next);
      return;
    }
    // One question at a time; while it is open, other ways of leaving wait for its answer.
    if (pending) return;
    if (panelApi.current?.isDirty()) {
      setPending({ next });
      return;
    }
    apply(next);
  }

  async function answer(save: boolean) {
    if (!pending || busy) return;
    if (save) {
      setBusy(true);
      // A panel that is already gone has nothing left to save.
      const saved = panelApi.current ? await panelApi.current.save() : true;
      setBusy(false);
      // A failed save leaves the panel open, with its error.
      if (!saved) {
        setPending(undefined);
        return;
      }
    }
    setPending(undefined);
    apply(pending.next);
  }

  return { panelApi, asking: pending !== undefined, busy, select, answer, keepEditing: () => !busy && setPending(undefined) };
}
