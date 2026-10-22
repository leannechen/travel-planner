import { useCallback, useState } from "react";

export type PanelName = "backlog" | "archive" | "todos";

const key = (panel: PanelName) => `travel-planner.collapsed.${panel}`;

function read(panel: PanelName) {
  try {
    return localStorage.getItem(key(panel)) === "1";
  } catch {
    return false;
  }
}

// Whether a desktop side panel is collapsed, kept per browser.
export function useCollapsed(panel: PanelName) {
  const [collapsed, setCollapsed] = useState(() => read(panel));
  const set = useCallback(
    (value: boolean) => {
      setCollapsed(value);
      try {
        localStorage.setItem(key(panel), value ? "1" : "0");
      } catch {
        // Without storage the panel is open again next time.
      }
    },
    [panel],
  );
  return [collapsed, set] as const;
}
