import type { CSSProperties } from "react";

type Props = {
  source?: "roster" | "pdf" | null;
  term_source?: "official" | "wikipedia" | "derived" | null;
  style?: CSSProperties;
};

// Inline pill rendered next to a legislator name. Communicates that we don't have
// official-chamber data for this person — only what we could reconstruct from the
// PDFs or from a third-party reference.
export function ProvenanceBadge({ source, term_source, style }: Props) {
  const baseClass =
    "ml-[0.4rem] inline-flex items-center rounded-[3px] border px-[0.35rem] py-[0.05rem] align-middle text-[0.7rem]";

  if (source === "pdf") {
    return (
      <span
        title="Reconstructed from roll-call PDFs — no official chamber roster entry. Last name is all we have."
        className={`${baseClass} font-semibold text-(--app-warn-text-badge) bg-(--app-warn-bg) border-(--app-warn-border)`}
        style={style}
      >
        PDF-only
      </span>
    );
  }
  if (term_source === "wikipedia" || term_source === "derived") {
    const label =
      term_source === "wikipedia" ? "Term: Wikipedia" : "Term: derived";
    const title =
      term_source === "wikipedia"
        ? "Term-start date was scraped from Wikipedia, not an official source."
        : "Term-end date was inferred from the successor's sworn-in date.";
    return (
      <span
        title={title}
        className={`${baseClass} font-medium text-(--app-badge-text) bg-(--app-badge-bg) border-(--app-badge-border)`}
        style={style}
      >
        {label}
      </span>
    );
  }
  return null;
}
