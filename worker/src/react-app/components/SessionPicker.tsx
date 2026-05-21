import { useSession } from "../SessionContext";
import { formatSessionName } from "../types";

export function SessionPicker() {
  const { sessions, current, setCurrent } = useSession();
  if (sessions.length === 0) return null;
  return (
    <label className="inline-flex items-center gap-2 text-[0.85rem] text-(--app-text-mid)">
      <span className="font-[Georgia,serif]">Session:</span>
      <select
        value={current?.id ?? ""}
        onChange={(e) => {
          const next = sessions.find(
            (s) => s.id === Number(e.target.value),
          );
          if (next) setCurrent(next);
        }}
        className="border px-2 py-[0.3rem] text-[0.9rem] font-[Georgia,serif] border-(--app-border-input) bg-(--app-surface) text-(--app-ink)"
      >
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {formatSessionName(s.name, s.year)}
          </option>
        ))}
      </select>
    </label>
  );
}
