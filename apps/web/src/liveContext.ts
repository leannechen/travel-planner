import { createContext } from "react";

// The Events that someone else changed a moment ago (their cards light up briefly).
export const ChangedEventsContext = createContext<ReadonlySet<string>>(new Set());
