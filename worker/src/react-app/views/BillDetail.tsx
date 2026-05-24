import { useEffect, useState } from "react";
import { Link } from "wouter";
import { BillLink } from "../components/BillLink";
import { resultColorClass } from "../style/color-classes";
import type { Bill } from "../types";

type BillDetail = {
  id: number;
  bill_number: string;
  bill_type: string;
  originating_chamber: "H" | "S";
  title: string | null;
  docs_id: number | null;
  pipeline_stage: Bill["pipeline_stage"];
  next_chamber: "H" | "S" | null;
  status_text: string | null;
  session_name: string;
  session_year: number;
};

type DigestSummary = {
  docs_id: number;
  version: string;
  abstract: string | null;
};

type Referral = {
  referral_id: number;
  referral_date: string;
  discharge_date: string | null;
  outcome: "reported" | "failed" | "deferred" | "substituted" | "other" | null;
  committee_id: number;
  committee_name: string;
  committee_chamber: "H" | "S" | "J";
};

type RollCall = {
  roll_call_id: number;
  date: string;
  chamber: "H" | "S";
  description: string | null;
  vote_category: string;
  yea: number;
  nay: number;
  nv: number;
  absent: number;
  passed: number;
  margin: number;
};

const STAGE_LABEL: Record<Bill["pipeline_stage"], string> = {
  introduced:  "Introduced",
  committee:   "In committee",
  floor:       "On floor",
  concurrence: "Concurrence",
  governor:    "Governor's desk",
  enacted:     "Enacted",
  dead:        "Dead",
  other:       "Other",
};

const STAGE_CLASS: Record<Bill["pipeline_stage"], string> = {
  introduced:  "bg-(--app-surface-warm) text-(--app-text-muted)",
  committee:   "bg-(--app-surface-warm) text-(--app-text-mid)",
  floor:       "bg-(--vote-yea)/15 text-(--vote-yea)",
  concurrence: "bg-(--vote-yea)/15 text-(--vote-yea)",
  governor:    "bg-(--app-warn-bg) text-(--app-warn-text-badge)",
  enacted:     "bg-(--vote-yea)/15 text-(--vote-yea)",
  dead:        "bg-(--app-surface-warm) text-(--app-text-subtle)",
  other:       "bg-(--app-surface-warm) text-(--app-text-muted)",
};

const OUTCOME_LABEL = {
  reported:    "Reported",
  failed:      "Failed",
  deferred:    "Deferred",
  substituted: "Substituted",
  other:       "Other",
} as const;

const OUTCOME_CLASS = {
  reported:    "bg-(--vote-yea)/15 text-(--vote-yea)",
  failed:      "bg-(--vote-nay)/15 text-(--vote-nay)",
  deferred:    "bg-(--app-surface-warm) text-(--app-text-muted)",
  substituted: "bg-(--app-surface-warm) text-(--app-text-muted)",
  other:       "bg-(--app-surface-warm) text-(--app-text-muted)",
} as const;

const VOTE_CATEGORY_LABEL: Record<string, string> = {
  final_passage: "Final passage",
  concurrence:   "Concurrence",
  override:      "Override",
  amendment:     "Amendment",
  procedural:    "Procedural",
  other:         "Other",
};

export function BillDetail({ id }: { id: number }) {
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [rollCalls, setRollCalls] = useState<RollCall[]>([]);
  const [digest, setDigest] = useState<DigestSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bills/${id}`)
      .then((r) => r.json() as Promise<{ bill: BillDetail; referrals: Referral[]; roll_calls: RollCall[]; digest: DigestSummary | null }>)
      .then((d) => {
        setBill(d.bill);
        setReferrals(d.referrals);
        setRollCalls(d.roll_calls);
        setDigest(d.digest ?? null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-(--app-text-muted)">Loading bill…</p>;
  if (!bill) return <p className="text-(--app-text-muted)">Bill not found.</p>;

  return (
    <>
      <p className="mt-0">
        <Link href="/bills" className="text-(--app-text-muted)">← all bills</Link>
      </p>

      <div className="mt-1">
        <h2 className="m-0 text-[1.5rem]">{bill.bill_number}</h2>
        {bill.status_text && (
          <p className="mt-1 mb-0 text-[0.85rem] text-(--app-text-mid) italic">{bill.status_text}</p>
        )}
        <p className="mt-2 mb-0 text-[0.9rem] text-(--app-text-mid)">{bill.title ?? "No title yet"}</p>
      </div>

      <p className="mt-1 text-[0.85rem] text-(--app-text-muted)">
        <span className={`rounded px-1.5 py-0.5 text-[0.72rem] font-semibold ${STAGE_CLASS[bill.pipeline_stage]}`}>
          {STAGE_LABEL[bill.pipeline_stage]}
        </span>
        {" · "}
        {bill.originating_chamber === "H" ? "House" : "Senate"} Bill
        {" · "}
        {bill.session_year} Regular Session
        {" · "}
        <BillLink billNumber={bill.bill_number} sessionName={bill.session_name}>
          View on legis.la.gov ↗
        </BillLink>
      </p>

      {/* Digest abstract */}
      {digest?.abstract && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-[0.72rem] font-semibold uppercase tracking-widest text-(--app-text-muted)">
              Summary
            </span>
            <span className="rounded px-1.5 py-0.5 text-[0.72rem] font-semibold bg-(--app-surface-warm) text-(--app-text-muted)">
              {digest.version}
            </span>
            <div className="flex-1 border-t border-(--app-border-light)" />
          </div>
          <p className="mt-0 text-[0.9rem] text-(--app-text-mid) leading-relaxed">{digest.abstract}</p>
        </div>
      )}

      {/* Committee referrals */}
      <Section label="Committee History" count={referrals.length}>
        {referrals.length === 0 ? (
          <p className="px-3 py-4 text-[0.88rem] text-(--app-text-muted)">No committee referrals recorded.</p>
        ) : (
          <table className="w-full border-collapse text-left text-[0.88rem]">
            <thead>
              <tr className="border-b border-(--app-border-light) text-[0.75rem] font-semibold uppercase tracking-wide text-(--app-text-muted)">
                <th className="px-3 py-2">Committee</th>
                <th className="px-3 py-2 whitespace-nowrap">Referred</th>
                <th className="px-3 py-2 whitespace-nowrap">Discharged</th>
                <th className="px-3 py-2">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--app-border-row)">
              {referrals.map((r) => (
                <tr key={r.referral_id} className="hover:bg-(--app-surface-warm)">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/committees/${r.committee_id}`}
                      className="text-(--app-ink) no-underline hover:underline"
                    >
                      {r.committee_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[0.82rem] text-(--app-text-muted) whitespace-nowrap">
                    {formatDate(r.referral_date)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[0.82rem] text-(--app-text-muted) whitespace-nowrap">
                    {r.discharge_date ? formatDate(r.discharge_date) : <span className="text-(--app-text-subtle)">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.outcome ? (
                      <span className={`rounded px-1.5 py-0.5 text-[0.72rem] font-semibold ${OUTCOME_CLASS[r.outcome]}`}>
                        {OUTCOME_LABEL[r.outcome]}
                      </span>
                    ) : (
                      <span className="rounded px-1.5 py-0.5 text-[0.72rem] font-semibold bg-(--app-warn-bg) text-(--app-warn-text-badge)">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Roll calls */}
      <Section label="Votes" count={rollCalls.length}>
        {rollCalls.length === 0 ? (
          <p className="px-3 py-4 text-[0.88rem] text-(--app-text-muted)">No floor votes recorded.</p>
        ) : (
          <table className="w-full border-collapse text-left text-[0.88rem]">
            <thead>
              <tr className="border-b border-(--app-border-light) text-[0.75rem] font-semibold uppercase tracking-wide text-(--app-text-muted)">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Chamber</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Yea</th>
                <th className="px-3 py-2 text-right">Nay</th>
                <th className="px-3 py-2 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--app-border-row)">
              {rollCalls.map((rc) => (
                <tr key={rc.roll_call_id} className="hover:bg-(--app-surface-warm)">
                  <td className="px-3 py-2.5 font-mono text-[0.82rem] text-(--app-text-muted) whitespace-nowrap">
                    {formatDate(rc.date)}
                  </td>
                  <td className="px-3 py-2.5 text-[0.82rem] text-(--app-text-muted)">
                    {rc.chamber === "H" ? "House" : "Senate"}
                  </td>
                  <td className="px-3 py-2.5 text-[0.82rem] text-(--app-text-muted) whitespace-nowrap">
                    {VOTE_CATEGORY_LABEL[rc.vote_category] ?? rc.vote_category}
                  </td>
                  <td className="px-3 py-2.5 text-(--app-text-mid)">
                    <Link
                      href={`/rollcall/${rc.roll_call_id}`}
                      className="text-(--app-ink) no-underline hover:underline"
                    >
                      {rc.description ?? "—"}
                    </Link>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-[0.82rem] text-(--vote-yea)`}>
                    {rc.yea}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-[0.82rem] text-(--vote-nay)`}>
                    {rc.nay}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-[0.82rem] font-semibold ${resultColorClass(Boolean(rc.passed))}`}>
                    {rc.passed ? "Pass" : "Fail"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[0.72rem] font-semibold uppercase tracking-widest text-(--app-text-muted)">
          {label}
        </span>
        {count > 0 && (
          <span className="rounded-full bg-(--app-surface-warm) px-2 py-0.5 text-[0.72rem] font-semibold text-(--app-text-muted)">
            {count}
          </span>
        )}
        <div className="flex-1 border-t border-(--app-border-light)" />
      </div>
      <div className="border border-(--app-border-light)">
        {children}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${Number(mm)}/${Number(dd)}`;
}
