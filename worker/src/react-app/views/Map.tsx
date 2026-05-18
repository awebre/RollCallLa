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

// Imported through Vite's module graph (not public/), so the JSON files are
// served by Vite in dev — bypassing the Cloudflare Vite plugin's asset router,
// which doesn't pick up files added to public/ after startup. In prod, Vite
// emits each JSON as a separate chunk loaded only when /map is visited.
function loadDistricts(chamber: Chamber): Promise<FC> {
  return chamber === "H"
    ? import("../data/districts-house.json").then(
        (m) => m.default as unknown as FC,
      )
    : import("../data/districts-senate.json").then(
        (m) => m.default as unknown as FC,
      );
}

export function DistrictMap() {
  const { current: currentSession } = useSession();
  const sessionId = currentSession?.session_id ?? null;
  const [chamber, setChamber] = useState<Chamber>("H");
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // Stored as `any` to avoid a hard import of maplibre-gl types from this module —
  // the library is loaded lazily so non-map routes don't pay the ~800 KB bundle cost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mlRef = useRef<any>(null);
  const prevSelectedRef = useRef<number | null>(null);
  const geoRef = useRef<FC | null>(null);
  // The map-click handler is registered inside the layer-setup effect, which only
  // re-runs on chamber change. To let it read the *current* selection (for the
  // "click again to zoom" behavior) without recreating the listener every render,
  // we keep selection in a ref synchronized to React state.
  const selectedDistrictRef = useRef<number | null>(null);

  useEffect(() => {
    // With a session selected, ask for "everyone who voted in that session"
    // (covers special-election successors + synthetic PDF-only rows).
    // Without one, fall back to the currently-serving roster.
    const url = sessionId
      ? `/api/legislators?session_id=${sessionId}`
      : "/api/legislators?active=1";
    fetch(url)
      .then((r) => r.json() as Promise<{ legislators: Legislator[] }>)
      .then((d) => setLegislators(d.legislators))
      .catch(() => {
        // Non-fatal — map still works for browsing; the side panel will show "Seat vacant" everywhere.
      });
  }, [sessionId]);

  // Index by (role, district). A single district may have multiple holders in
  // one session (resignations, mid-term deaths, special elections), so the
  // value is a list rather than a single legislator. Each list is sorted with
  // the most recent term-start first — that's the row used for the polygon's
  // party color; the rest show below in the side panel.
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
          // OpenFreeMap "positron" — free public vector tiles, no API key,
          // muted style designed as a backdrop for data overlays. Attribution
          // (OpenStreetMap contributors) is required and shown by the default
          // AttributionControl that ships with MapLibre.
          style: "https://tiles.openfreemap.org/styles/positron",
          center: [-91.96, 30.99],
          zoom: 5.9,
          minZoom: 5.5,
          maxZoom: 13,
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

  // (Re)load district polygons whenever chamber changes — and when the legislator
  // index changes, so vacant-district shading updates if the roster loads after the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    let cancelled = false;
    (async () => {
      const data = await loadDistricts(chamber);
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

      // Insert district layers just below the basemap's first symbol (label)
      // layer so place names, road shields, and POI labels stay readable on top.
      const styleLayers = map.getStyle().layers ?? [];
      const firstLabelLayerId = styleLayers.find(
        (l: { type?: string; id: string }) => l.type === "symbol",
      )?.id;

      map.addLayer(
        {
          id: "districts-fill",
          type: "fill",
          source: "districts",
          paint: {
            // Polygon fill colors the district by the party of the seat-holder.
            // Vacant seats override any party value. Opacity rises on hover/select
            // so the political shading remains visible across all interaction states.
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
                /* default */ "#9ca3af",
              ],
            ],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.65,
              ["boolean", ["feature-state", "hover"], false],
              0.45,
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
            "line-opacity": 0.45,
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

      // Stamp vacant + party feature-state up-front so the political shading
      // and gray vacant fill are correct on first paint, before any hover/click.
      // For districts with multiple holders this session, the most recent
      // holder (first in the sorted list) drives the polygon color.
      for (const feat of data.features) {
        const d = feat.properties.district;
        const list = byKey.get(`${ROLE[chamber]}-${d}`);
        const primary = list?.[0];
        map.setFeatureState(
          { source: "districts", id: d },
          { vacant: !primary, party: primary?.party ?? null },
        );
      }

      let hoveredId: number | null = null;
      const onMove = (e: { features?: Array<{ id: number }> }) => {
        if (!e.features?.length) return;
        const id = e.features[0].id as number;
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
        // First click on a polygon just selects it (panel updates, no camera move).
        // Clicking the already-selected polygon a second time zooms to its bounds.
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
  }, [mapReady, chamber, byKey]);

  useEffect(() => {
    setSelectedDistrict(null);
  }, [chamber]);

  // Keep the selected-district ref in sync with state so map-click handlers
  // (registered once per chamber) see the current selection.
  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict;
  }, [selectedDistrict]);

  // Sync map highlight with the selected district. Camera moves (fitBounds)
  // are handled separately by zoomToDistrict() — invoked on second-click of
  // an already-selected polygon or when the user picks from the dropdown.
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

  const selectedList: Legislator[] =
    selectedDistrict !== null
      ? (byKey.get(`${ROLE[chamber]}-${selectedDistrict}`) ?? [])
      : [];

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
              // Dropdown is an explicit "take me there" gesture — zoom in
              // so the picked district is centered, unlike the map-click
              // path which keeps the camera still on the first click.
              if (v !== null) zoomToDistrict(v);
            }}
            className="border border-(--app-border-input) bg-(--bg) px-2 py-2 text-base text-(--app-ink)"
          >
            <option value="">— pick a district —</option>
            {Array.from({ length: COUNT[chamber] }, (_, i) => i + 1).map(
              (n) => {
                const list = byKey.get(`${ROLE[chamber]}-${n}`) ?? [];
                const primary = list[0];
                const extra = list.length - 1;
                const label = primary
                  ? `${formatName(primary)} (${primary.party ?? "—"})${extra > 0 ? ` + ${extra} other` : ""}`
                  : "vacant";
                return (
                  <option key={n} value={n}>
                    District {n} — {label}
                  </option>
                );
              },
            )}
          </select>
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
            Click a district or pick one above.
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
                      className={`py-[0.6rem] ${i === 0 ? '' : 'border-t border-(--app-border-warm)'}`}
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

// Compute bounding box [[minLng, minLat], [maxLng, maxLat]] for a GeoJSON Polygon/MultiPolygon.
// Inline rather than pulling in turf, since this is the only geometry computation we do.
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
        <a href={`#/legislator/${leg.people_id}`} className="text-(--app-link)">
          {formatName(leg)}
        </a>
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
        <a href={`#/legislator/${leg.people_id}`} className="mt-3 inline-block text-(--app-link-navy)">
          See voting record →
        </a>
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
  return `inline-flex items-center gap-[0.4rem] rounded-[6px] border-none px-[1.1rem] py-[0.55rem] text-base font-inherit transition-[background,color] duration-120 ease-in ${active ? 'cursor-default bg-(--app-navy-active-bg) text-(--app-navy-active-text) font-bold' : 'cursor-pointer bg-transparent text-(--app-navy-inactive-text) font-medium'}`;
}

function chamberCountClass(active: boolean): string {
  return `rounded px-1.5 py-px font-mono text-[0.7rem] font-semibold ${active ? 'bg-(--app-navy-count-active-bg) text-(--app-navy-active-text)' : 'bg-(--app-navy-count-bg) text-(--app-navy-count-text)'}`;
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
