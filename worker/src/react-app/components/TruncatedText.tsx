import { useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";

type TruncatedTextProps = {
  text: string;
  href?: string;
  maxWidthClass?: string;
  className?: string;
};

// Shows a one-line truncated preview with a lightweight tooltip-style reveal.
// Hover works on desktop; focus/tap on the info button works on mobile.
export function TruncatedText({
  text,
  href,
  maxWidthClass = "max-w-[42ch]",
  className = "",
}: TruncatedTextProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const previewClass = `block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${maxWidthClass}`;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <span
      ref={rootRef}
      className={`group relative inline-flex min-w-0 items-start align-top ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {href ? (
        <Link href={href} className="min-w-0 text-(--app-link)" title={text}>
          <span className={previewClass}>{text}</span>
        </Link>
      ) : (
        <span className={previewClass} title={text}>
          {text}
        </span>
      )}
      <button
        type="button"
        className="ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-(--app-border-input) bg-(--app-surface) text-[0.75rem] leading-none text-(--app-text-muted)"
        aria-label={open ? "Hide full description" : "Show full description"}
        aria-expanded={open}
        aria-controls={tooltipId}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`absolute top-full left-0 z-20 mt-1 max-w-[min(90vw,36rem)] rounded border border-(--app-border-light) bg-(--app-surface-warm) p-2 text-left text-[0.75rem] leading-snug text-(--app-ink) shadow-sm ${open ? "block" : "hidden"}`}
      >
        {text}
      </span>
    </span>
  );
}