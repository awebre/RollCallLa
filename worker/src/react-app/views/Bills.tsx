import { useEffect, useState } from "react";
import type { Bill } from "../types";
import { useSession } from "../SessionContext";
import { ChamberToggle } from "../components/ChamberToggle";
import { BillInternalLink } from "../components/BillInternalLink";

// Vocabulary matches bills.pipeline_stage CHECK on the server.
const STAGE_OPTIONS: { value: Bill["pipeline_stage"]; label: string }[] = [
  { value: "introduced",  label: "Introduced" },
  { value: "committee",   label: "In committee" },
  { value: "floor",       label: "On floor" },
  { value: "concurrence", label: "Concurrence" },
  { value: "governor",    label: "On governor's desk" },
  { value: "enacted",     label: "Enacted" },
  { value: "dead",        label: "Dead" },
  { value: "other",       label: "Other" },
];

// Distinct types in scrape-bills.mjs BILL_TYPES — kept in sync by hand.
const TYPE_OPTIONS = ["HB", "HCR", "HCSR", "HR", "HSR", "SB", "SCR", "SR", "SSR"];

const STAGE_LABEL: Record<Bill["pipeline_stage"], string> = Object.fromEntries(
  STAGE_OPTIONS.map((s) => [s.value, s.label]),
) as Record<Bill["pipeline_stage"], string>;

// Visual treatment per stage. Subtle — bills in committee shouldn't shout.
const STAGE_CLASS: Record<Bill["pipeline_stage"], string> = {
  introduced:  "text-(--app-text-muted)",
  committee:   "text-(--app-text-mid)",
  floor:       "text-(--vote-yea) font-semibold",
  concurrence: "text-(--vote-yea) font-semibold",
  governor:    "text-(--app-link-ext) font-semibold",
  enacted:     "text-(--vote-yea)",
  dead:        "text-(--app-text-subtle) line-through",
  other:       "text-(--app-text-muted)",
};

const PAGE_SIZE = 50;

export function Bills() {
  const { current } = useSession();
  const sessionId = current?.id ?? null;

  const [bills, setBills] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [chamber, setChamber] = useState<"" | "H" | "S">("");
  const [type, setType] = useState<string>("");
  const [stage, setStage] = useState<Bill["pipeline_stage"] | "">("");
  const [nextChamber, setNextChamber] = useState<"" | "H" | "S">("");
  const [q, setQ] = useState("");

  // Reset to page 0 whenever a filter changes so users don't land on an
  // empty page that exists only for the previous filter set.
  useEffect(() => { setPage(0); }, [chamber, type, stage, nextChamber, q, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const params = new URLSearchParams();
    params.set("session_id", String(sessionId));
    if (chamber) params.set("chamber", chamber);
    if (type) params.set("type", type);
    if (stage) params.set("stage", stage);
    if (nextChamber) params.set("next_chamber", nextChamber);
    if (q) params.set("q", q);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));

    setLoading(true);
    fetch(`/api/bills?${params.toString()}`)
      .then((r) => r.json() as Promise<{ bills: Bill[]; total: number }>)
      .then((d) => { setBills(d.bills); setTotal(d.total); })
      .finally(() => setLoading(false));
  }, [sessionId, chamber, type, stage, nextChamber, q, page]);

  const pageStart = page * PAGE_SIZE;
  const pageEnd   = Math.min(pageStart + PAGE_SIZE, total);
  const hasPrev   = page > 0;
  const hasNext   = pageEnd < total;

  return (
    <>
      <p className="mt-0 text-(--app-text-mid)">
        All bills in this session. Click a bill number to open it on legis.la.gov.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <ChamberToggle showAll value={chamber} onChange={setChamber} />
        <input
          type="search"
          placeholder="Search by number or title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-60 flex-1 border border-(--app-border-input) bg-(--bg) px-3 py-2 text-base text-(--app-ink)"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="border border-(--app-border-input) bg-(--app-surface) px-2 py-2 text-(--app-ink)"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as Bill["pipeline_stage"] | "")}
          className="border border-(--app-border-input) bg-(--app-surface) px-2 py-2 text-(--app-ink)"
        >
          <option value="">All stages</option>
          {STAGE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select
          value={nextChamber}
          onChange={(e) => setNextChamber(e.target.value as "H" | "S" | "")}
          className="border border-(--app-border-input) bg-(--app-surface) px-2 py-2 text-(--app-ink)"
        >
          <option value="">Next chamber: any</option>
          <option value="H">Heading to House</option>
          <option value="S">Heading to Senate</option>
        </select>
      </div>

      <p className="mt-4 text-[0.9rem] text-(--app-text-muted)">
        {loading
          ? "Loading…"
          : total === 0
          ? "No bills match these filters."
          : `${total.toLocaleString()} bill${total === 1 ? "" : "s"}${
              total > PAGE_SIZE
                ? ` · showing ${pageStart + 1}–${pageEnd}`
                : ""
            }`}
      </p>

      <div className="w-full overflow-x-auto [webkit-overflow-scrolling:touch]">
        <table className="mt-2 w-full min-w-140 border-collapse text-left font-mono text-[0.85rem]">
          <thead>
            <tr className="border-b-2 border-(--app-ink)">
              <th className="px-1 py-2">Bill</th>
              <th className="px-1 py-2">Title</th>
              <th className="px-1 py-2">Type</th>
              <th className="px-1 py-2">Stage</th>
              <th className="px-1 py-2">Next chamber</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id} className="border-b border-(--app-border-row)">
                <td className="px-1 py-[0.4rem] whitespace-nowrap font-semibold">
                  <BillInternalLink id={b.id} billNumber={b.bill_number} />
                </td>
                <td className="px-1 py-[0.4rem] max-w-[40ch] truncate text-(--app-text-mid)" title={b.title ?? undefined}>
                  {b.title ?? <span className="text-(--app-text-subtle) italic">(no title yet)</span>}
                </td>
                <td className="px-1 py-[0.4rem] text-(--app-text-muted)">{b.bill_type}</td>
                <td className={`px-1 py-[0.4rem] ${STAGE_CLASS[b.pipeline_stage]}`}>
                  {STAGE_LABEL[b.pipeline_stage]}
                </td>
                <td className="px-1 py-[0.4rem] text-(--app-text-muted)">
                  {b.next_chamber === "H" ? "House" : b.next_chamber === "S" ? "Senate" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(hasPrev || hasNext) && (
        <div className="mt-4 flex items-center justify-between font-mono text-[0.85rem]">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="cursor-pointer disabled:cursor-not-allowed border border-(--app-border-input) bg-(--app-surface) px-3 py-1.5 text-(--app-ink) disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-(--app-text-muted)">
            Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
            className="cursor-pointer disabled:cursor-not-allowed border border-(--app-border-input) bg-(--app-surface) px-3 py-1.5 text-(--app-ink) disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
