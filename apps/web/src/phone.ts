import { useEffect, useState } from "react";

// The width at which the workspace switches to the phone layout (keep in step with styles.css).
const QUERY = "(max-width: 40rem)";

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const list = window.matchMedia(QUERY);
    const update = () => setPhone(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return phone;
}
