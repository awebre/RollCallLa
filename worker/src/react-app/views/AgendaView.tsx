import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useSession } from "../SessionContext";
import { useAgendaData, AgendaRow } from "../components/ChamberAgenda";
import { ChamberToggle } from "../components/ChamberToggle";

export function AgendaView({ chamber }: { chamber: "H" | "S" }) {
  const [, navigate] = useLocation();
  const { current } = useSession();
  const { agenda, loading, nextRefreshAt } = useAgendaData(chamber);
  const sessionName = current?.name ?? null;
  const [q, setQ] = useState("");

  // Re-render every 30 s so the countdown stays roughly accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!nextRefreshAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [nextRefreshAt]);

  return (
    <>
      <p className="mt-0 text-(--app-text-mid)">
        Today's floor session bills, updated every 5 minutes.
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

      {loading ? (
        <p className="mt-6 text-(--app-text-muted)">Loading agenda…</p>
      ) : !agenda || !agenda.ok ? (
        <p className="mt-6 text-(--app-text-muted)">
          {agenda?.error ?? "Could not load agenda. The chamber may not be in session."}
        </p>
      ) : agenda.items.length === 0 ? (
        <p className="mt-6 text-(--app-text-muted)">No bills on the agenda today.</p>
      ) : (
        <>
          <p className="mt-3 font-mono text-[0.85rem] text-(--app-text-muted)">
            {agenda.date}
            {agenda.time ? ` · ${agenda.time}` : ""}
            {agenda.location ? ` · ${agenda.location}` : ""}
            {" · "}
            {agenda.items.filter((i) => i.status === "past").length} done
            {" · "}
            {agenda.items.filter((i) => i.status === "future").length} remaining
          </p>

          {(() => {
            const needle = q.trim().toLowerCase();
            const filtered = needle
              ? agenda.items.filter(
                  (i) =>
                    i.bill_number.toLowerCase().includes(needle) ||
                    i.subject.toLowerCase().includes(needle) ||
                    i.author.toLowerCase().includes(needle),
                )
              : agenda.items;
            return (
              <>
                <div className="mt-4 border border-(--app-border-light) bg-(--app-surface)">
                  {filtered.length > 0 ? (
                    <div className="divide-y divide-(--app-border-row)">
                      {filtered.map((item) => (
                        <AgendaRow key={item.bill_number} item={item} sessionName={sessionName} />
                      ))}
                    </div>
                  ) : (
                    <p className="px-4 py-3 text-[0.85rem] text-(--app-text-muted)">
                      No bills match "{q.trim()}".
                    </p>
                  )}
                </div>
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
                    ? (() => { const ms = nextRefreshAt - Date.now(); return ms <= 0 ? "refreshing…" : `refreshes in ${Math.ceil(ms / 60_000)} min`; })()
                    : "refreshed every 5 min"}
                </p>
              </>
            );
          })()}
        </>
      )}
    </>
  );
}
