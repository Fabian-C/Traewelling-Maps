import { describe, it, expect, beforeEach } from 'vitest';
import {
    tripsToGeoJSON,
    tripsToGPX,
    tripsToKML,
    tripsToCSV,
    tripsToJSON,
    parseGeoJSONToTrips,
    parseCSVToTrips
} from '../../js/export/geojson.js';
import { store } from '../../js/state/store.js';

describe('Data Export and Import System', () => {
    const mockTrip = {
        id: 1001,
        body: 'Traveling with @alice to Berlin!',
        createdAt: '2026-06-15T08:00:00Z',
        business: 1,
        ticket: { name: 'BahnCard 50' },
        tags: [{ key: 'trwl:wagon', value: '7' }, { key: 'trwl:seat', value: '42' }],
        backend_trip_id: 888123,
        co_passengers: [
            {
                status_id: 2002,
                user: { username: 'bob', name: 'Bob Traveler' },
                origin: 'Munich Hbf',
                destination: 'Berlin Hbf',
                departure_time: '2026-06-15T08:00:00Z',
                arrival_time: '2026-06-15T12:00:00Z'
            }
        ],
        bodyMentions: [{ username: 'alice' }],
        train: {
            trip: 888123,
            lineName: 'ICE 700',
            category: 'nationalExpress',
            totalDistance: 580000,
            distance: 580000,
            origin: {
                name: 'Munich Hbf',
                departurePlanned: '2026-06-15T08:00:00Z',
                departureReal: '2026-06-15T08:05:00Z',
                platform: '14',
                station: { name: 'Munich Hbf', latitude: 48.1402, longitude: 11.5583 }
            },
            destination: {
                name: 'Berlin Hbf',
                arrivalPlanned: '2026-06-15T12:00:00Z',
                arrivalReal: '2026-06-15T12:10:00Z',
                station: { name: 'Berlin Hbf', latitude: 52.5255, longitude: 13.3695 }
            },
            operator: { name: 'DB Fernverkehr AG' },
            seat: { number: '42', wagon: '7' },
            class: '1',
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [11.5583, 48.1402],
                        [11.0826, 49.4452],
                        [11.0303, 50.9738],
                        [13.3695, 52.5255]
                    ]
                },
                properties: { statusId: 1001 }
            }
        }
    };

    beforeEach(() => {
        store.initialize(() => ({
            username: 'testuser',
            fetchedTrips: [mockTrip],
            activeTrips: [mockTrip],
            layers: { data: new Map() }
        }));
    });

    describe('GeoJSON Export & Import', () => {
        it('exports enriched GeoJSON FeatureCollection preserving backend_trip_id, buddies, and co_passengers', () => {
            const geojson = tripsToGeoJSON([mockTrip], { username: 'testuser' });

            expect(geojson.type).toBe('FeatureCollection');
            expect(geojson.features.length).toBe(1);

            const props = geojson.features[0].properties;
            expect(props.statusId).toBe(1001);
            expect(props.id).toBe(1001);
            expect(props.lineName).toBe('ICE 700');
            expect(props.line).toBe('ICE 700');
            expect(props.category).toBe('nationalExpress');
            expect(props.origin).toBe('Munich Hbf');
            expect(props.destination).toBe('Berlin Hbf');
            expect(props.distanceKm).toBe(580);
            expect(props.totalDistance).toBe(580000);
            expect(props.backendTripId).toBe(888123);
            expect(props.backend_trip_id).toBe(888123);

            // Buddies extracted from co_passengers and text/body mentions
            expect(props.buddies).toBeInstanceOf(Array);
            const buddyUsernames = props.buddies.map(b => b.username);
            expect(buddyUsernames).toContain('alice');
            expect(buddyUsernames).toContain('bob');

            // Direct co_passengers list preserved
            expect(props.co_passengers).toBeInstanceOf(Array);
            expect(props.co_passengers.length).toBe(1);
            expect(props.co_passengers[0].status_id).toBe(2002);

            // Messages and tags preserved
            expect(props.message).toContain('Traveling with @alice');
            expect(props.body).toContain('Traveling with @alice');
            expect(props.tags).toBeInstanceOf(Array);
            expect(props.traewellingUrl).toBe('https://traewelling.de/status/1001');
        });

        it('parses GeoJSON FeatureCollection back into trips with complete fidelity', () => {
            const geojson = tripsToGeoJSON([mockTrip], { username: 'testuser' });
            const { trips, username } = parseGeoJSONToTrips(geojson);

            expect(trips.length).toBe(1);
            expect(username).toBe('testuser');

            const imported = trips[0];
            expect(imported.id).toBe(1001);
            expect(imported.backend_trip_id).toBe(888123);
            expect(imported.train.trip).toBe(888123);
            expect(imported.train.lineName).toBe('ICE 700');
            expect(imported.train.origin.name).toBe('Munich Hbf');
            expect(imported.train.destination.name).toBe('Berlin Hbf');
            expect(imported.train.totalDistance).toBe(580000);

            // Preserved co_passengers and buddies
            expect(imported.co_passengers.length).toBe(1);
            expect(imported.co_passengers[0].status_id).toBe(2002);
            expect(imported.buddies.length).toBeGreaterThanOrEqual(2);
            expect(imported.body).toContain('Traveling with @alice');

            // Preserved coordinates
            expect(imported.train.polyline.geometry.coordinates.length).toBe(4);
            expect(imported.train.origin.station.latitude).toBeCloseTo(48.1402, 3);
            expect(imported.train.destination.station.latitude).toBeCloseTo(52.5255, 3);
        });

        it('parses wrapped JSON trip array formats { trips: [...] }', () => {
            const payload = {
                generator: 'Träwelling Map Explorer',
                version: 1,
                username: 'customuser',
                trips: [mockTrip]
            };
            const { trips, username } = parseGeoJSONToTrips(payload);

            expect(trips.length).toBe(1);
            expect(trips[0].id).toBe(1001);
            expect(username).toBe('customuser');
        });
    });

    describe('GPX Export', () => {
        it('generates valid GPX 1.1 XML with tracks and interpolated timestamps', () => {
            const gpx = tripsToGPX([mockTrip], { username: 'testuser' });

            expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
            expect(gpx).toContain('<gpx version="1.1"');
            expect(gpx).toContain('<trk>');
            expect(gpx).toContain('<name>ICE 700: Munich Hbf → Berlin Hbf</name>');
            expect(gpx).toContain('<desc>Category: nationalExpress, Operator: DB Fernverkehr AG, Distance: 580 km</desc>');

            // Check trackpoints
            expect(gpx).toContain('<trkpt lat="48.1402" lon="11.5583">');
            expect(gpx).toContain('<trkpt lat="52.5255" lon="13.3695">');

            // Timestamps interpolated between 08:05:00Z and 12:10:00Z
            expect(gpx).toContain('<time>2026-06-15T08:05:00.000Z</time>');
            expect(gpx).toContain('<time>2026-06-15T12:10:00.000Z</time>');
        });
    });

    describe('KML Export', () => {
        it('generates valid KML 2.2 XML with placemarks and coordinate line strings', () => {
            const kml = tripsToKML([mockTrip], { username: 'testuser' });

            expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
            expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
            expect(kml).toContain('<Document>');
            expect(kml).toContain('<Placemark>');
            expect(kml).toContain('<name>ICE 700: Munich Hbf → Berlin Hbf</name>');
            expect(kml).toContain('<b>Line:</b> ICE 700');
            expect(kml).toContain('<b>Origin:</b> Munich Hbf');
            expect(kml).toContain('<b>Destination:</b> Berlin Hbf');
            expect(kml).toContain('https://traewelling.de/status/1001');

            // Coordinates in lon,lat,alt format
            expect(kml).toContain('11.5583,48.1402,0 11.0826,49.4452,0 11.0303,50.9738,0 13.3695,52.5255,0');
        });
    });

    describe('CSV Export & Import', () => {
        it('exports standard RFC 4180 CSV with all relevant trip and companion columns', () => {
            const csv = tripsToCSV([mockTrip]);
            const lines = csv.trim().split('\n');

            expect(lines.length).toBe(2);
            const header = lines[0];
            expect(header).toContain('"id"');
            expect(header).toContain('"line"');
            expect(header).toContain('"category"');
            expect(header).toContain('"origin"');
            expect(header).toContain('"destination"');
            expect(header).toContain('"buddies"');
            expect(header).toContain('"backend_trip_id"');
            expect(header).toContain('"traewelling_url"');

            const row = lines[1];
            expect(row).toContain('"1001"');
            expect(row).toContain('"ICE 700"');
            expect(row).toContain('"Munich Hbf"');
            expect(row).toContain('"Berlin Hbf"');
            expect(row).toContain('"888123"');
            expect(row).toContain('alice');
            expect(row).toContain('bob');
            expect(row).toContain('https://traewelling.de/status/1001');
        });

        it('parses exported CSV back into trip objects', () => {
            const csv = tripsToCSV([mockTrip]);
            const { trips } = parseCSVToTrips(csv);

            expect(trips.length).toBe(1);
            const trip = trips[0];
            expect(trip.id).toBe(1001);
            expect(trip.backend_trip_id).toBe(888123);
            expect(trip.train.lineName).toBe('ICE 700');
            expect(trip.train.origin.name).toBe('Munich Hbf');
            expect(trip.train.destination.name).toBe('Berlin Hbf');
            expect(trip.train.distance).toBe(580000);
            expect(trip.buddies.length).toBeGreaterThanOrEqual(2);
            expect(trip.body).toContain('Traveling with @alice');
        });

        it('handles CSV quotes and multi-line fields cleanly', () => {
            const csvWithCommas = `"id","line","origin","destination","notes"
"999","S 1","Hamburg Hbf","Wedel","Note with, comma and ""quotes"""`;
            const { trips } = parseCSVToTrips(csvWithCommas);

            expect(trips.length).toBe(1);
            expect(trips[0].id).toBe(999);
            expect(trips[0].train.lineName).toBe('S 1');
            expect(trips[0].train.origin.name).toBe('Hamburg Hbf');
            expect(trips[0].train.destination.name).toBe('Wedel');
            expect(trips[0].body).toBe('Note with, comma and "quotes"');
        });
    });

    describe('JSON Export', () => {
        it('exports standard JSON wrapper with metadata and trips array', () => {
            const json = tripsToJSON([mockTrip], { username: 'testuser' });

            expect(json.generator).toBe('Träwelling Map Explorer');
            expect(json.username).toBe('testuser');
            expect(json.tripCount).toBe(1);
            expect(json.trips[0].id).toBe(1001);
        });
    });
});
