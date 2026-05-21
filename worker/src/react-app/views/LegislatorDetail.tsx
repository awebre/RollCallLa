import { useEffect, useState } from "react";
import type { Legislator, LegislatorVoteRow } from "../types";
import { formatName, VOTE_LABEL } from "../types";
import { useSession } from "../SessionContext";
import { Link } from "wouter";
import { useFeedback } from "../FeedbackContext";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { TruncatedText } from "../components/TruncatedText";
import {
  castVoteColorClass,
  partyColorClass,
  resultColorClass,
} from "../style/color-classes";
import { ChamberAgenda } from "../components/ChamberAgenda";

type Profile = {
  legislator: Legislator;
  final_passage_tally: { yea: number; nay: number; nv: number; absent: number };
  party_line: number | null;
};

export function LegislatorDetail({ id }: { id: number }) {
  const { current } = useSession();
  const sessionId = current?.id ?? null;
  const { openFeedback } = useFeedback();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [votes, setVotes] = useState<LegislatorVoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("final_passage");
  const [vote, setVote] = useState<string>("");
  const [closeOnly, setCloseOnly] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (sessionId) params.set("session_id", String(sessionId));
    fetch(`/api/legislators/${id}?${params.toString()}`)
      .then((r) => r.json() as Promise<Profile>)
      .then(setProfile);
  }, [id, sessionId]);

  useEffect(() => {
    if (sessionId === null) return;
    const params = new URLSearchParams();
    params.set("session_id", String(sessionId));
    if (category) params.set("category", category);
    if (vote) params.set("vote", vote);
    if (closeOnly) params.set("close", "1");
    if (q) params.set("q", q);
    params.set("limit", "100");
    setLoading(true);
    fetch(`/api/legislators/${id}/votes?${params.toString()}`)
      .then((r) => r.json() as Promise<{ votes: LegislatorVoteRow[] }>)
      .then((d) => setVotes(d.votes))
      .finally(() => setLoading(false));
  }, [id, sessionId, category, vote, closeOnly, q]);

  if (!profile)
    return <p className="text-(--app-text-muted)">Loading legislator…</p>;
  const { legislator: l, final_passage_tally: t, party_line } = profile;
  const fp_total = t.yea + t.nay + t.nv + t.absent;

  // Chamber-site profile URL uses source_id directly (the actual ID from
  // senate.la.gov or house.louisiana.gov). Not available for pdf-only
  // legislators (no roster match → source_id is null).
  const profileUrl = l.source !== 'pdf' && l.source_id != null
    ? l.chamber === 'S'
      ? `https://senate.la.gov/smembers.aspx?ID=${l.source_id}`
      : `https://house.louisiana.gov/H_Reps/members.aspx?ID=${l.source_id}`
    : null;

  return (
    <>
      <p className="mt-0">
        <Link href="/roster" className="text-(--app-text-muted)">
          ← all legislators
        </Link>
      </p>
      <h2 className="mb-0 text-[1.6rem]">
        {formatName(l)}
        <ProvenanceBadge source={l.source} style={{ fontSize: "0.65rem" }} />
      </h2>
      <p className="mt-[0.2rem] text-(--app-text-mid)">
        <span className={`font-semibold ${partyColorClass(l.party)}`}>
          {partyName(l.party)}
        </span>
        {" · "}
        {l.role === "Sen" ? "Senator" : "Representative"}
        {l.district ? ` · District ${l.district}` : ""}
        {l.active === 0 ? " · not currently serving" : ""}
        {profileUrl && (
          <>
            {" · "}
            <a
              href={profileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-(--app-link-ext)"
            >
              Official profile ↗
            </a>
          </>
        )}
      </p>
      {(l.term_start || l.term_end || l.year_elected) && (
        <p className="mt-[0.2rem] font-mono text-[0.85rem] text-(--app-text-muted)">
          {l.year_elected ? `Year elected ${l.year_elected}` : null}
          {l.term_start ? ` · Term start ${l.term_start}` : null}
          {l.term_end ? ` · Term end ${l.term_end}` : null}
        </p>
      )}
      {l.source === "pdf" && (
        <p className="mt-3 border border-(--app-warn-border) bg-(--app-warn-bg) px-3 py-2 text-[0.85rem] text-(--app-warn-text)">
          Limited information. This legislator's votes appear in roll-call PDFs
          but we couldn't match them to a current chamber roster — most likely
          because they left office. First name, party, and district aren't
          available until backfilled from an external source.
        </p>
      )}

      <section className="my-5 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
        <Stat label="Yea (FP)" value={t.yea} help="Yea votes on final passage roll calls for the selected session. FP = Final Passage — the decisive up/down vote on a bill." />
        <Stat label="Nay (FP)" value={t.nay} help="Nay votes on final passage roll calls. This total may be higher than what you see in the list below if you've applied filters." />
        <Stat label="No vote" value={t.nv} help="Roll calls where the legislator was present but did not cast a vote." />
        <Stat label="Absent" value={t.absent} help="Roll calls where the legislator was recorded as absent." />
        <Stat label="Total FP" value={fp_total} help="Total final passage roll calls the legislator participated in during the selected session." />
        <Stat
          label="Party-line"
          value={party_line == null ? "—" : `${party_line}%`}
          help="Percentage of final passage votes where this legislator voted with their party's majority position in the same chamber (Yea if most colleagues voted Yea, Nay if most voted Nay)."
        />
      </section>
      <p className="text-[0.82rem] text-(--app-text-muted)">
        <button
          onClick={() => openFeedback('representative')}
          className="underline cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit italic"
        >
          Report an issue with this representative
        </button>
      </p>

      {l.role && (
        <>
          <div className="mt-7 mb-3 flex items-center gap-3">
            <span className="text-[0.75rem] font-semibold uppercase tracking-widest text-(--app-text-muted)">
              Floor Agenda
            </span>
            <div className="flex-1 border-t border-(--app-border-light)" />
          </div>
          <ChamberAgenda chamber={l.role === "Sen" ? "S" : "H"} showEmpty />
        </>
      )}

      {/* Vote History */}
      <div className="mt-7 mb-3 flex items-center gap-3">
        <span className="text-[0.75rem] font-semibold uppercase tracking-widest text-(--app-text-muted)">
          Vote History
        </span>
        <div className="flex-1 border-t border-(--app-border-light)" />
      </div>

      <div className="mt-0 flex flex-wrap items-center gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border border-(--app-border-input) bg-(--app-surface) px-2 py-2 text-(--app-ink)"
        >
          <option value="final_passage">Final passage only</option>
          <option value="concurrence">Concurrence</option>
          <option value="override">Veto override</option>
          <option value="amendment">Amendments</option>
          <option value="procedural">Procedural</option>
          <option value="">All categories</option>
        </select>
        <select
          value={vote}
          onChange={(e) => setVote(e.target.value)}
          className="border border-(--app-border-input) bg-(--app-surface) px-2 py-2 text-(--app-ink)"
        >
          <option value="">Any vote cast</option>
          <option value="1">Only Yea</option>
          <option value="2">Only Nay</option>
          <option value="3">Only NV</option>
          <option value="4">Only Absent</option>
        </select>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={closeOnly}
            onChange={(e) => setCloseOnly(e.target.checked)}
          />
          Close votes only (margin ≤ 10)
        </label>
        <input
          type="search"
          placeholder="Bill # or title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-50 flex-1 border border-(--app-border-input) bg-(--bg) px-2 py-2 text-(--app-ink)"
        />
      </div>

      <p className="mt-4 text-[0.9rem] text-(--app-text-muted)">
        {loading
          ? "Loading…"
          : `${votes.length} vote${votes.length === 1 ? "" : "s"}`}
        {votes.length === 100
          ? " (showing 100 most recent — refine filters to see more)"
          : ""}
      </p>

      <div className="w-full overflow-x-auto [webkit-overflow-scrolling:touch]">
        <table className="w-full min-w-140 border-collapse text-left font-mono text-[0.85rem]">
          <thead>
            <tr className="border-b-2 border-(--app-ink)">
              <th className="px-1 py-2">Date</th>
              <th className="px-1 py-2">Bill</th>
              <th className="px-1 py-2">Description</th>
              <th className="px-1 py-2">Cast</th>
              <th className="px-1 py-2">Tally</th>
              <th className="px-1 py-2">Result</th>
              <th className="px-1 py-2">PDF</th>
              <th className="px-1 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {votes.map((v) => (
              <tr
                key={v.roll_call_id}
                className="border-b border-(--app-border-row)"
              >
                <td className="px-1 py-[0.4rem] whitespace-nowrap">{v.date}</td>
                <td className="px-1 py-[0.4rem]">
                  {current ? (
                    <a
                      href={`https://legis.la.gov/legis/BillInfo.aspx?s=${current.name}&b=${v.bill_number.replace(/\s+/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-(--app-link-ext)"
                    >
                      {v.bill_number}
                    </a>
                  ) : (
                    v.bill_number
                  )}
                </td>
                <td className="px-1 py-[0.4rem]">
                  {v.title ? (
                    <TruncatedText
                      text={v.title}
                      href={`/rollcall/${v.roll_call_id}`}
                      maxWidthClass="max-w-[28ch] md:max-w-[34ch]"
                      className="text-[0.92rem]"
                    />
                  ) : (
                    <Link href={`/rollcall/${v.roll_call_id}`} className="text-(--app-link)">
                      {v.description}
                    </Link>
                  )}
                  <span className="mt-0.5 block text-[0.72rem] tracking-wide text-(--app-text-subtle) uppercase">
                    {v.description}
                  </span>
                </td>
                <td
                  className={`px-1 py-[0.4rem] font-bold ${castVoteColorClass(v.cast_vote)}`}
                >
                  {VOTE_LABEL[v.cast_vote]}
                </td>
                <td className="px-1 py-[0.4rem] whitespace-nowrap text-(--app-text-mid)">
                  {v.yea}–{v.nay}
                </td>
                <td
                  className={`px-1 py-[0.4rem] ${resultColorClass(Boolean(v.passed))}`}
                >
                  {v.passed ? "Passed" : "Failed"}
                </td>
                <td className="px-1 py-[0.4rem] whitespace-nowrap">
                  {v.pdf_doc_id != null ? (
                    <a
                      href={`https://legis.la.gov/legis/ViewDocument.aspx?d=${v.pdf_doc_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-(--app-link-ext)"
                    >
                      PDF ↗
                    </a>
                  ) : null}
                </td>
                <td className="px-1 py-[0.4rem]">
                  <button
                    onClick={() => openFeedback('vote')}
                    title="Report an issue with this vote"
                    className="cursor-pointer bg-transparent border-none p-0 text-(--app-text-muted) hover:text-(--app-ink) text-[0.8rem] leading-none"
                  >
                    ⚑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function partyName(p: string | null) {
  if (p === "D") return "Democrat";
  if (p === "R") return "Republican";
  if (p === "I") return "Independent";
  return "Unaffiliated";
}

function Stat({ label, value, help }: { label: string; value: number | string; help?: string }) {
  return (
    <div className="relative border border-(--app-border-light) bg-(--app-surface) px-3 py-2.5">
      <div className="flex items-center gap-1 text-[0.7rem] tracking-wide uppercase text-(--app-text-muted)">
        {label}
        {help && <StatHelp text={help} />}
      </div>
      <div className="font-mono text-[1.4rem]">{value}</div>
    </div>
  );
}

function StatHelp({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="inline-flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full border border-(--app-border-input) text-[0.6rem] leading-none text-(--app-text-muted)">
        ?
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-56 -translate-x-1/2 rounded border border-(--app-border-light) bg-(--app-surface-warm) p-2 text-[0.75rem] leading-snug normal-case tracking-normal text-(--app-ink) shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
        {text}
      </span>
    </span>
  );
}
