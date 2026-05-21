import { useEffect, useState } from "react";
import { useSession } from "../SessionContext";
import { freshnessColor, relativeTime, STALE_HOURS } from "../freshness";

type StatusData = {
  counts: {
    bills: number;
    roll_calls: number;
    votes: number;
    active_legislators: number;
  };
  last_refresh: string | null;
  last_refresh_trigger: string | null;
};

// How often to recompute the "refreshed Xh ago" label. Tabs left open overnight
// would otherwise stay on a stale render of the threshold.
const TICK_MS = 5 * 60 * 1000;

export function Status() {
  const { current } = useSession();
  const [data, setData] = useState<StatusData | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const url = current
      ? `/api/status?session_id=${current.id}`
      : "/api/status";
    fetch(url)
      .then((r) => r.json() as Promise<StatusData>)
      .then(setData);
  }, [current?.id]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (!data) return null;
  const { bills, roll_calls, votes, active_legislators } = data.counts;
  const legLabel = current ? "legislators who voted" : "legislators";

  let refreshNode = null;
  if (data.last_refresh) {
    const { label, hoursAgo } = relativeTime(data.last_refresh);
    const stale = hoursAgo >= STALE_HOURS;
    refreshNode = (
      <>
        {" · "}
        <span
          title={`Data refreshed ${data.last_refresh} UTC${data.last_refresh_trigger ? ` (${data.last_refresh_trigger})` : ""}`}
          className="font-semibold"
          style={{ color: freshnessColor(hoursAgo) }}
        >
          refreshed {label}
          {stale ? " (stale)" : ""}
        </span>
      </>
    );
  }

  return (
    <p className="mt-1 text-[0.85rem] text-(--app-text-muted) font-mono">
      {active_legislators.toLocaleString()} {legLabel} ·{" "}
      {bills.toLocaleString()} bills · {roll_calls.toLocaleString()} roll calls
      · {votes.toLocaleString()} votes
      {refreshNode}
    </p>
  );
}
