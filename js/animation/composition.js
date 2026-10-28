/**
 * Remotion Video Composition for Träwelling Journeys
 * Self-contained in-browser motion graphics composition
 */

import React from 'https://esm.sh/react@18.3.1';
import htm from 'https://esm.sh/htm@3.1.1';
import {
    interpolate,
    spring,
    useCurrentFrame,
    useVideoConfig,
    AbsoluteFill
} from 'https://esm.sh/remotion@4.0.539?deps=react@18.3.1';

const html = htm.bind(React.createElement);

// Category colors matching CONFIG.LAYER_CONFIG
const CATEGORY_COLORS = {
    nationalExpress: '#0073ff',
    regionalExp: '#d1024e',
    national: '#00eeff',
    regional: '#a6026c',
    suburban: '#fc0000',
    bus: '#238443',
    tram: '#2FC5CC',
    subway: '#F69A00',
    taxi: '#f1c40f',
    plane: '#6366f1',
    ferry: '#0055aa',
    unknown: '#38bdf8'
};

export function TripStoryComposition({ trip, username = 'Traveler' }) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    if (!trip) {
        return html`
            <${AbsoluteFill} style=${{ backgroundColor: '#080a10', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                No trip data selected
            <//>
        `;
    }

    const train = trip.train || {};
    const category = train.category || 'regional';
    const categoryColor = CATEGORY_COLORS[category] || '#38bdf8';
    const lineName = train.lineName || 'Train';
    const origin = train.origin?.name || trip.origin || 'Origin';
    const dest = train.destination?.name || trip.destination || 'Destination';
    const distanceKm = train.totalDistance ? (train.totalDistance / 1000).toFixed(1) : (trip.distance ? (trip.distance / 1000).toFixed(1) : '124.5');
    const delayMinutes = typeof train.departureDelay === 'number' ? Math.round(train.departureDelay / 60) : 0;
    const note = trip.body || '';
    const buddies = Array.isArray(trip.bodyMentions) ? trip.bodyMentions.map(m => m.username) : [];
    const dateStr = trip.createdAt ? new Date(trip.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Journey';

    // Springs & Transitions
    const introSpring = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });
    const lineDrawProgress = interpolate(frame, [25, 120], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const outroSpring = spring({ frame: frame - 110, fps, config: { damping: 12, stiffness: 90 } });

    // Animated Telemetry Counter
    const animatedDistance = (parseFloat(distanceKm) * interpolate(frame, [30, 110], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })).toFixed(1);

    // Dynamic Route Line Geometry
    const polylineCoords = train.polyline?.geometry?.coordinates;
    const hasRealPolyline = Array.isArray(polylineCoords) && polylineCoords.length >= 2;

    // Track path calculation (SVG)
    let svgPathD = '';
    if (hasRealPolyline) {
        // Project normalized bounding coordinates to 600x320 SVG viewport
        const lons = polylineCoords.map(c => c[0]);
        const lats = polylineCoords.map(c => c[1]);
        const minX = Math.min(...lons), maxX = Math.max(...lons);
        const minY = Math.min(...lats), maxY = Math.max(...lats);
        const rangeX = maxX - minX || 0.001;
        const rangeY = maxY - minY || 0.001;

        const points = polylineCoords.map(([lon, lat]) => {
            const px = 50 + ((lon - minX) / rangeX) * 500;
            const py = 270 - ((lat - minY) / rangeY) * 220; // Invert Y
            return `${px.toFixed(1)},${py.toFixed(1)}`;
        });
        svgPathD = `M ${points.join(' L ')}`;
    } else {
        // Default graceful curved transit route
        svgPathD = 'M 60,250 C 180,100 420,290 540,140';
    }

    const strokeLength = 800;
    const strokeDashoffset = strokeLength * (1 - lineDrawProgress);

    return html`
        <${AbsoluteFill} style=${{
            backgroundColor: '#070913',
            backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(56, 189, 248, 0.18) 0%, rgba(7, 9, 19, 0) 75%), linear-gradient(180deg, #070913 0%, #0d1322 100%)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            color: '#f8fafc',
            padding: 40,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
            overflow: 'hidden'
        }}>
            <!-- Background Ambient Glow & Grid -->
            <div style=${{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
                opacity: 0.6,
                pointerEvents: 'none'
            }}></div>

            <!-- Scene Header: Branding & User -->
            <div style=${{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                zIndex: 10,
                transform: `translateY(${(1 - introSpring) * -30}px)`,
                opacity: introSpring
            }}>
                <div style=${{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style=${{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: 'linear-gradient(135deg, #38bdf8, #a855f7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        boxShadow: '0 0 20px rgba(56, 189, 248, 0.4)'
                    }}>🚄</div>
                    <div>
                        <div style=${{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>Träwelling</div>
                        <div style=${{ fontSize: 12, color: '#94a3b8' }}>@${username}</div>
                    </div>
                </div>
                <div style=${{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 14px',
                    borderRadius: 20,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#94a3b8'
                }}>
                    ${dateStr}
                </div>
            </div>

            <!-- Main Route Display Card -->
            <div style=${{
                background: 'rgba(15, 20, 35, 0.82)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 24,
                padding: '24px 28px',
                zIndex: 10,
                backdropFilter: 'blur(16px)',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
                transform: `scale(${0.9 + introSpring * 0.1})`,
                opacity: introSpring
            }}>
                <!-- Vehicle Badge & Line -->
                <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div style=${{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style=${{
                            backgroundColor: categoryColor,
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: 12,
                            padding: '4px 10px',
                            borderRadius: 6,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                        }}>${category}</span>
                        <span style=${{ fontSize: 22, fontWeight: 800, color: '#ffffff' }}>${lineName}</span>
                    </div>
                    <div style=${{
                        fontSize: 12,
                        fontWeight: 700,
                        padding: '4px 10px',
                        borderRadius: 12,
                        backgroundColor: delayMinutes > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(52, 211, 153, 0.2)',
                        color: delayMinutes > 0 ? '#f87171' : '#34d399',
                        border: `1px solid ${delayMinutes > 0 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(52, 211, 153, 0.4)'}`
                    }}>
                        ${delayMinutes > 0 ? `+${delayMinutes}m Delay` : '✓ On Time'}
                    </div>
                </div>

                <!-- Stations Flow -->
                <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style=${{ flex: 1 }}>
                        <div style=${{ fontSize: 11, textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: 4 }}>Departure</div>
                        <div style=${{ fontSize: 18, fontWeight: 700, color: '#f8fafc', lineHeight: 1.2 }}>${origin}</div>
                    </div>
                    <div style=${{
                        fontSize: 22,
                        color: categoryColor,
                        padding: '0 8px',
                        animation: 'pulse 2s infinite'
                    }}>➔</div>
                    <div style=${{ flex: 1, textAlign: 'right' }}>
                        <div style=${{ fontSize: 11, textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: 4 }}>Arrival</div>
                        <div style=${{ fontSize: 18, fontWeight: 700, color: '#f8fafc', lineHeight: 1.2 }}>${dest}</div>
                    </div>
                </div>
            </div>

            <!-- Central Animated Route Map Visualizer -->
            <div style=${{
                position: 'relative',
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                margin: '12px 0'
            }}>
                <svg viewBox="0 0 600 320" style=${{ width: '100%', height: '100%', overflow: 'visible' }}>
                    <!-- Glow Route Shadow Filter -->
                    <defs>
                        <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="6" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    <!-- Route Guide Line (Dotted Background) -->
                    <path
                        d=${svgPathD}
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.12)"
                        stroke-width="5"
                        stroke-dasharray="6,8"
                        stroke-linecap="round"
                    />

                    <!-- Animated Glowing Train Polyline Track -->
                    <path
                        d=${svgPathD}
                        fill="none"
                        stroke=${categoryColor}
                        stroke-width="5"
                        stroke-linecap="round"
                        stroke-dasharray=${strokeLength}
                        stroke-dashoffset=${strokeDashoffset}
                        filter="url(#routeGlow)"
                    />

                    <!-- Origin Point Node -->
                    <circle cx="60" cy="250" r="9" fill="#070913" stroke="#38bdf8" stroke-width="3" />
                    <circle cx="60" cy="250" r="4" fill="#38bdf8" />

                    <!-- Destination Point Node -->
                    <circle cx="540" cy="140" r="9" fill="#070913" stroke="#34d399" stroke-width="3" />
                    <circle cx="540" cy="140" r="4" fill=${lineDrawProgress >= 0.95 ? '#34d399' : 'rgba(255,255,255,0.2)'} />
                </svg>

                <!-- Floating Traveling Train Particle -->
                <div style=${{
                    position: 'absolute',
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: categoryColor,
                    boxShadow: `0 0 25px ${categoryColor}, 0 0 10px #ffffff`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    transform: `translate(${interpolate(lineDrawProgress, [0, 1], [-220, 220])}px, ${interpolate(lineDrawProgress, [0, 0.5, 1], [60, -30, -50])}px)`,
                    opacity: interpolate(frame, [20, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                    transition: 'box-shadow 0.2s ease'
                }}>
                    🚆
                </div>
            </div>

            <!-- Real-time Journey Telemetry HUD -->
            <div style=${{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 14,
                zIndex: 10,
                marginBottom: 12
            }}>
                <div style=${{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 16,
                    padding: '14px 16px',
                    textAlign: 'center'
                }}>
                    <div style=${{ fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>Distance</div>
                    <div style=${{ fontSize: 20, fontWeight: 800, color: '#38bdf8', marginTop: 4 }}>
                        ${animatedDistance} <span style=${{ fontSize: 12, fontWeight: 500 }}>km</span>
                    </div>
                </div>

                <div style=${{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 16,
                    padding: '14px 16px',
                    textAlign: 'center'
                }}>
                    <div style=${{ fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>CO₂ Saved</div>
                    <div style=${{ fontSize: 20, fontWeight: 800, color: '#34d399', marginTop: 4 }}>
                        ~${(parseFloat(animatedDistance) * 0.14).toFixed(1)} <span style=${{ fontSize: 12, fontWeight: 500 }}>kg</span>
                    </div>
                </div>

                <div style=${{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 16,
                    padding: '14px 16px',
                    textAlign: 'center'
                }}>
                    <div style=${{ fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>Status</div>
                    <div style=${{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginTop: 6 }}>
                        ${lineDrawProgress >= 1 ? 'Arrived 🎉' : 'In Transit'}
                    </div>
                </div>
            </div>

            <!-- Notes & Travel Companions (Spring in on second half) -->
            ${(note || buddies.length > 0) ? html`
                <div style=${{
                    background: 'rgba(168, 85, 247, 0.12)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    borderRadius: 16,
                    padding: '12px 18px',
                    zIndex: 10,
                    transform: `translateY(${(1 - outroSpring) * 20}px)`,
                    opacity: outroSpring
                }}>
                    ${buddies.length > 0 ? html`
                        <div style=${{ fontSize: 12, color: '#d8b4fe', fontWeight: 600, marginBottom: note ? 4 : 0 }}>
                            👥 Companions: ${buddies.map(b => `@${b}`).join(', ')}
                        </div>
                    ` : null}
                    ${note ? html`
                        <div style=${{ fontSize: 13, color: '#f8fafc', fontStyle: 'italic', lineHeight: 1.3 }}>
                            "${note}"
                        </div>
                    ` : null}
                </div>
            ` : null}
        <//>
    `;
}

