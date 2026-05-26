import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useSession } from "../SessionContext";
import type { Committee } from "../types";
import { COMMITTEE_ROLE_LABEL } from "../types";
import { formatName, partyColor } from "../types";
import { ChamberToggle } from "../components/ChamberToggle";
import { BillInternalLink } from "../components/BillInternalLink";

type CommitteeMember = {
  role: string;
  legislator_id: number;
  first_name: string | null;
  last_name: string;
  suffix: string | null;
  nickname: string | null;
  source: string | null;
  party: "R" | "D" | "I" | null;
  district: number | null;
};

type CommitteeReferral = {
  referral_id: number;
  bill_id: number;
  bill_number: string;
  bill_type: string;
  originating_chamber: "H" | "S";
  title: string | null;
  pipeline_stage: string;
  referral_date: string;
  discharge_date: string | null;
  outcome: "reported" | "failed" | "deferred" | "substituted" | "other" | null;
};

const OUTCOME_LABEL: Record<NonNullable<CommitteeReferral["outcome"]>, string> = {
  reported:    "Reported",
  failed:      "Failed",
  deferred:    "Deferred",
  substituted: "Substituted",
  other:       "Other",
};

const OUTCOME_CLASS: Record<NonNullable<CommitteeReferral["outcome"]>, string> = {
  reported:    "bg-(--vote-yea)/15 text-(--vote-yea)",
  failed:      "bg-(--vote-nay)/15 text-(--vote-nay)",
  deferred:    "bg-(--app-surface-warm) text-(--app-text-muted)",
  substituted: "bg-(--app-surface-warm) text-(--app-text-muted)",
  other:       "bg-(--app-surface-warm) text-(--app-text-muted)",
};

type CommitteeDetail = Committee & { members: CommitteeMember[] };

export function CommitteesView({ committeeId }: { committeeId?: number }) {
  return committeeId != null
    ? <CommitteeDetailView id={committeeId} />
    : <CommitteeList />;
}

function CommitteeList() {
  const { current } = useSession();
  const sessionId = current?.id ?? null;
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [loading, setLoading] = useState(true);
  const [chamber, setChamber] = useState<"H" | "S">("H");
  const [q, setQ] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sessionId) params.set("session_id", String(sessionId));
    params.set("chamber", chamber);
    fetch(`/api/committees?${params.toString()}`)
      .then((r) => r.json() as Promise<{ committees: Committee[] }>)
      .then((d) => setCommittees(d.committees))
      .finally(() => setLoading(false));
  }, [sessionId, chamber]);

  const filtered = q
    ? committees.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
    : committees;

  return (
    <>
      <div className="my-4 flex flex-wrap items-center gap-3">
        <ChamberToggle value={chamber} onChange={setChamber} />
        <input
          type="search"
          placeholder="Search committees…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-48 flex-1 border border-(--app-border-input) bg-(--bg) px-3 py-2 text-base text-(--app-ink)"
        />
      </div>

      {loading ? (
        <p className="text-(--app-text-muted)">Loading committees…</p>
      ) : committees.length === 0 ? (
        <p className="text-(--app-text-muted)">
          No committee data yet. Run <code>scrape-committees.mjs</code> to populate.
        </p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-[0.88rem]">
            <thead>
              <tr className="border-b-2 border-(--app-ink)">
                <th className="px-2 py-2">Committee</th>
                <th className="px-2 py-2">Chair</th>
                <th className="px-2 py-2 text-right">Members</th>
                <th className="px-2 py-2 text-right">R · D</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <CommitteeRow key={c.id} committee={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CommitteeRow({ committee: c }: { committee: Committee }) {
  const hasChair = c.chair_legislator_id != null;
  const r = c.republican_count ?? 0;
  const d = c.democrat_count ?? 0;

  return (
    <tr className="border-b border-(--app-border-row) hover:bg-(--app-surface-warm)">
      <td className="px-2 py-2.5">
        <Link
          href={`/committees/${c.id}`}
          className="font-semibold text-(--app-ink) no-underline hover:underline"
        >
          {c.name}
        </Link>
      </td>
      <td className="px-2 py-2.5 text-(--app-text-muted)">
        {hasChair ? (
          <Link
            href={`/legislator/${c.chair_legislator_id}`}
            className="text-(--app-ink) no-underline hover:underline"
          >
            {chairName(c)}
          </Link>
        ) : (
          <span className="text-(--app-text-muted)">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-right font-mono text-(--app-text-mid)">
        {c.member_count ?? 0}
      </td>
      <td className="px-2 py-2.5 text-right font-mono text-[0.82rem]">
        {r > 0 || d > 0 ? (
          <>
            <span className="text-(--party-r)">{r}R</span>
            <span className="text-(--app-text-muted)"> · </span>
            <span className="text-(--party-d)">{d}D</span>
          </>
        ) : (
          <span className="text-(--app-text-muted)">—</span>
        )}
      </td>
    </tr>
  );
}

function chairName(c: Committee): string {
  const last = c.chair_last_name ?? "";
  const first = c.chair_first_name ? `, ${c.chair_first_name}` : "";
  const suffix = c.chair_suffix ? `, ${c.chair_suffix}` : "";
  return `${last}${suffix}${first}`;
}

function CommitteeDetailView({ id }: { id: number }) {
  const { current } = useSession();
  const sessionId = current?.id ?? null;
  const [data, setData] = useState<CommitteeDetail | null>(null);
  const [referrals, setReferrals] = useState<CommitteeReferral[]>([]);
  const [loading, setLoading] = useState(true);
  const [billsLoading, setBillsLoading] = useState(true);

  const [q, setQ] = useState("");
  const [chamberFilter, setChamberFilter] = useState<"" | "H" | "S">("");
  const [typeFilter, setTypeFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sessionId) params.set("session_id", String(sessionId));
    const qs = params.toString();
    fetch(`/api/committees/${id}?${qs}`)
      .then((r) => r.json() as Promise<{ committee: Committee; members: CommitteeMember[] }>)
      .then((d) => setData({ ...d.committee, members: d.members }))
      .finally(() => setLoading(false));
    setBillsLoading(true);
    fetch(`/api/committees/${id}/bills?${qs}`)
      .then((r) => r.json() as Promise<{ referrals: CommitteeReferral[] }>)
      .then((d) => setReferrals(d.referrals))
      .finally(() => setBillsLoading(false));
  }, [id, sessionId]);

  const billTypes = useMemo(
    () => [...new Set(referrals.map((r) => r.bill_type))].sort(),
    [referrals],
  );

  const filtered = useMemo(() => referrals.filter((r) => {
    if (chamberFilter && r.originating_chamber !== chamberFilter) return false;
    if (typeFilter && r.bill_type !== typeFilter) return false;
    if (outcomeFilter === "pending" && r.outcome !== null) return false;
    if (outcomeFilter && outcomeFilter !== "pending" && r.outcome !== outcomeFilter) return false;
    if (q) {
      const lq = q.toLowerCase();
      if (!r.bill_number.toLowerCase().includes(lq) && !(r.title ?? "").toLowerCase().includes(lq)) return false;
    }
    return true;
  }), [referrals, chamberFilter, typeFilter, outcomeFilter, q]);

  if (loading) return <p className="text-(--app-text-muted)">Loading committee…</p>;
  if (!data) return <p className="text-(--app-text-muted)">Committee not found.</p>;

  const grouped = groupByRole(data.members);

  return (
    <>
      <p className="mt-0">
        <Link href="/committees" className="text-(--app-text-muted)">
          ← all committees
        </Link>
      </p>

      <h2 className="mb-1 text-[1.5rem]">{data.name}</h2>
      <p className="mt-0 text-[0.9rem] text-(--app-text-muted)">
        {data.chamber === "H" ? "House" : data.chamber === "S" ? "Senate" : "Joint"} Committee
        {" · "}
        <a
          href={data.url}
          target="_blank"
          rel="noreferrer"
          className="text-(--app-link-ext)"
        >
          Official page ↗
        </a>
      </p>

      {/* Members */}
      {data.members.length === 0 ? (
        <p className="mt-4 text-(--app-text-muted)">
          No membership data for this session yet.
        </p>
      ) : (
        <MembersSection grouped={grouped} />
      )}

      {/* Bills referred */}
      <Section label="Bills" count={filtered.length} total={referrals.length}>
        {billsLoading ? (
          <p className="px-3 py-4 text-[0.88rem] text-(--app-text-muted)">Loading bills…</p>
        ) : referrals.length === 0 ? (
          <p className="px-3 py-4 text-[0.88rem] text-(--app-text-muted)">No bills referred this session.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-(--app-border-light) px-3 py-2">
              <ChamberToggle showAll value={chamberFilter} onChange={setChamberFilter} />
              <input
                type="search"
                placeholder="Search bill # or title…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="min-w-40 flex-1 border border-(--app-border-input) bg-(--bg) px-2 py-1 text-[0.84rem] text-(--app-ink)"
              />
              {billTypes.length > 1 && (
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="border border-(--app-border-input) bg-(--app-surface) px-2 py-1 text-[0.84rem] text-(--app-ink)"
                >
                  <option value="">All types</option>
                  {billTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                className="border border-(--app-border-input) bg-(--app-surface) px-2 py-1 text-[0.84rem] text-(--app-ink)"
              >
                <option value="">All outcomes</option>
                <option value="pending">Pending</option>
                {(Object.keys(OUTCOME_LABEL) as (keyof typeof OUTCOME_LABEL)[]).map((k) => (
                  <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>
                ))}
              </select>
            </div>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-[0.88rem] text-(--app-text-muted)">No bills match these filters.</p>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="w-full border-collapse text-left text-[0.88rem]">
                  <thead>
                    <tr className="border-b border-(--app-border-light) text-[0.75rem] font-semibold uppercase tracking-wide text-(--app-text-muted)">
                      <th className="px-3 py-2">Bill</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2 whitespace-nowrap">Referred</th>
                      <th className="px-3 py-2">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--app-border-row)">
                    {filtered.map((r) => (
                      <ReferralRow key={r.referral_id} referral={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>
    </>
  );
}

function Section({ label, count, total, children }: { label: string; count: number; total?: number; children: React.ReactNode }) {
  const badge = total != null && total !== count
    ? `${count} of ${total}`
    : count > 0 ? String(count) : null;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[0.72rem] font-semibold uppercase tracking-widest text-(--app-text-muted)">
          {label}
        </span>
        {badge && (
          <span className="rounded-full bg-(--app-surface-warm) px-2 py-0.5 text-[0.72rem] font-semibold text-(--app-text-muted)">
            {badge}
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

function ReferralRow({ referral: r }: { referral: CommitteeReferral }) {
  return (
    <tr className="hover:bg-(--app-surface-warm)">
      <td className="px-3 py-2.5 font-mono font-semibold">
        <BillInternalLink id={r.bill_id} billNumber={r.bill_number} />
      </td>
      <td className="px-3 py-2.5 text-(--app-text-mid)">
        <span className="line-clamp-1">{r.title ?? "—"}</span>
      </td>
      <td className="px-3 py-2.5 font-mono text-[0.82rem] text-(--app-text-muted) whitespace-nowrap">
        {formatDate(r.referral_date)}
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
  );
}

function formatDate(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${Number(mm)}/${Number(dd)}`;
}

const ROLE_ORDER = ["chair", "vice_chair", "member", "interim", "ex_officio"];
const LEADERSHIP_ROLES = new Set(["chair", "vice_chair"]);

function MembersSection({ grouped }: { grouped: { role: string; members: CommitteeMember[] }[] }) {
  const leadership = grouped.filter((g) => LEADERSHIP_ROLES.has(g.role));
  const rankAndFile = grouped.filter((g) => !LEADERSHIP_ROLES.has(g.role));

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[0.72rem] font-semibold uppercase tracking-widest text-(--app-text-muted)">
          Members
        </span>
        <div className="flex-1 border-t border-(--app-border-light)" />
      </div>
      <div className="border border-(--app-border-light)">
        {/* Chair / Vice Chair — full rows */}
        {leadership.map(({ role, members }) =>
          members.map((m) => (
            <Link
              key={m.legislator_id}
              href={`/legislator/${m.legislator_id}`}
              className="flex items-center justify-between px-3 py-2 no-underline hover:bg-(--app-surface-warm)"
            >
              <span className="text-(--app-ink)">{formatName(m)}</span>
              <span className="flex items-center gap-3 font-mono text-[0.82rem] text-(--app-text-muted)">
                <span className="text-[0.72rem] font-semibold uppercase tracking-wide">
                  {COMMITTEE_ROLE_LABEL[role] ?? role}
                </span>
                {m.party && (
                  <span style={{ color: partyColor(m.party) }} className="font-semibold">
                    {m.party}
                  </span>
                )}
              </span>
            </Link>
          ))
        )}
        {/* Rank-and-file — 2-col compact grid */}
        {rankAndFile.length > 0 && (
          <div className="grid grid-cols-2 divide-y divide-(--app-border-row) border-t border-(--app-border-light)">
            {rankAndFile.flatMap(({ role, members }) => members.map((m) => ({ ...m, role }))).map((m) => (
              <Link
                key={m.legislator_id}
                href={`/legislator/${m.legislator_id}`}
                className="flex items-center justify-between px-3 py-1.5 text-[0.84rem] no-underline odd:border-r odd:border-(--app-border-row) hover:bg-(--app-surface-warm)"
              >
                <span className="text-(--app-ink)">{formatName(m)}</span>
                <span className="flex items-center gap-2">
                  {m.role !== "member" && (
                    <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-(--app-text-muted)">
                      {COMMITTEE_ROLE_LABEL[m.role] ?? m.role}
                    </span>
                  )}
                  {m.party && (
                    <span style={{ color: partyColor(m.party) }} className="font-mono text-[0.78rem] font-semibold">
                      {m.party}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function groupByRole(members: CommitteeMember[]) {
  const map = new Map<string, CommitteeMember[]>();
  for (const m of members) {
    const key = m.role ?? "member";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return ROLE_ORDER
    .filter((r) => map.has(r))
    .map((r) => ({ role: r, members: map.get(r)! }));
}
