import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useSession } from "../SessionContext";
import { useAgendaData, AgendaRow, type AgendaItem } from "../components/ChamberAgenda";
import { ChamberToggle } from "../components/ChamberToggle";

const WINDOW  = 25;
const PAGE    = 15;
const CONTEXT =  5;

function initialWindow(items: AgendaItem[]): { start: number; end: number } {
  const currentIdx = items.findIndex((i) => i.status === "current");
  let pivot: number;
  if (currentIdx >= 0) {
    pivot = currentIdx;
  } else {
    const firstFuture = items.findIndex((i) => i.status === "future");
    pivot = firstFuture >= 0 ? firstFuture : items.length - 1;
  }
  return {
    start: Math.max(0, pivot - CONTEXT),
    end:   Math.min(items.length, pivot - CONTEXT + WINDOW),
  };
}

export function AgendaView({ chamber }: { chamber: "H" | "S" }) {
  const [, navigate] = useLocation();
  const { current }  = useSession();
  const { agenda, loading, nextRefreshAt } = useAgendaData(chamber);
  const sessionName  = current?.name ?? null;
  const [q, setQ]    = useState("");

  // Countdown tick
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!nextRefreshAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [nextRefreshAt]);

  // Measure the list container so it fills from its top edge to the viewport bottom.
  const containerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState<number | null>(null);
  useEffect(() => {
    const compute = () => {
      if (!containerRef.current) return;
      const top = containerRef.current.getBoundingClientRect().top;
      setListHeight(Math.max(300, window.innerHeight - top - 24));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  // Recompute whenever the content above the list changes height.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenda, loading]);

  // Windowing state
  const [visibleStart, setVisibleStart] = useState(0);
  const [visibleEnd,   setVisibleEnd]   = useState(WINDOW);
  const pendingScroll = useRef<"top" | "bottom" | null>(null);
  const scrollRef     = useRef<HTMLDivElement>(null);

  // Compute filtered list (used in render AND effects below)
  const needle   = q.trim().toLowerCase();
  const allItems = agenda?.items ?? [];
  const filtered: AgendaItem[] = needle
    ? allItems.filter(
        (i) =>
          i.bill_number.toLowerCase().includes(needle) ||
          i.subject.toLowerCase().includes(needle) ||
          i.author.toLowerCase().includes(needle),
      )
    : allItems;

  // Reset window when agenda data or search query changes.
  useEffect(() => {
    if (!filtered.length) return;
    const { start, end } = initialWindow(filtered);
    setVisibleStart(start);
    setVisibleEnd(end);
  // filtered itself changes every render; depend on its inputs instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenda, q]);

  // Scroll after expand
  useEffect(() => {
    if (!pendingScroll.current || !scrollRef.current) return;
    if (pendingScroll.current === "top") {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
    pendingScroll.current = null;
  });

  const beforeCount = visibleStart;
  const afterCount  = filtered.length - visibleEnd;
  const visible     = filtered.slice(visibleStart, visibleEnd);

  function expandUp() {
    pendingScroll.current = "top";
    setVisibleStart(Math.max(0, visibleStart - PAGE));
  }
  function expandDown() {
    pendingScroll.current = "bottom";
    setVisibleEnd(Math.min(filtered.length, visibleEnd + PAGE));
  }

  return (
    <>
      <p className="mt-0 text-(--app-text-mid)">
        Today's floor session bills, updated every {agenda?.in_progress ? "1 min" : "30 min"}.
      </p>

      <div className="my-4 flex flex-wrap items-center gap-3">
        <ChamberToggle
          value={chamber}
          onChange={(c) => { navigate(`/agenda/${c}`); setQ(""); }}
        />
        <input
          type="search"
          placeholder="Bill # or subject…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-48 flex-1 border border-(--app-border-input) bg-(--app-surface) px-2 py-2 font-sans text-[0.9rem] text-(--app-ink)"
        />
      </div>

      {loading && !agenda ? (
        <p className="mt-6 text-(--app-text-muted)">Loading agenda…</p>
      ) : !agenda || !agenda.ok ? (
        <p className="mt-6 text-(--app-text-muted)">
          {agenda?.error ?? "Could not load agenda. The chamber may not be in session."}
        </p>
      ) : agenda.items.length === 0 ? (
        <p className="mt-6 text-(--app-text-muted)">No bills on the agenda today.</p>
      ) : (
        <>
          {/* Status bar */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="m-0 font-mono text-[0.85rem] text-(--app-text-muted)">
              {agenda.date}
              {agenda.time ? ` · ${agenda.time}` : ""}
              {agenda.location ? ` · ${agenda.location}` : ""}
              {" · "}
              {agenda.items.filter((i) => i.status === "past").length} done
              {" · "}
              {agenda.items.filter((i) => i.status === "future").length} remaining
            </p>
            {agenda.in_progress && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-(--vote-yea)"
                style={{ backgroundColor: "color-mix(in srgb, var(--vote-yea) 12%, transparent)" }}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--vote-yea)" />
                Live
              </span>
            )}
            {agenda.adjourned && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 font-sans text-[0.68rem] font-semibold uppercase tracking-wide text-(--app-text-muted) border border-(--app-border-input)">
                Adjourned
              </span>
            )}
          </div>

          {/* Viewport-filling windowed list */}
          <div ref={containerRef} className="mt-4 border border-(--app-border-light) bg-(--app-surface)">
            {/* Expand up */}
            {beforeCount > 0 && (
              <button
                onClick={expandUp}
                className="w-full cursor-pointer border-none border-b border-(--app-border-row) bg-transparent px-4 py-1.5 text-left text-[0.75rem] text-(--app-link) hover:bg-(--app-surface-warm)"
              >
                ↑ {beforeCount} earlier bill{beforeCount !== 1 ? "s" : ""}
              </button>
            )}

            {/* Scrollable list */}
            <div
              ref={scrollRef}
              className="overflow-y-auto divide-y divide-(--app-border-row)"
              style={listHeight ? { height: listHeight } : undefined}
            >
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-[0.85rem] text-(--app-text-muted)">
                  No bills match "{q.trim()}".
                </p>
              ) : (
                visible.map((item) => (
                  <AgendaRow key={item.bill_number} item={item} sessionName={sessionName} showCategory />
                ))
              )}
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
          </div>

          {/* Footer */}
          <p className="mt-2 text-[0.75rem] text-(--app-text-subtle)">
            {needle ? `${filtered.length} of ${agenda.items.length} bills` : `${agenda.items.length} bills`}
            {" · "}Source:{" "}
            <a
              href={`https://legis.la.gov/legis/Agenda.aspx?c=${chamber}&g=BODY`}
              target="_blank"
              rel="noreferrer"
              className="text-(--app-link-ext)"
            >
              legis.la.gov
            </a>
            {" · "}{nextRefreshAt
              ? (() => { const sec = Math.ceil((nextRefreshAt - Date.now()) / 1_000); return sec <= 0 ? "refreshing…" : sec < 60 ? `refreshes in ${sec}s` : `refreshes in ${Math.ceil(sec / 60)} min`; })()
              : agenda.in_progress ? "refreshed every 1 min" : "refreshed every 30 min"}
          </p>
        </>
      )}
    </>
  );
}
