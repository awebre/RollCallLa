type Chamber = "H" | "S";
type ChamberOrAll = "" | "H" | "S";

type ChamberToggleBase = { countH?: number; countS?: number };
type ChamberToggleProps =
  | (ChamberToggleBase & { showAll: true; value: ChamberOrAll; onChange: (c: ChamberOrAll) => void })
  | (ChamberToggleBase & { showAll?: false; value: Chamber; onChange: (c: Chamber) => void });

export function ChamberToggle({ value, onChange, countH, countS, ...rest }: ChamberToggleProps) {
  const showAll = "showAll" in rest ? rest.showAll : false;
  return (
    <div
      role="tablist"
      aria-label="Chamber"
      className="inline-flex flex-none gap-0.5 rounded-lg border border-(--app-navy-border) bg-(--app-navy-bg) p-0.75"
    >
      {showAll && (
        <button
          type="button"
          role="tab"
          aria-selected={value === ""}
          onClick={() => (onChange as (c: ChamberOrAll) => void)("")}
          className={btnClass(value === "")}
        >
          All
        </button>
      )}
      <button
        type="button"
        role="tab"
        aria-selected={value === "H"}
        onClick={() => onChange("H" as Chamber & ChamberOrAll)}
        className={btnClass(value === "H")}
      >
        House
        {countH != null && (
          <span className={countClass(value === "H")}>{countH}</span>
        )}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "S"}
        onClick={() => onChange("S" as Chamber & ChamberOrAll)}
        className={btnClass(value === "S")}
      >
        Senate
        {countS != null && (
          <span className={countClass(value === "S")}>{countS}</span>
        )}
      </button>
    </div>
  );
}

function btnClass(active: boolean): string {
  return `inline-flex items-center gap-[0.4rem] rounded-[6px] border-none px-[1.1rem] py-[0.55rem] text-base font-inherit transition-[background,color] duration-120 ease-in ${
    active
      ? "cursor-default bg-(--app-navy-active-bg) text-(--app-navy-active-text) font-bold"
      : "cursor-pointer bg-transparent text-(--app-navy-inactive-text) font-medium"
  }`;
}

function countClass(active: boolean): string {
  return `rounded px-1.5 py-px font-mono text-[0.7rem] font-semibold ${
    active
      ? "bg-(--app-navy-count-active-bg) text-(--app-navy-active-text)"
      : "bg-(--app-navy-count-bg) text-(--app-navy-count-text)"
  }`;
}
