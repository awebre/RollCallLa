import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useSession } from "../SessionContext";
import { useDebug } from "../debug/DebugContext";

export type AgendaCategory =
  | "final_passage"
  | "concurrence"
  | "second_reading"
  | "introduction"
  | "deferred"
  | "other";

export type AgendaItem = {
  bill_number: string;
  author: string;
  subject: string;
  status: "future" | "current" | "past";
  category: AgendaCategory;
};

export type AgendaResult = {
  chamber: "H" | "S";
  date: string | null;
  time: string | null;
  location: string | null;
  items: AgendaItem[];
  in_progress: boolean;
  adjourned: boolean;
  fetched_at: string;
  ok: boolean;
  error?: string;
};

const WINDOW = 10; // visible rows at a time
const PAGE   = 5;  // rows revealed per expand click
const CONTEXT = 3; // past rows to show above the current item initially

/** Compute the initial visible window centred on the current (or boundary) item.
 *  When no item is current (gap between votes), show the last-past/first-future
 *  boundary so the view stays at the action rather than jumping to the start. */
function initialWindow(items: AgendaItem[]): { start: number; end: number } {
  const currentIdx = items.findIndex((i) => i.status === "current");
  let pivot: number;
  if (currentIdx >= 0) {
    pivot = currentIdx;
  } else {
    // Find the boundary: first future item, falling back to just after the last past.
    const firstFuture = items.findIndex((i) => i.status === "future");
    if (firstFuture >= 0) {
      pivot = firstFuture;
    } else {
      // All past or all future — show end/start respectively.
      pivot = items.length - 1;
    }
  }
  return {
    start: Math.max(0, pivot - CONTEXT),
    end:   Math.min(items.length, pivot - CONTEXT + WINDOW),
  };
}

// ── Shared data-fetching hook ─────────────────────────────────────────────────

const POLL_MS_LIVE = 1  * 60 * 1000; // 1 min  — matches server TTL when in_progress
const POLL_MS_IDLE = 30 * 60 * 1000; // 30 min — matches server TTL when idle

export function useAgendaData(chamber: "H" | "S") {
  const { getOverride } = useDebug();
  const [agenda, setAgenda]           = useState<AgendaResult | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refetchKey, setRefetchKey]   = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);

  // getOverride returns null until admin status is confirmed, then the real
  // value. Re-running the effect when it changes handles both directions.
  const debugAgenda = getOverride<AgendaResult>("agenda");

  // Main fetch — re-runs on chamber change, debug override, or poll tick.
  useEffect(() => {
    if (debugAgenda) {
      setAgenda(debugAgenda);
      setLoading(false);
      return;
    }

    // Cancel the fetch if the effect re-runs (e.g. debug override becomes active
    // while the request is in-flight, preventing real data from clobbering mock).
    let cancelled = false;
    setLoading(true);
    fetch(`/api/agenda/${chamber}`)
      .then((r) => r.json() as Promise<AgendaResult>)
      .then((d) => { if (!cancelled) setAgenda(d); })
      .catch(() => { if (!cancelled) setAgenda(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chamber, debugAgenda, refetchKey]);

  // Polling: schedule a re-fetch every 5 min while the session is live.
  // Stops automatically when all items are past or there's no agenda.
  // Pauses when the tab is hidden; fires immediately on visibility restore.
  useEffect(() => {
    if (debugAgenda) return;
    if (!agenda?.ok || agenda.items.length === 0) return;
    if (agenda.items.every((i) => i.status === "past")) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let visHandler: (() => void) | null = null;

    const triggerRefetch = () => {
      setNextRefreshAt(null);
      setRefetchKey((k) => k + 1);
    };

    const pollMs = agenda.in_progress ? POLL_MS_LIVE : POLL_MS_IDLE;
    setNextRefreshAt(Date.now() + pollMs);
    timeoutId = setTimeout(() => {
      if (document.visibilityState === "hidden") {
        // Tab hidden — defer until it becomes visible again.
        visHandler = () => {
          if (document.visibilityState !== "hidden") {
            document.removeEventListener("visibilitychange", visHandler!);
            visHandler = null;
            triggerRefetch();
          }
        };
        document.addEventListener("visibilitychange", visHandler);
      } else {
        triggerRefetch();
      }
    }, pollMs);

    return () => {
      clearTimeout(timeoutId);
      if (visHandler) document.removeEventListener("visibilitychange", visHandler);
      setNextRefreshAt(null);
    };
  }, [agenda, debugAgenda]);

  return { agenda, loading, nextRefreshAt };
}

function refreshLabel(nextRefreshAt: number | null, inProgress?: boolean): string {
  if (!nextRefreshAt) return inProgress ? "refreshed every 1 min" : "refreshed every 30 min";
  const msLeft = nextRefreshAt - Date.now();
  if (msLeft <= 0) return "refreshing…";
  const secLeft = Math.ceil(msLeft / 1_000);
  if (secLeft < 60) return `refreshes in ${secLeft}s`;
  return `refreshes in ${Math.ceil(secLeft / 60)} min`;
}

// ── Panel (embedded in legislator detail) ────────────────────────────────────

const VOTE_CATEGORIES: AgendaCategory[] = ["final_passage", "concurrence"];

export function ChamberAgenda({ chamber, showEmpty }: { chamber: "H" | "S"; showEmpty?: boolean }) {
  const { current }                          = useSession();
  const { agenda, loading, nextRefreshAt }   = useAgendaData(chamber);
  const [showAll, setShowAll]                = useState(false);

  // Re-render every 30 s so the countdown stays roughly accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!nextRefreshAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [nextRefreshAt]);

  const [visibleStart, setVisibleStart] = useState(0);
  const [visibleEnd,   setVisibleEnd]   = useState(WINDOW);

  // Tracks which direction we just expanded so we can scroll accordingly
  const pendingScroll = useRef<"top" | "bottom" | null>(null);
  const scrollRef     = useRef<HTMLDivElement>(null);

  // Reset window when agenda data arrives or changes
  useEffect(() => {
    // Compute the window against the filtered list so slicing is always in-bounds.
    const all  = agenda?.items ?? [];
    const vote = all.filter((i) => VOTE_CATEGORIES.includes(i.category));
    const target = showAll ? all : (vote.length > 0 ? vote : all);
    if (!target.length) return;
    const { start, end } = initialWindow(target);
    setVisibleStart(start);
    setVisibleEnd(end);
  }, [agenda, showAll]);

  // Scroll after a window expansion
  useEffect(() => {
    if (!pendingScroll.current || !scrollRef.current) return;
    if (pendingScroll.current === "top") {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
    pendingScroll.current = null;
  });

  if (loading && !agenda) {
    return (
      <div className="border border-(--app-border-light) bg-(--app-surface) px-4 py-3">
        <p className="text-[0.85rem] text-(--app-text-muted)">Loading floor agenda…</p>
      </div>
    );
  }

  if (!agenda || !agenda.ok || agenda.items.length === 0) {
    if (!showEmpty) return null;
    const emptyMsg = !agenda || !agenda.ok
      ? (agenda?.error ?? "Could not load agenda.")
      : `The ${chamber === "H" ? "House" : "Senate"} isn't in floor session today.`;
    return (
      <div className="border border-(--app-border-light) bg-(--app-surface) px-4 py-3">
        <p className="text-[0.85rem] text-(--app-text-muted)">{emptyMsg}</p>
      </div>
    );
  }

  const sessionName = current?.name ?? null;
  const chamberName = chamber === "H" ? "House" : "Senate";

  // Filter to vote-relevant items unless the user expanded to show all.
  const allItems      = agenda.items;
  const voteItems     = allItems.filter((i) => VOTE_CATEGORIES.includes(i.category));
  const items         = showAll ? allItems : (voteItems.length > 0 ? voteItems : allItems);
  const hiddenCount   = allItems.length - voteItems.length;

  const pastCount   = items.filter((i) => i.status === "past").length;
  const futureCount = items.filter((i) => i.status === "future").length;

  const beforeCount = visibleStart;
  const afterCount  = items.length - visibleEnd;
  const visible     = items.slice(visibleStart, visibleEnd);

  function expandUp() {
    pendingScroll.current = "top";
    setVisibleStart(Math.max(0, visibleStart - PAGE));
  }

  function expandDown() {
    pendingScroll.current = "bottom";
    setVisibleEnd(Math.min(items.length, visibleEnd + PAGE));
  }

  return (
    <div className="border border-(--app-border-light) bg-(--app-surface)">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-(--app-border-light) bg-(--app-surface-warm) px-4 py-2.5">
        <span className="font-semibold text-[0.9rem]">{chamberName} Floor Agenda</span>
        {agenda.in_progress && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-(--vote-yea)"
            style={{ backgroundColor: "color-mix(in srgb, var(--vote-yea) 12%, transparent)" }}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--vote-yea)" />
            Live
          </span>
        )}
        {!agenda.in_progress && !agenda.adjourned && agenda.date && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-(--app-link-ext)"
            style={{ backgroundColor: "color-mix(in srgb, var(--app-link-ext) 10%, transparent)" }}
          >
            Scheduled
          </span>
        )}
        {agenda.adjourned && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-(--app-text-muted) border border-(--app-border-input)">
            Adjourned
          </span>
        )}
        {agenda.date && (
          <span className="font-mono text-[0.78rem] text-(--app-text-muted)">
            {agenda.date}{agenda.time ? ` · ${agenda.time}` : ""}
          </span>
        )}
        {agenda.location && (
          <span className="font-mono text-[0.78rem] text-(--app-text-muted)">{agenda.location}</span>
        )}
        <span className="ml-auto flex items-center gap-2 font-mono text-[0.72rem] text-(--app-text-subtle)">
          {pastCount > 0 && <span className="text-(--app-text-muted)">{pastCount} done · </span>}
          {futureCount} remaining
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="cursor-pointer rounded border border-(--app-border-input) bg-(--app-surface) px-1.5 py-0.5 font-sans text-[0.68rem] text-(--app-text-muted) hover:bg-(--app-surface-warm)"
            >
              {showAll ? "Votes only" : `+${hiddenCount} more`}
            </button>
          )}
        </span>
      </div>

      {/* Expand up */}
      {beforeCount > 0 && (
        <button
          onClick={expandUp}
          className="w-full cursor-pointer border-none border-b border-(--app-border-row) bg-transparent px-4 py-1.5 text-left text-[0.75rem] text-(--app-link) hover:bg-(--app-surface-warm)"
        >
          ↑ {beforeCount} earlier bill{beforeCount !== 1 ? "s" : ""}
        </button>
      )}

      {/* Scrollable bill list */}
      <div
        ref={scrollRef}
        className="max-h-72 overflow-y-auto divide-y divide-(--app-border-row)"
      >
        {visible.map((item) => (
          <AgendaRow key={item.bill_number} item={item} sessionName={sessionName} />
        ))}
      </div>

      {/* Expand down */}
      {afterCount > 0 && (
        <button
          onClick={expandDown}
          className="w-full cursor-pointer border-none border-t border-(--app-border-row) bg-transparent px-4 py-1.5 text-left text-[0.75rem] text-(--app-link) hover:bg-(--app-surface-warm)"
        >
          ↓ {afterCount} more bill{afterCount !== 1 ? "s" : ""}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-(--app-border-light) px-4 py-1.5">
        <Link
          href={`/agenda/${chamber}`}
          className="text-[0.75rem] text-(--app-link) underline"
        >
          View full agenda
        </Link>
        <span className="font-mono text-[0.72rem] text-(--app-text-subtle)">
          <a
            href={`https://legis.la.gov/legis/Agenda.aspx?c=${chamber}&g=BODY`}
            target="_blank"
            rel="noreferrer"
            className="text-(--app-link-ext)"
          >
            legis.la.gov
          </a>
          {" · "}{refreshLabel(nextRefreshAt, agenda.in_progress)}
        </span>
      </div>
    </div>
  );
}

// ── Shared row ────────────────────────────────────────────────────────────────

// Every category gets an explicit label — leaving final_passage unlabeled
// previously made it indistinguishable from "other" (the classifier's
// catchall), which is exactly the wrong UX.
const CATEGORY_LABEL: Record<AgendaCategory, string> = {
  final_passage:  "Final Passage",
  concurrence:    "Concurrence",
  second_reading: "2nd Reading",
  introduction:   "Introduction",
  deferred:       "Deferred",
  other:          "Other",
};

// Visual treatment per category, matching the bills page's pipeline_stage
// palette so the two views feel like one system. The badge tells you what's
// happening; the color tells you how decisive it is.
const CATEGORY_CLASS: Record<AgendaCategory, string> = {
  final_passage:  "text-(--vote-yea) font-semibold",      // the main event
  concurrence:    "text-(--vote-yea) font-semibold",      // also decisive
  second_reading: "text-(--app-text-mid)",                // floor activity but not the decision
  introduction:   "text-(--app-text-muted)",              // informational
  deferred:       "text-(--app-text-subtle) line-through",// stalled
  other:          "text-(--app-text-muted)",              // catchall
};

export function AgendaRow({
  item,
  sessionName,
  showCategory,
}: {
  item: AgendaItem;
  sessionName?: string | null;
  showCategory?: boolean;
}) {
  const isPast    = item.status === "past";
  const isCurrent = item.status === "current";

  const billLink = sessionName
    ? `https://legis.la.gov/legis/BillInfo.aspx?s=${sessionName}&b=${item.bill_number.replace(/\s+/g, "")}`
    : null;

  return (
    <div
      className={`flex items-baseline gap-x-2 px-4 py-[0.35rem] font-mono text-[0.82rem] ${
        isCurrent ? "bg-(--app-surface-warm)" : isPast ? "opacity-40" : ""
      }`}
    >
      {isCurrent && (
        <span className="shrink-0 text-[0.7rem] text-(--vote-yea)">▶</span>
      )}
      <span className={`shrink-0 font-semibold ${isPast ? "line-through" : ""}`}>
        {billLink ? (
          <a
            href={billLink}
            target="_blank"
            rel="noreferrer"
            className={isPast ? "text-(--app-text-muted)" : "text-(--app-link-ext)"}
          >
            {item.bill_number}
          </a>
        ) : (
          <span className="text-(--app-ink)">{item.bill_number}</span>
        )}
      </span>
      <span className="shrink-0 text-(--app-text-muted)">{item.author}</span>
      <span className="min-w-0 flex-1 truncate text-(--app-text-mid)">{item.subject}</span>
      {showCategory && (
        <span className={`shrink-0 font-sans text-[0.68rem] ${CATEGORY_CLASS[item.category]}`}>
          {CATEGORY_LABEL[item.category]}
        </span>
      )}
    </div>
  );
}
