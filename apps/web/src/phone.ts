import { useEffect, useState } from "react";

// The width at which the workspace switches to the phone layout (keep in step with styles.css).
const QUERY = "(max-width: 40rem)";

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useIsPhone = () => useMatches(QUERY);

// Wide enough for the Trip list to stay open beside the Backlog, the Days and the Todos (keep in
// step with styles.css).
export const useRoomForPinnedList = () => useMatches("(min-width: 64rem)");
