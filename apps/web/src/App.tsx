import { healthResponseSchema } from "@travel-planner/shared";
import { useEffect, useState } from "react";

export function App() {
  const [apiStatus, setApiStatus] = useState("checking…");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body) => setApiStatus(healthResponseSchema.parse(body).status))
      .catch(() => setApiStatus("unreachable"));
  }, []);

  return (
    <main>
      <h1>Travel Planner</h1>
      <p>API: {apiStatus}</p>
    </main>
  );
}
