import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Legislator } from "../types";
import { formatName } from "../types";
import { useSession } from "../SessionContext";
import { partyColorClass } from "../style/color-classes";
import { Link } from "wouter";

// District boundaries are TIGER 2024 (post-2022 redistricting; Acts 1 & 5 of
// 2022). They remain in force for the 2024–2026 sessions — Nairne v. Landry is
// stayed pending Louisiana v. Callais. Seat-holders, by contrast, ARE session-
// scoped: a session picker change re-keys the polygon-to-legislator join to
// the people who actually cast votes in that session (covers mid-term
// resignations, deaths, and special-election succession). Multiple holders per
// (role, district, session) are surfaced as a list in the side panel; map
// coloring follows the most recent holder by term_start.

type Chamber = "H" | "S";
const ROLE: Record<Chamber, "Rep" | "Sen"> = { H: "Rep", S: "Sen" };
const COUNT: Record<Chamber, number> = { H: 105, S: 39 };

type FC = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: unknown;
    properties: { district: number };
  }[];
};

type ZipEntry = {
  bbox: [[number, number], [number, number]];
  polygon: { type: string; coordinates: number[][][] | number[][][][] };
  H: number[];
  S: number[];
};

const GEO_BASE = import.meta.env.VITE_GEO_BASE_URL ?? '/geo';

function loadDistricts(chamber: Chamber, vintage: string): Promise<FC> {
  const file = chamber === "H" ? "house.json" : "senate.json";
  return fetch(`${GEO_BASE}/${vintage}/${file}`).then((r) => r.json() as Promise<FC>);
}

function loadZipDistricts(vintage: string): Promise<Record<string, ZipEntry>> {
  return fetch(`${GEO_BASE}/${vintage}/zip-districts.json`).then(
    (r) => r.json() as Promise<Record<string, ZipEntry>>,
  );
}

export function DistrictMap() {
  const { current: currentSession } = useSession();
  const sessionId = currentSession?.session_id ?? null;
  const vintage = currentSession?.map_vintage ?? "2022";
  const [chamber, setChamber] = useState<Chamber>("H");
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Zip code lookup state
  const [zipInput, setZipInput] = useState("");
  const [activeZip, setActiveZip] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const activeZipRef = useRef<string | null>(null);
  const zipDataRef = useRef<Record<string, ZipEntry> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // Stored as `any` to avoid a hard import of maplibre-gl types from this module —
  // the library is loaded lazily so non-map routes don't pay the ~800 KB bundle cost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mlRef = useRef<any>(null);
  const prevSelectedRef = useRef<number | null>(null);
  const geoRef = useRef<FC | null>(null);
  const selectedDistrictRef = useRef<number | null>(null);
  // ID of the first basemap symbol layer — used to insert overlays below labels.
  const firstLabelLayerRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const url = sessionId
      ? `/api/legislators?session_id=${sessionId}`
      : "/api/legislators?active=1";
    fetch(url)
      .then((r) => r.json() as Promise<{ legislators: Legislator[] }>)
      .then((d) => setLegislators(d.legislators))
      .catch(() => {});
  }, [sessionId]);

  // Load zip-districts lazily in the background; reload if vintage changes.
  useEffect(() => {
    loadZipDistricts(vintage).then((data) => {
      zipDataRef.current = data;
    });
  }, [vintage]);

  const byKey = useMemo(() => {
    const m = new Map<string, Legislator[]>();
    for (const l of legislators) {
      if (!l.role || !l.district) continue;
      const k = `${l.role}-${l.district}`;
      const arr = m.get(k);
      if (arr) arr.push(l);
      else m.set(k, [l]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const at = a.term_start ?? "";
        const bt = b.term_start ?? "";
        if (at !== bt) return bt.localeCompare(at);
        return a.people_id - b.people_id;
      });
    }
    return m;
  }, [legislators]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ml = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (cancelled || !containerRef.current) return;
        const map = new ml.Map({
          container: containerRef.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: [-91.96, 30.99],
          zoom: 5.9,
          minZoom: 5.5,
          maxZoom: 18,
          maxBounds: [
            [-95.5, 28.0],
            [-87.5, 34.0],
          ],
        });
        map.addControl(
          new ml.NavigationControl({
            showCompass: false,
            visualizePitch: false,
          }),
          "top-right",
        );
        map.on("load", () => {
          if (cancelled) return;
          mapRef.current = map;
          mlRef.current = ml;
          const styleLayers = map.getStyle().layers ?? [];
          firstLabelLayerRef.current = styleLayers.find(
            (l: { type?: string; id: string }) => l.type === "symbol",
          )?.id;
          setMapReady(true);
        });
      } catch (err) {
        if (!cancelled)
          setMapError(
            "Map failed to load. Use the district selector above to browse.",
          );
        console.error("maplibre load failed", err);
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    let cancelled = false;
    (async () => {
      const data = await loadDistricts(chamber, vintage);
      if (cancelled || !mapRef.current) return;
      geoRef.current = data;

      ["districts-fill", "districts-line", "districts-line-selected"].forEach(
        (id) => {
          if (map.getLayer(id)) map.removeLayer(id);
        },
      );
      if (map.getSource("districts")) map.removeSource("districts");

      map.addSource("districts", {
        type: "geojson",
        data,
        promoteId: "district",
      });

      const firstLabelLayerId = firstLabelLayerRef.current;

      map.addLayer(
        {
          id: "districts-fill",
          type: "fill",
          source: "districts",
          paint: {
            "fill-color": [
              "case",
              ["boolean", ["feature-state", "vacant"], false],
              "#9ca3af",
              [
                "match",
                ["feature-state", "party"],
                "D",
                "#2563eb",
                "R",
                "#dc2626",
                "I",
                "#737373",
                "#9ca3af",
              ],
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.65,
              ["boolean", ["feature-state", "hover"], false],
              0.45,
              ["boolean", ["feature-state", "dimmed"], false],
              0.07,
              ["boolean", ["feature-state", "vacant"], false],
              0.22,
              0.28,
            ],
          },
        },
        firstLabelLayerId,
      );

      map.addLayer(
        {
          id: "districts-line",
          type: "line",
          source: "districts",
          paint: {
            "line-color": "#1e40af",
            "line-width": 0.7,
            "line-opacity": [
              "case",
              ["boolean", ["feature-state", "dimmed"], false],
              0.1,
              0.45,
            ],
          },
        },
        firstLabelLayerId,
      );

      map.addLayer(
        {
          id: "districts-line-selected",
          type: "line",
          source: "districts",
          paint: {
            "line-color": "#1d4ed8",
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              2.5,
              0,
            ],
          },
        },
        firstLabelLayerId,
      );

      for (const feat of data.features) {
        const d = feat.properties.district;
        const list = byKey.get(`${ROLE[chamber]}-${d}`);
        const primary = list?.[0];
        map.setFeatureState(
          { source: "districts", id: d },
          { vacant: !primary, party: primary?.party ?? null },
        );
      }

      // If a zip was active when the chamber changed, re-apply dimming for
      // the new chamber's districts and re-stack the zip outline above them.
      if (activeZipRef.current && zipDataRef.current) {
        const entry = zipDataRef.current[activeZipRef.current];
        if (entry) applyZipFilter(entry, chamber);
      }

      let hoveredId: number | null = null;
      const onMove = (e: { features?: Array<{ id: number }> }) => {
        if (!e.features?.length) return;
        const id = e.features[0].id as number;

        // In zip mode, ignore hover for districts not matching the active zip
        const zip = activeZipRef.current;
        if (zip !== null && zipDataRef.current) {
          const entry = zipDataRef.current[zip];
          if (entry) {
            const matched = chamber === "H" ? entry.H : entry.S;
            if (!matched.includes(id)) {
              if (hoveredId !== null && hoveredId !== id) {
                map.setFeatureState(
                  { source: "districts", id: hoveredId },
                  { hover: false },
                );
                hoveredId = null;
              }
              map.getCanvas().style.cursor = "";
              return;
            }
          }
        }

        if (hoveredId !== null && hoveredId !== id) {
          map.setFeatureState(
            { source: "districts", id: hoveredId },
            { hover: false },
          );
        }
        hoveredId = id;
        map.setFeatureState({ source: "districts", id }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
      };
      const onLeave = () => {
        if (hoveredId !== null) {
          map.setFeatureState(
            { source: "districts", id: hoveredId },
            { hover: false },
          );
        }
        hoveredId = null;
        map.getCanvas().style.cursor = "";
      };
      const onClick = (e: {
        features?: Array<{ properties: { district: number } }>;
      }) => {
        if (!e.features?.length) return;
        const d = e.features[0].properties.district;

        // In zip mode, ignore clicks on non-matching districts
        const zip = activeZipRef.current;
        if (zip !== null && zipDataRef.current) {
          const entry = zipDataRef.current[zip];
          if (entry) {
            const matched = chamber === "H" ? entry.H : entry.S;
            if (!matched.includes(d)) return;
          }
        }

        if (selectedDistrictRef.current === d) {
          zoomToDistrict(d);
        } else {
          setSelectedDistrict(d);
        }
      };
      map.on("mousemove", "districts-fill", onMove);
      map.on("mouseleave", "districts-fill", onLeave);
      map.on("click", "districts-fill", onClick);
    })();
    return () => {
      cancelled = true;
    };
  }, [mapReady, chamber, byKey, vintage]);

  useEffect(() => {
    setSelectedDistrict(null);
  }, [chamber]);

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict;
  }, [selectedDistrict]);

  // Keep activeZipRef in sync so map-click handlers see current value
  useEffect(() => {
    activeZipRef.current = activeZip;
  }, [activeZip]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.getSource("districts")) return;
    if (
      prevSelectedRef.current !== null &&
      prevSelectedRef.current !== selectedDistrict
    ) {
      map.setFeatureState(
        { source: "districts", id: prevSelectedRef.current },
        { selected: false },
      );
    }
    prevSelectedRef.current = selectedDistrict;
    if (selectedDistrict !== null) {
      map.setFeatureState(
        { source: "districts", id: selectedDistrict },
        { selected: true },
      );
    }
  }, [selectedDistrict, mapReady]);

  function zoomToDistrict(d: number) {
    const map = mapRef.current;
    const feat = geoRef.current?.features.find(
      (f) => f.properties.district === d,
    );
    if (!map || !feat) return;
    const b = bboxOf(feat.geometry);
    if (b) map.fitBounds(b, { padding: 60, duration: 600, maxZoom: 11 });
  }

  function applyZipFilter(entry: ZipEntry, chamberKey: Chamber) {
    const map = mapRef.current;
    if (!map || !geoRef.current) return;
    const matched = chamberKey === "H" ? entry.H : entry.S;

    // Dim districts not in this zip; fully show matching ones.
    for (const feat of geoRef.current.features) {
      const d = feat.properties.district;
      map.setFeatureState(
        { source: "districts", id: d },
        { dimmed: !matched.includes(d) },
      );
    }

    // Draw the zip boundary as a highlighted outline.
    const fc = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: entry.polygon, properties: {} }],
    };
    if (map.getSource("zip-outline")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map.getSource("zip-outline") as any).setData(fc);
      // Keep outline above any freshly-re-added district layers.
      if (map.getLayer("zip-outline-line"))
        map.moveLayer("zip-outline-line", firstLabelLayerRef.current);
    } else {
      map.addSource("zip-outline", { type: "geojson", data: fc });
      map.addLayer(
        {
          id: "zip-outline-line",
          type: "line",
          source: "zip-outline",
          paint: { "line-color": "#ffffff", "line-width": 2.5 },
        },
        firstLabelLayerRef.current,
      );
    }
  }

  function removeZipFilter() {
    const map = mapRef.current;
    if (!map) return;
    if (geoRef.current) {
      for (const feat of geoRef.current.features) {
        map.setFeatureState(
          { source: "districts", id: feat.properties.district },
          { dimmed: false },
        );
      }
    }
    if (map.getLayer("zip-outline-line")) map.removeLayer("zip-outline-line");
    if (map.getSource("zip-outline")) map.removeSource("zip-outline");
  }

  function handleZipSubmit(zip: string) {
    if (zip.length !== 5) return;
    const data = zipDataRef.current;
    if (!data) {
      setZipError("Zip data loading, try again in a moment.");
      return;
    }
    const entry = data[zip];
    if (!entry) {
      setZipError(`${zip} not found in Louisiana.`);
      return;
    }
    setZipError(null);
    setActiveZip(zip);
    const map = mapRef.current;
    if (map) map.fitBounds(entry.bbox, { padding: 60, duration: 600 });
    applyZipFilter(entry, chamber);
  }

  function handleZipClear() {
    setZipInput("");
    setActiveZip(null);
    setZipError(null);
    removeZipFilter();
    // selectedDistrict is intentionally preserved per spec
  }

  const selectedList: Legislator[] =
    selectedDistrict !== null
      ? (byKey.get(`${ROLE[chamber]}-${selectedDistrict}`) ?? [])
      : [];

  const activeZipEntry =
    activeZip !== null ? zipDataRef.current?.[activeZip] : null;
  const zipMatchedDistricts = activeZipEntry
    ? chamber === "H"
      ? activeZipEntry.H
      : activeZipEntry.S
    : null;

  return (
    <>
      <p className="mt-0 text-(--app-text-mid)">
        Browse Louisiana's legislative districts. No address required. We don't
        ask for or store your location.
      </p>
      <p className="mb-4 mt-0 text-[0.85rem] text-(--app-text-muted)">
        District lines are the post-2022 maps (in force for the 2024 sessions
        onward). Seat-holders reflect who actually served in the session
        selected above — mid-session successors are listed in the panel.
      </p>

      <div
        role="group"
        aria-label="District search controls"
        className="my-4 flex flex-wrap items-end gap-4"
      >
        <div
          role="tablist"
          aria-label="Chamber"
          className="inline-flex flex-none gap-0.5 rounded-lg border border-(--app-navy-border) bg-(--app-navy-bg) p-0.75"
        >
          <button
            type="button"
            role="tab"
            aria-selected={chamber === "H"}
            onClick={() => setChamber("H")}
            className={chamberToggleBtnClass(chamber === "H")}
          >
            House <span className={chamberCountClass(chamber === "H")}>105</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={chamber === "S"}
            onClick={() => setChamber("S")}
            className={chamberToggleBtnClass(chamber === "S")}
          >
            Senate <span className={chamberCountClass(chamber === "S")}>39</span>
          </button>
        </div>

        <label className="flex min-w-65 flex-1 flex-col gap-1">
          <span className="px-1 font-mono text-[0.75rem] tracking-[1.5px] text-(--app-subtitle) uppercase">
            District
          </span>
          <select
            value={selectedDistrict ?? ""}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null;
              setSelectedDistrict(v);
              if (v !== null) zoomToDistrict(v);
            }}
            className="border border-(--app-border-input) bg-(--bg) px-2 py-2 text-base text-(--app-ink)"
          >
            <option value="">— pick a district —</option>
            {Array.from({ length: COUNT[chamber] }, (_, i) => i + 1).map(
              (n) => {
                const inZip =
                  zipMatchedDistricts !== null
                    ? zipMatchedDistricts.includes(n)
                    : true;
                const list = byKey.get(`${ROLE[chamber]}-${n}`) ?? [];
                const primary = list[0];
                const extra = list.length - 1;
                const label = primary
                  ? `${formatName(primary)} (${primary.party ?? "—"})${extra > 0 ? ` + ${extra} other` : ""}`
                  : "vacant";
                return (
                  <option key={n} value={n} disabled={!inZip}>
                    {inZip ? "" : "✕ "}District {n} — {label}
                  </option>
                );
              },
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="px-1 font-mono text-[0.75rem] tracking-[1.5px] text-(--app-subtitle) uppercase">
            Zip code
            {activeZip && zipMatchedDistricts !== null && (
              <span className="ml-2 normal-case tracking-normal font-sans font-normal text-(--app-text-muted)">
                · {zipMatchedDistricts.length} district
                {zipMatchedDistricts.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="70112"
              value={zipInput}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                setZipInput(v);
                if (v.length === 5) handleZipSubmit(v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleZipSubmit(zipInput);
                if (e.key === "Escape") handleZipClear();
              }}
              className="w-24 border border-(--app-border-input) bg-(--bg) px-2 py-2 font-mono text-base text-(--app-ink)"
              aria-label="Filter by zip code"
            />
            {activeZip && (
              <button
                type="button"
                onClick={handleZipClear}
                className="px-2 py-1.5 text-[1.1rem] leading-none text-(--app-text-muted) hover:text-(--app-ink)"
                aria-label="Clear zip filter"
              >
                ×
              </button>
            )}
          </div>
          {zipError && (
            <span className="px-1 text-[0.75rem] text-(--app-warn-text)">
              {zipError}
            </span>
          )}
        </label>

        <div
          role="presentation"
          aria-label="Party color legend"
          className="flex flex-1 basis-full flex-wrap items-center gap-[0.85rem] pl-1"
        >
          <LegendSwatch color="#2563eb" label="Democrat" />
          <LegendSwatch color="#dc2626" label="Republican" />
          <LegendSwatch color="#737373" label="Independent" />
          <LegendSwatch color="#9ca3af" label="Vacant" />
        </div>
      </div>

      <aside
        className="mb-3 rounded border border-(--app-border-warm) bg-(--app-surface-warm) px-5 py-4"
        aria-live="polite"
      >
        {selectedDistrict === null ? (
          <p className="m-0 text-(--app-text-muted)">
            {activeZip && zipMatchedDistricts !== null
              ? `Zip ${activeZip} spans ${zipMatchedDistricts.length} ${chamber === "H" ? "House" : "Senate"} district${zipMatchedDistricts.length === 1 ? "" : "s"}. Click one to see the member.`
              : "Click a district or pick one above."}
          </p>
        ) : (
          <>
            <div className="font-mono text-[0.8rem] tracking-[1.5px] text-(--app-subtitle) uppercase">
              {chamber === "H" ? "House" : "Senate"} District {selectedDistrict}
            </div>
            {selectedList.length === 0 ? (
              <p className="mt-2 text-(--app-text-muted)">
                {sessionId
                  ? "Seat vacant for the selected session. No member cast a vote for this district."
                  : "Seat vacant. Active roster has no member assigned to this district."}
              </p>
            ) : selectedList.length === 1 ? (
              <HolderRow leg={selectedList[0]} />
            ) : (
              <>
                <p className="mt-2 mb-3 text-[0.9rem] text-(--app-subtitle)">
                  {selectedList.length} members served this district during the
                  selected session:
                </p>
                <ol className="m-0 list-none p-0">
                  {selectedList.map((l, i) => (
                    <li
                      key={l.people_id}
                      className={`py-[0.6rem] ${i === 0 ? "" : "border-t border-(--app-border-warm)"}`}
                    >
                      <HolderRow leg={l} compact />
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </aside>
      <p className="mb-3 mt-0 text-[0.82rem] text-(--app-text-muted)">
        Not sure you've found your legislator?{" "}
        <a
          href="https://www.legis.la.gov/legis/findmylegislators.aspx"
          target="_blank"
          rel="noreferrer"
          className="text-(--app-link-ext)"
        >
          Search by address on the Louisiana Legislature site ↗
        </a>
      </p>
      <div className="relative min-h-170">
        <div
          ref={containerRef}
          role="img"
          aria-label={`Louisiana ${chamber === "H" ? "House" : "Senate"} district map`}
          className="h-170 w-full rounded border border-(--app-border-warm)"
        />
        {mapError && <div style={mapErrorStyle}>{mapError}</div>}
      </div>
    </>
  );
}

function bboxOf(geom: unknown): [[number, number], [number, number]] | null {
  const g = geom as { type: string; coordinates: unknown };
  if (!g || typeof g !== "object") return null;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  const visit = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lng, lat] = coords as [number, number];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) visit(c);
  };
  visit(g.coordinates);
  if (!isFinite(minLng)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

function HolderRow({
  leg,
  compact = false,
}: {
  leg: Legislator;
  compact?: boolean;
}) {
  const term =
    leg.term_start || leg.term_end
      ? `${leg.term_start ?? "—"} → ${leg.term_end ?? "present"}`
      : null;
  return (
    <>
      <h3 className={compact ? "mb-[0.15rem] mt-0 text-[1.1rem]" : "mb-1 mt-2 text-[1.4rem]"}>
        <Link href={`/legislator/${leg.people_id}`} className="text-(--app-link)">
          {formatName(leg)}
        </Link>
      </h3>
      <div
        className={`${partyColorClass(leg.party)} font-semibold ${compact ? "text-[0.9rem]" : "text-base"}`}
      >
        {leg.party ?? "—"} ·{" "}
        {leg.role === "Sen" ? "State Senator" : "State Representative"}
      </div>
      {term && (
        <div className="mt-[0.15rem] font-mono text-[0.75rem] text-(--app-subtitle)">
          Term: {term}
        </div>
      )}
      {!compact && (
        <Link href={`/legislator/${leg.people_id}`} className="mt-3 inline-block text-(--app-link-navy)">
          See voting record →
        </Link>
      )}
    </>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[0.4rem] text-[0.85rem] text-(--app-text-mid)">
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: color,
          border: "1px solid rgba(0,0,0,0.15)",
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function chamberToggleBtnClass(active: boolean): string {
  return `inline-flex items-center gap-[0.4rem] rounded-[6px] border-none px-[1.1rem] py-[0.55rem] text-base font-inherit transition-[background,color] duration-120 ease-in ${active ? "cursor-default bg-(--app-navy-active-bg) text-(--app-navy-active-text) font-bold" : "cursor-pointer bg-transparent text-(--app-navy-inactive-text) font-medium"}`;
}

function chamberCountClass(active: boolean): string {
  return `rounded px-1.5 py-px font-mono text-[0.7rem] font-semibold ${active ? "bg-(--app-navy-count-active-bg) text-(--app-navy-active-text)" : "bg-(--app-navy-count-bg) text-(--app-navy-count-text)"}`;
}

const mapErrorStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--app-surface-warm) 95%, transparent)",
  color: "var(--app-subtitle)",
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.85rem",
  padding: "2rem",
  textAlign: "center",
};
