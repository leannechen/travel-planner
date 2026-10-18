import { keysOf, shortcutKeys, withShortcut, type Shortcut } from "@travel-planner/shared";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Tooltip text and key names for this computer ("Ctrl+Option+N" on a Mac).
export const tip = (label: string, id: string) => withShortcut(label, id, isMac);
// The keys of one shortcut for this computer, for a hint next to a button.
export const keyOf = (id: string) => shortcutKeys(id, isMac);
export const keysFor = (shortcut: Shortcut) => keysOf(shortcut, isMac);
