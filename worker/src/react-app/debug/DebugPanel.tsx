import { useEffect, useRef, useState } from "react";
import { useAdmin } from "../AdminContext";
import { useDebug } from "./DebugContext";
import { DEBUG_FEATURES } from "./fixtures/index";

function BugIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* body */}
      <ellipse cx="12" cy="14" rx="4" ry="5" />
      {/* head */}
      <circle cx="12" cy="7.5" r="2" />
      {/* neck connector */}
      <line x1="12" y1="9.5" x2="12" y2="9" />
      {/* antennae */}
      <line x1="10.5" y1="6" x2="8.5" y2="3.5" />
      <line x1="13.5" y1="6" x2="15.5" y2="3.5" />
      {/* legs — 3 pairs */}
      <line x1="8" y1="12"  x2="5"  y2="11" />
      <line x1="8" y1="14"  x2="5"  y2="14" />
      <line x1="8" y1="16"  x2="5"  y2="17.5" />
      <line x1="16" y1="12" x2="19" y2="11" />
      <line x1="16" y1="14" x2="19" y2="14" />
      <line x1="16" y1="16" x2="19" y2="17.5" />
    </svg>
  );
}

export function DebugPanel() {
  const { isAdmin, loading } = useAdmin();
  const { overrides, setOverride } = useDebug();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const anyActive = Object.keys(overrides).length > 0;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  if (loading || !isAdmin) return null;

  return (
    <div ref={panelRef} className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Panel */}
      {open && (
        <div className="w-72 rounded border border-(--app-border-light) bg-(--app-surface) shadow-lg">
          <div className="flex items-center justify-between border-b border-(--app-border-light) bg-(--app-surface-warm) px-3 py-2">
            <span className="text-[0.8rem] font-semibold tracking-wide uppercase text-(--app-text-muted)">
              Debug overrides
            </span>
            {anyActive && (
              <button
                onClick={() => {
                  Object.keys(overrides).forEach((k) => setOverride(k, null));
                }}
                className="cursor-pointer bg-transparent border-none p-0 text-[0.75rem] text-(--app-text-muted) underline hover:text-(--app-ink)"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="p-3 space-y-3">
            {Object.entries(DEBUG_FEATURES).map(([key, feature]) => (
              <div key={key}>
                <label className="block text-[0.72rem] font-semibold uppercase tracking-wide text-(--app-text-muted) mb-1">
                  {feature.label}
                </label>
                <select
                  value={overrides[key] ?? ""}
                  onChange={(e) => setOverride(key, e.target.value || null)}
                  className="w-full border border-(--app-border-input) bg-(--app-surface) px-2 py-1.5 text-[0.8rem] text-(--app-ink)"
                >
                  <option value="">Real data</option>
                  {Object.entries(feature.options).map(([name, opt]) => (
                    <option key={name} value={name}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="border-t border-(--app-border-light) px-3 py-1.5 text-[0.68rem] text-(--app-text-subtle)">
            Overrides stored in sessionStorage. Admin only.
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Debug overrides"
        className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border text-[1rem] leading-none shadow-md transition-colors ${
          open
            ? "border-(--app-ink) bg-(--app-ink) text-(--app-surface)"
            : "border-(--app-border-input) bg-(--app-surface) text-(--app-text-muted) hover:text-(--app-ink)"
        }`}
      >
        <BugIcon />
        {anyActive && !open && (
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-orange-400 border border-(--app-surface)" />
        )}
      </button>
    </div>
  );
}
