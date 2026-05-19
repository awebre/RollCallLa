import { useEffect, useState } from "react";
import type { RollCallMember } from "../types";
import { formatName, VOTE_LABEL } from "../types";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { partyColorClass, resultColorClass } from "../style/color-classes";
import { ReportIssue } from "../FeedbackContext";

type RollCallHead = {
  roll_call_id: number;
  bill_id: number;
  bill_number: string;
  title: string | null;
  date: string;
  chamber: string;
  description: string;
  vote_category: string;
  yea: number;
  nay: number;
  nv: number;
  absent: number;
  total: number;
  passed: number;
  margin: number;
  pdf_doc_id: number | null;
  session_name: string;
};

export function RollCallDetail({ id }: { id: number }) {
  const [head, setHead] = useState<RollCallHead | null>(null);
  const [members, setMembers] = useState<RollCallMember[]>([]);

  useEffect(() => {
    fetch(`/api/rollcalls/${id}`)
      .then(
        (r) =>
          r.json() as Promise<{
            roll_call: RollCallHead;
            members: RollCallMember[];
          }>,
      )
      .then((d) => {
        setHead(d.roll_call);
        setMembers(d.members);
      });
  }, [id]);

  if (!head)
    return <p className="text-(--app-text-muted)">Loading roll call…</p>;
  const byVote: Record<number, RollCallMember[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
  };
  for (const m of members) byVote[m.vote].push(m);

  return (
    <>
      <p className="mt-0">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            history.back();
          }}
          className="text-(--app-text-muted)"
        >
          ← back
        </a>
      </p>
      <h2 className="mb-0 text-[1.4rem]">
        {head.bill_number}: {head.description}
      </h2>
      <p className="mt-[0.2rem] text-(--app-text-mid)">
        {head.chamber === "H" ? "House" : "Senate"} · {head.date} · category{" "}
        {head.vote_category}
      </p>
      {head.title && (
        <p className="border-l-[3px] border-(--app-border-light) py-1 pl-3 text-(--app-text-mid) italic">
          {head.title}
        </p>
      )}
      <p
        className={`font-mono font-bold ${resultColorClass(Boolean(head.passed))}`}
      >
        {head.passed ? "PASSED" : "FAILED"}
        {"  "}Yea {head.yea} · Nay {head.nay} · NV {head.nv} · Absent{" "}
        {head.absent} · margin {head.margin}
      </p>
      <p className="text-[0.85rem]">
        <a
          href={`https://legis.la.gov/legis/BillInfo.aspx?s=${head.session_name}&b=${encodeURIComponent(head.bill_number)}`}
          target="_blank"
          rel="noreferrer"
          className="text-(--app-link-ext)"
        >
          {head.bill_number} on legis.la.gov ↗
        </a>
        {head.pdf_doc_id && (
          <>
            {"  ·  "}
            <a
              href={`https://legis.la.gov/legis/ViewDocument.aspx?d=${head.pdf_doc_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-(--app-link-ext)"
            >
              roll-call PDF ↗
            </a>
          </>
        )}
      </p>

      <section className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {[1, 2, 3, 4].map((v) => (
          <div key={v}>
            <h3 className="m-0 border-b-2 border-(--app-ink) pb-[0.3rem] text-[0.9rem] tracking-wider uppercase">
              {VOTE_LABEL[v]} · {byVote[v].length}
            </h3>
            <ul className="mt-2 mb-0 list-none p-0 font-mono text-[0.85rem]">
              {byVote[v].map((m) => (
                <li
                  key={m.people_id}
                  className="border-b border-(--app-border-divider) py-[0.15rem]"
                >
                  <a
                    href={`#/legislator/${m.people_id}`}
                    className="text-(--app-link)"
                  >
                    {formatName(m)}
                  </a>
                  <span
                    className={`ml-[0.4rem] font-semibold ${partyColorClass(m.party)}`}
                  >
                    {m.party ?? ""}
                  </span>
                  {m.district && (
                    <span className="text-(--app-text-subtle)">
                      {" "}
                      · D{m.district}
                    </span>
                  )}
                  <ProvenanceBadge source={m.source} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <ReportIssue category="vote" />
    </>
  );
}
