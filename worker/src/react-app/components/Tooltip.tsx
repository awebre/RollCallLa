import { useEffect, useId, useRef, useState } from "react";

type TooltipProps = {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function Tooltip({ content, children, className = "" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <span
      ref={rootRef}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-controls={tooltipId}
      className={`relative inline-flex cursor-help ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
    >
      {children}
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-64 -translate-x-1/2 rounded border border-(--app-border-light) bg-(--app-surface-warm) px-2.5 py-2 text-[0.78rem] leading-snug text-(--app-ink) shadow-sm whitespace-pre-line ${open ? "block" : "hidden"}`}
      >
        {content}
      </span>
    </span>
  );
}

export function TooltipIcon() {
  return (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-(--app-border-input) text-[0.6rem] leading-none text-(--app-text-muted)">
      ?
    </span>
  );
}
