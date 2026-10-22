import type { GenerateTripInput, Generation } from "@travel-planner/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getGeneration, getGenerations, startGeneration } from "./api";

const POLL_MS = 2000;

export type TripGeneration = {
  // Generations left today; undefined until known.
  remaining: number | undefined;
  running: boolean;
  // Why the last generation failed, until another one starts.
  failure: Generation["failure"];
  // The prompt of the last generation started on this page, so it can be tried again.
  lastPrompt: string;
  // Rejects with the server's reason (ApiError) when it was not started.
  start: (input: GenerateTripInput) => Promise<void>;
  // Whether the Generate dialog is open: `onFinished` is told, so the page knows whether to open the
  // Trip at once or only say it is ready.
  setWatching: (watching: boolean) => void;
};

// Follows the user's AI generation (PRD §7) for the whole page, so it goes on when the dialog is
// closed. A generation started in another tab, or before a reload, is picked up too.
export function useTripGeneration(enabled: boolean, onFinished: (generation: Generation, watching: boolean) => void): TripGeneration {
  const [remaining, setRemaining] = useState<number | undefined>();
  const [runningId, setRunningId] = useState<string | undefined>();
  const [failure, setFailure] = useState<Generation["failure"]>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const watching = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const refresh = useCallback(async () => {
    const summary = await getGenerations();
    setRemaining(summary.remaining);
    setRunningId(summary.running?.id);
  }, []);

  useEffect(() => {
    // Logged out or the session ended: nothing more is followed.
    if (!enabled) {
      setRunningId(undefined);
      return;
    }
    refresh().catch(() => setRemaining(undefined));
  }, [enabled, refresh]);

  useEffect(() => {
    if (!runningId) return;
    let stopped = false;
    const timer = setInterval(() => {
      getGeneration(runningId).then(
        (generation) => {
          if (stopped || generation.status === "running") return;
          stopped = true;
          clearInterval(timer);
          setRunningId(undefined);
          if (generation.status === "failed") setFailure(generation.failure);
          finished.current(generation, watching.current);
          // Whether it counted depends on how it failed, so the server is asked again.
          void refresh().catch(() => undefined);
        },
        // A missed answer is tried again on the next tick, unless the generation is not the user's
        // to follow any more (gone, or the user is no longer logged in).
        (err: unknown) => {
          if (stopped || !(err instanceof ApiError) || !["login_required", "generation_not_found"].includes(err.code ?? "")) return;
          stopped = true;
          clearInterval(timer);
          setRunningId(undefined);
        },
      );
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runningId, refresh]);

  const start = useCallback(
    async (input: GenerateTripInput) => {
      setFailure(null);
      setLastPrompt(input.prompt);
      try {
        const generation = await startGeneration(input);
        setRunningId(generation.id);
        setRemaining((n) => (n === undefined ? n : Math.max(n - 1, 0)));
      } catch (err) {
        if (err instanceof ApiError && err.code === "daily_limit") setRemaining(0);
        // Another tab started one: follow that one.
        if (err instanceof ApiError && err.code === "generation_running") await refresh().catch(() => undefined);
        throw err;
      }
    },
    [refresh],
  );

  const setWatching = useCallback((value: boolean) => {
    watching.current = value;
  }, []);

  return { remaining, running: runningId !== undefined, failure, lastPrompt, start, setWatching };
}
