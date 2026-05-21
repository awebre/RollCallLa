import { useEffect, useState } from "react";
import type { Legislator } from "../types";
import { formatName } from "../types";
import { useSession } from "../SessionContext";
import { Link } from "wouter";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { partyColorClass } from "../style/color-classes";

export function Roster() {
  const { current } = useSession();
  const sessionId = current?.id ?? null;
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [loading, setLoading] = useState(true);
  const [chamber, setChamber] = useState<"" | "H" | "S">("");
  const [party, setParty] = useState<"" | "D" | "R" | "I">("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const params = new URLSearchParams();
    if (sessionId) params.set("session_id", String(sessionId));
    if (chamber) params.set("chamber", chamber);
    if (party) params.set("party", party);
    if (q) params.set("q", q);
    if (!sessionId) params.set("active", "1");
    setLoading(true);
    fetch(`/api/legislators?${params.toString()}`)
      .then((r) => r.json() as Promise<{ legislators: Legislator[] }>)
      .then((d) => setLegislators(d.legislators))
      .finally(() => setLoading(false));
  }, [sessionId, chamber, party, q]);

  return (
    <>
      <p className="mt-0 text-(--app-text-mid)">
        Find your legislator. Click a name to see how they voted.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-55 flex-1 border border-(--app-border-input) bg-(--bg) px-3 py-2 text-base text-(--app-ink)"
        />
        <select
          value={chamber}
          onChange={(e) => setChamber(e.target.value as "H" | "S" | "")}
          className="border border-(--app-border-input) bg-(--app-surface) px-2 py-2 text-(--app-ink)"
        >
          <option value="">All chambers</option>
          <option value="S">Senate</option>
          <option value="H">House</option>
        </select>
        <select
          value={party}
          onChange={(e) => setParty(e.target.value as "D" | "R" | "I" | "")}
          className="border border-(--app-border-input) bg-(--app-surface) px-2 py-2 text-(--app-ink)"
        >
          <option value="">All parties</option>
          <option value="D">Democrat</option>
          <option value="R">Republican</option>
          <option value="I">Independent</option>
        </select>
      </div>

      <p className="mt-4 text-[0.9rem] text-(--app-text-muted)">
        {loading
          ? "Loading…"
          : `${legislators.length} legislator${legislators.length === 1 ? "" : "s"}`}
      </p>

      <div className="w-full overflow-x-auto [webkit-overflow-scrolling:touch]">
        <table className="mt-2 w-full min-w-115 border-collapse text-left font-mono text-[0.9rem]">
          <thead>
            <tr className="border-b-2 border-(--app-ink)">
              <th className="px-1 py-2">Name</th>
              <th className="px-1 py-2">Party</th>
              <th className="px-1 py-2">Chamber</th>
              <th className="px-1 py-2">District</th>
            </tr>
          </thead>
          <tbody>
            {legislators.map((l) => (
              <tr
                key={l.id}
                className="border-b border-(--app-border-row)"
              >
                <td className="px-1 py-[0.4rem]">
                  <Link href={`/legislator/${l.id}`} className="text-(--app-link)">
                    {formatName(l)}
                  </Link>
                  <ProvenanceBadge source={l.source} />
                </td>
                <td
                  className={`px-1 py-[0.4rem] font-semibold ${partyColorClass(l.party)}`}
                >
                  {l.party ?? "—"}
                </td>
                <td className="px-1 py-[0.4rem]">{l.role ?? "—"}</td>
                <td className="px-1 py-[0.4rem]">{l.district ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
