import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Legislator } from '../types';
import { formatName, partyColor } from '../types';

// The map always shows current (2024-vintage) district boundaries and joins to
// currently-serving legislators. Switching the session in the header only
// affects vote history elsewhere in the app — the boundaries themselves do not
// change between 2024–2026 (Acts 1 & 5 of 2022 remain in force; Nairne v. Landry
// is stayed pending Louisiana v. Callais).

type Chamber = 'H' | 'S';
const ROLE: Record<Chamber, 'Rep' | 'Sen'> = { H: 'Rep', S: 'Sen' };
const COUNT: Record<Chamber, number> = { H: 105, S: 39 };

type FC = { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: { district: number } }[] };

// Imported through Vite's module graph (not public/), so the JSON files are
// served by Vite in dev — bypassing the Cloudflare Vite plugin's asset router,
// which doesn't pick up files added to public/ after startup. In prod, Vite
// emits each JSON as a separate chunk loaded only when /map is visited.
function loadDistricts(chamber: Chamber): Promise<FC> {
    return chamber === 'H'
        ? import('../data/districts-house.json').then((m) => m.default as unknown as FC)
        : import('../data/districts-senate.json').then((m) => m.default as unknown as FC);
}

export function DistrictMap() {
    const [chamber, setChamber] = useState<Chamber>('H');
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

    useEffect(() => {
        fetch('/api/legislators?active=1')
            .then((r) => r.json() as Promise<{ legislators: Legislator[] }>)
            .then((d) => setLegislators(d.legislators))
            .catch(() => {
                // Non-fatal — map still works for browsing; the side panel will show "Seat vacant" everywhere.
            });
    }, []);

    const byKey = useMemo(() => {
        const m = new Map<string, Legislator>();
        for (const l of legislators) {
            if (!l.role || !l.district) continue;
            m.set(`${l.role}-${l.district}`, l);
        }
        return m;
    }, [legislators]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const ml = await import('maplibre-gl');
                await import('maplibre-gl/dist/maplibre-gl.css');
                if (cancelled || !containerRef.current) return;
                const map = new ml.Map({
                    container: containerRef.current,
                    // OpenFreeMap "positron" — free public vector tiles, no API key,
                    // muted style designed as a backdrop for data overlays. Attribution
                    // (OpenStreetMap contributors) is required and shown by the default
                    // AttributionControl that ships with MapLibre.
                    style: 'https://tiles.openfreemap.org/styles/positron',
                    center: [-91.96, 30.99],
                    zoom: 5.9,
                    minZoom: 5.5,
                    maxZoom: 13,
                    maxBounds: [[-95.5, 28.0], [-87.5, 34.0]],
                });
                map.addControl(new ml.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
                map.on('load', () => {
                    if (cancelled) return;
                    mapRef.current = map;
                    mlRef.current = ml;
                    setMapReady(true);
                });
            } catch (err) {
                if (!cancelled) setMapError('Map failed to load. Use the district selector above to browse.');
                console.error('maplibre load failed', err);
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

            ['districts-fill', 'districts-line', 'districts-line-selected'].forEach((id) => {
                if (map.getLayer(id)) map.removeLayer(id);
            });
            if (map.getSource('districts')) map.removeSource('districts');

            map.addSource('districts', { type: 'geojson', data, promoteId: 'district' });

            // Insert district layers just below the basemap's first symbol (label)
            // layer so place names, road shields, and POI labels stay readable on top.
            const styleLayers = map.getStyle().layers ?? [];
            const firstLabelLayerId = styleLayers.find((l: { type?: string; id: string }) => l.type === 'symbol')?.id;

            map.addLayer(
                {
                    id: 'districts-fill',
                    type: 'fill',
                    source: 'districts',
                    paint: {
                        // Polygon fill colors the district by the party of the seat-holder.
                        // Vacant seats override any party value. Opacity rises on hover/select
                        // so the political shading remains visible across all interaction states.
                        'fill-color': [
                            'case',
                            ['boolean', ['feature-state', 'vacant'], false], '#9ca3af',
                            ['match', ['feature-state', 'party'],
                                'D', '#2563eb',
                                'R', '#dc2626',
                                'I', '#737373',
                                /* default */ '#9ca3af',
                            ],
                        ],
                        'fill-opacity': [
                            'case',
                            ['boolean', ['feature-state', 'selected'], false], 0.65,
                            ['boolean', ['feature-state', 'hover'], false],    0.45,
                            ['boolean', ['feature-state', 'vacant'], false],   0.22,
                            0.28,
                        ],
                    },
                },
                firstLabelLayerId,
            );

            map.addLayer(
                {
                    id: 'districts-line',
                    type: 'line',
                    source: 'districts',
                    paint: {
                        'line-color': '#1e40af',
                        'line-width': 0.7,
                        'line-opacity': 0.45,
                    },
                },
                firstLabelLayerId,
            );

            map.addLayer(
                {
                    id: 'districts-line-selected',
                    type: 'line',
                    source: 'districts',
                    paint: {
                        'line-color': '#1d4ed8',
                        'line-width': [
                            'case',
                            ['boolean', ['feature-state', 'selected'], false], 2.5,
                            0,
                        ],
                    },
                },
                firstLabelLayerId,
            );

            // Stamp vacant + party feature-state up-front so the political shading
            // and gray vacant fill are correct on first paint, before any hover/click.
            for (const feat of data.features) {
                const d = feat.properties.district;
                const leg = byKey.get(`${ROLE[chamber]}-${d}`);
                map.setFeatureState(
                    { source: 'districts', id: d },
                    { vacant: !leg, party: leg?.party ?? null },
                );
            }

            let hoveredId: number | null = null;
            const onMove = (e: { features?: Array<{ id: number }> }) => {
                if (!e.features?.length) return;
                const id = e.features[0].id as number;
                if (hoveredId !== null && hoveredId !== id) {
                    map.setFeatureState({ source: 'districts', id: hoveredId }, { hover: false });
                }
                hoveredId = id;
                map.setFeatureState({ source: 'districts', id }, { hover: true });
                map.getCanvas().style.cursor = 'pointer';
            };
            const onLeave = () => {
                if (hoveredId !== null) {
                    map.setFeatureState({ source: 'districts', id: hoveredId }, { hover: false });
                }
                hoveredId = null;
                map.getCanvas().style.cursor = '';
            };
            const onClick = (e: { features?: Array<{ properties: { district: number } }> }) => {
                if (!e.features?.length) return;
                setSelectedDistrict(e.features[0].properties.district);
            };
            map.on('mousemove', 'districts-fill', onMove);
            map.on('mouseleave', 'districts-fill', onLeave);
            map.on('click', 'districts-fill', onClick);
        })();
        return () => {
            cancelled = true;
        };
    }, [mapReady, chamber, byKey]);

    useEffect(() => {
        setSelectedDistrict(null);
    }, [chamber]);

    // Sync map highlight + fitBounds with the selected district (both click and dropdown paths).
    useEffect(() => {
        const map = mapRef.current;
        if (!mapReady || !map || !map.getSource('districts')) return;
        if (prevSelectedRef.current !== null && prevSelectedRef.current !== selectedDistrict) {
            map.setFeatureState({ source: 'districts', id: prevSelectedRef.current }, { selected: false });
        }
        prevSelectedRef.current = selectedDistrict;
        if (selectedDistrict !== null) {
            map.setFeatureState({ source: 'districts', id: selectedDistrict }, { selected: true });
            const feat = geoRef.current?.features.find((f) => f.properties.district === selectedDistrict);
            if (feat) {
                const b = bboxOf(feat.geometry);
                if (b) {
                    map.fitBounds(b, { padding: 60, duration: 600, maxZoom: 10 });
                }
            }
        }
    }, [selectedDistrict, mapReady]);

    const selectedLeg = selectedDistrict !== null ? byKey.get(`${ROLE[chamber]}-${selectedDistrict}`) ?? null : null;

    return (
        <>
            <p style={{ color: '#444', marginTop: 0 }}>
                Browse Louisiana's legislative districts. No address required. We don't ask for or store your location.
            </p>
            <p style={{ color: '#666', fontSize: '0.85rem', margin: '0 0 1rem' }}>
                Showing current (2024) district boundaries. To see how today's members voted on past bills, switch sessions in the header.
            </p>

            <div role="group" aria-label="District search controls" style={controlsStyle}>
                <div role="tablist" aria-label="Chamber" style={chamberToggleStyle}>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={chamber === 'H'}
                        onClick={() => setChamber('H')}
                        style={chamberToggleBtnStyle(chamber === 'H')}
                    >
                        House <span style={chamberCountStyle(chamber === 'H')}>105</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={chamber === 'S'}
                        onClick={() => setChamber('S')}
                        style={chamberToggleBtnStyle(chamber === 'S')}
                    >
                        Senate <span style={chamberCountStyle(chamber === 'S')}>39</span>
                    </button>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 260px' }}>
                    <span style={legendStyle}>District</span>
                    <select
                        value={selectedDistrict ?? ''}
                        onChange={(e) => setSelectedDistrict(e.target.value ? Number(e.target.value) : null)}
                        style={{ padding: '0.5rem', fontSize: '1rem', border: '1px solid #bbb', background: '#fff' }}
                    >
                        <option value="">— pick a district —</option>
                        {Array.from({ length: COUNT[chamber] }, (_, i) => i + 1).map((n) => {
                            const l = byKey.get(`${ROLE[chamber]}-${n}`);
                            const label = l ? `${formatName(l)} (${l.party ?? '—'})` : 'vacant';
                            return (
                                <option key={n} value={n}>
                                    District {n} — {label}
                                </option>
                            );
                        })}
                    </select>
                </label>

                <div role="presentation" aria-label="Party color legend" style={legendStripStyle}>
                    <LegendSwatch color="#2563eb" label="Democrat" />
                    <LegendSwatch color="#dc2626" label="Republican" />
                    <LegendSwatch color="#737373" label="Independent" />
                    <LegendSwatch color="#9ca3af" label="Vacant" />
                </div>
            </div>

            <aside style={panelStyle} aria-live="polite">
                    {selectedDistrict === null ? (
                        <p style={{ color: '#666', margin: 0 }}>Click a district or pick one above.</p>
                    ) : (
                        <>
                            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: '#5a6b80', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                                {chamber === 'H' ? 'House' : 'Senate'} District {selectedDistrict}
                            </div>
                            {selectedLeg ? (
                                <>
                                    <h3 style={{ margin: '0.5rem 0 0.25rem', fontSize: '1.4rem' }}>
                                        <a href={`#/legislator/${selectedLeg.people_id}`} style={{ color: '#1a1a1a' }}>
                                            {formatName(selectedLeg)}
                                        </a>
                                    </h3>
                                    <div style={{ color: partyColor(selectedLeg.party), fontWeight: 600 }}>
                                        {selectedLeg.party ?? '—'} · {selectedLeg.role === 'Sen' ? 'State Senator' : 'State Representative'}
                                    </div>
                                    <a href={`#/legislator/${selectedLeg.people_id}`} style={{ display: 'inline-block', marginTop: '0.75rem', color: '#1e3a5f' }}>
                                        See voting record →
                                    </a>
                                </>
                            ) : (
                                <p style={{ marginTop: '0.5rem', color: '#666' }}>
                                    Seat vacant. Active roster has no member assigned to this district.
                                </p>
                            )}
                        </>
                    )}
                </aside>
                <div style={{ position: 'relative', minHeight: 680 }}>
                    <div
                        ref={containerRef}
                        role="img"
                        aria-label={`Louisiana ${chamber === 'H' ? 'House' : 'Senate'} district map`}
                        style={{ width: '100%', height: 680, border: '1px solid #d6d2c4', borderRadius: 4 }}
                    />
                    {mapError && (
                        <div style={mapErrorStyle}>
                            {mapError}
                        </div>
                    )}
                </div>
        </>
    );
}

// Compute bounding box [[minLng, minLat], [maxLng, maxLat]] for a GeoJSON Polygon/MultiPolygon.
// Inline rather than pulling in turf, since this is the only geometry computation we do.
function bboxOf(geom: unknown): [[number, number], [number, number]] | null {
    const g = geom as { type: string; coordinates: unknown };
    if (!g || typeof g !== 'object') return null;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    const visit = (coords: unknown) => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
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
    return [[minLng, minLat], [maxLng, maxLat]];
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#444' }}>
            <span
                aria-hidden="true"
                style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: color,
                    border: '1px solid rgba(0,0,0,0.15)',
                    display: 'inline-block',
                }}
            />
            {label}
        </span>
    );
}

const controlsStyle: CSSProperties = {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    margin: '1rem 0 1.25rem',
};

const legendStyle: CSSProperties = {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.75rem',
    color: '#5a6b80',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    padding: '0 0.25rem',
};

const chamberToggleStyle: CSSProperties = {
    display: 'inline-flex',
    border: '1px solid #1e3a5f',
    borderRadius: 8,
    background: '#fff',
    padding: 3,
    gap: 2,
    flex: '0 0 auto',
};

function chamberToggleBtnStyle(active: boolean): CSSProperties {
    return {
        appearance: 'none',
        border: 'none',
        padding: '0.55rem 1.1rem',
        fontSize: '1rem',
        fontWeight: active ? 700 : 500,
        background: active ? '#1e3a5f' : 'transparent',
        color: active ? '#fff' : '#1e3a5f',
        cursor: active ? 'default' : 'pointer',
        borderRadius: 6,
        transition: 'background 120ms ease, color 120ms ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        fontFamily: 'inherit',
    };
}

function chamberCountStyle(active: boolean): CSSProperties {
    return {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '0.7rem',
        background: active ? 'rgba(255,255,255,0.18)' : 'rgba(30,58,95,0.10)',
        color: active ? '#fff' : '#1e3a5f',
        padding: '1px 6px',
        borderRadius: 4,
        fontWeight: 600,
    };
}

const legendStripStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.85rem',
    alignItems: 'center',
    paddingLeft: '0.25rem',
    flex: '1 1 100%',
};

const panelStyle: CSSProperties = {
    border: '1px solid #d6d2c4',
    background: '#fffdf7',
    padding: '1rem 1.25rem',
    borderRadius: 4,
    marginBottom: '0.75rem',
};

const mapErrorStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(245, 243, 238, 0.95)',
    color: '#5a6b80',
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.85rem',
    padding: '2rem',
    textAlign: 'center',
};
