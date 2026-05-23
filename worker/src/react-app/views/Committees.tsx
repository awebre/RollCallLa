import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useSession } from "../SessionContext";
import type { Committee } from "../types";
import { COMMITTEE_ROLE_LABEL } from "../types";
import { formatName, partyColor } from "../types";
import { ChamberToggle } from "../components/ChamberToggle";

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

type CommitteeDetail = Committee & { members: CommitteeMember[] };

export function CommitteesView({ committeeId }: { committeeId?: number }) {
  return committeeId != null
    ? <CommitteeDetail id={committeeId} />
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
      <td className="px-2 py-2.5 text-(--app-text-mid)">
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

function CommitteeDetail({ id }: { id: number }) {
  const { current } = useSession();
  const sessionId = current?.id ?? null;
  const [data, setData] = useState<CommitteeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sessionId) params.set("session_id", String(sessionId));
    fetch(`/api/committees/${id}?${params.toString()}`)
      .then((r) => r.json() as Promise<{ committee: Committee; members: CommitteeMember[] }>)
      .then((d) => setData({ ...d.committee, members: d.members }))
      .finally(() => setLoading(false));
  }, [id, sessionId]);

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

      {data.members.length === 0 ? (
        <p className="mt-6 text-(--app-text-muted)">
          No membership data for this session yet.
        </p>
      ) : (
        <>
          {grouped.map(({ role, members }) => (
            <div key={role} className="mt-5">
              <div className="mb-2 flex items-center gap-3">
                <span className="text-[0.72rem] font-semibold uppercase tracking-widest text-(--app-text-muted)">
                  {COMMITTEE_ROLE_LABEL[role] ?? role}
                </span>
                <div className="flex-1 border-t border-(--app-border-light)" />
              </div>
              <div className="divide-y divide-(--app-border-row) border border-(--app-border-light)">
                {members.map((m) => (
                  <Link
                    key={m.legislator_id}
                    href={`/legislator/${m.legislator_id}`}
                    className="flex items-center justify-between px-3 py-2.5 no-underline hover:bg-(--app-surface-warm)"
                  >
                    <span className="text-(--app-ink)">{formatName(m)}</span>
                    <span className="flex items-center gap-3 font-mono text-[0.82rem] text-(--app-text-muted)">
                      {m.district != null && `Dist. ${m.district}`}
                      {m.party && (
                        <span style={{ color: partyColor(m.party) }} className="font-semibold">
                          {m.party}
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

const ROLE_ORDER = ["chair", "vice_chair", "member", "interim", "ex_officio"];

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
