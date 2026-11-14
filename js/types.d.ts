/**
 * @file Type definitions for Traewelling Maps
 * Conforms to upstream Träwelling API schemas (v1) and internal relational models.
 */

// ==========================================
// 1. Upstream Träwelling API Models
// ==========================================

export interface TraewellingUser {
    id: number;
    name: string;
    username: string;
    profilePicture?: string | null;
    avatar?: string | null;
    preventIndex?: boolean;
}

export interface TraewellingStation {
    id?: number | string;
    name: string;
    evaIdentifier?: number | string;
    ibnr?: number | string;
    eva?: number | string;
    eva_number?: number | string;
    latitude?: number | null;
    longitude?: number | null;
    country_code?: string | null;
    departure?: string | null;
    departurePlanned?: string | null;
    departureReal?: string | null;
    arrival?: string | null;
    arrivalPlanned?: string | null;
    arrivalReal?: string | null;
    platform?: string | null;
    platformPlanned?: string | null;
    platformReal?: string | null;
    departurePlatform?: string | null;
    departurePlatformPlanned?: string | null;
    departurePlatformReal?: string | null;
    arrivalPlatform?: string | null;
    arrivalPlatformPlanned?: string | null;
    arrivalPlatformReal?: string | null;
    isArrivalDelayed?: boolean;
    isDepartureDelayed?: boolean;
}

export interface TraewellingOperator {
    id?: number;
    name: string;
    identifier?: string;
}

export interface TraewellingStopover {
    id?: number | string;
    name: string;
    station: TraewellingStation;
    arrival?: string | null;
    arrivalPlanned?: string | null;
    arrivalReal?: string | null;
    departure?: string | null;
    departurePlanned?: string | null;
    departureReal?: string | null;
    platform?: string | null;
    platformPlanned?: string | null;
    platformReal?: string | null;
    isArrivalDelayed?: boolean;
    isDepartureDelayed?: boolean;
}

export interface TraewellingTrain {
    trip?: number | string;
    tripId?: number | string;
    hafasId?: string;
    journeyId?: string;
    category: string;
    number?: string | number;
    lineName: string;
    name?: string;
    operator?: TraewellingOperator | string;
    origin: TraewellingStation;
    destination: TraewellingStation;
    departure?: string;
    plannedDeparture?: string;
    arrival?: string;
    plannedArrival?: string;
    manualDeparture?: string;
    manualArrival?: string;
    duration?: number;
    totalDuration?: number;
    distance?: number;
    totalDistance?: number;
    polyline?: any;
    departureDelay?: number | null;
    arrivalDelay?: number | null;
}

/**
 * An upstream check-in status object returned by Träwelling API /user/statuses
 */
export interface TraewellingStatus {
    id: number;
    body: string;
    createdAt: string;
    business?: number;
    visibility?: number;
    user?: TraewellingUser;
    train?: TraewellingTrain;
    checkin?: TraewellingTrain;
    stopovers?: TraewellingStopover[];
    users?: TraewellingUser[];
    buddies?: CoPassenger[];
    co_passengers?: CoPassenger[];
    trip?: number | string;
    backend_trip_id?: number | null;
    polyline?: any;
    [key: string]: any;
}

// ==========================================
// 2. Co-Passengers & Travel Buddies
// ==========================================

export interface CoPassenger {
    username: string;
    name?: string;
    displayName?: string;
    avatar?: string | null;
    status_id?: number | string | null;
    origin?: string | null;
    destination?: string | null;
    departure_time?: string | null;
    arrival_time?: string | null;
    origin_station_id?: string | number | null;
    destination_station_id?: string | number | null;
    checkin?: {
        body?: string;
        origin?: { name?: string };
        destination?: { name?: string };
    };
    [key: string]: any;
}

export interface TravelBuddy {
    username: string;
    displayName: string;
    count?: number;
    status_id?: number | string | null;
}

// ==========================================
// 3. Normalized Relational Database Models (SessionDB)
// ==========================================

export interface NormalizedStation {
    id: string | number;
    name: string;
    latitude: number | null;
    longitude: number | null;
    eva_number: string | null;
    country_code: string | null;
}

export interface NormalizedTripRun {
    id: string;
    backend_trip_id: number | null;
    line_name: string;
    train_number: string | null;
    category: string;
    operator_name: string;
    origin_station_id: string | number | null;
    destination_station_id: string | number | null;
    polyline: any;
}

export interface NormalizedStatus {
    id: number;
    username: string;
    trip_id: string;
    backend_trip_id: number | null;
    origin_id: string | number | null;
    destination_id: string | number | null;
    departure_time: string;
    departure_planned: string | null;
    departure_platform: string | null;
    arrival_time: string;
    arrival_planned: string | null;
    arrival_platform: string | null;
    departure_delay: number;
    arrival_delay: number;
    distance_km: number;
    duration_min: number;
    business_type: string;
    body: string;
    created_at: string;
}

export interface CachedSessionSummary {
    username: string;
    displayName: string;
    avatar: string | null;
    tripCount: number;
    timestamp: number;
}

export interface CachedSession extends CachedSessionSummary {
    token?: string | null;
    trips?: TraewellingStatus[];
    co_passengers?: Record<string, CoPassenger[]>;
}

// ==========================================
// 4. Application State Store
// ==========================================

export interface TokenOwner {
    username: string | null;
    displayName: string | null;
    avatar: string | null;
    profileUrl: string | null;
    validated: boolean;
}

export interface FilterState {
    categories?: Record<string, boolean>;
    years?: Record<string, boolean>;
    includeNoteMentions?: boolean;
    dateFrom?: string | null;
    dateTo?: string | null;
    minDistance?: number;
    maxDistance?: number;
    minDelay?: number;
    businessType?: string;
}

export interface AppState {
    username: string | null;
    token: string | null;
    authMethod: string | null;
    tokenOwner: TokenOwner;
    fetchedTrips: TraewellingStatus[];
    filters: FilterState;
    map: any;
    layers: any;
    isLoading: boolean;
    [key: string]: any;
}
