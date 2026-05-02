// Fun facts flying text module for data fetching
// Displays interesting trip information as flying text during data fetch

const MAX_VISIBLE_FACTS = 3;
const FACT_DURATION = 5000; // 5 seconds per fact
const FACT_COOLDOWN = 2000; // Minimum ms between facts

// Safe zones: top and bottom strips, avoiding the central UI
const SAFE_ZONES = [
    { yMin: 2, yMax: 12 },   // Top strip
    { yMin: 88, yMax: 96 },  // Bottom strip
];

export const FunFacts = {
    container: null,
    activeFacts: [],
    isRunning: false,
    lastFactTime: 0,
    nextZoneIndex: 0,
    
    init() {
        this.container = document.getElementById('funFactsContainer');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'funFactsContainer';
            this.container.className = 'fun-facts-container';
            document.body.appendChild(this.container);
        }
    },
    
    start() {
        this.isRunning = true;
        this.lastFactTime = 0;
        this.nextZoneIndex = 0;
        this.init();
    },
    
    stop() {
        this.isRunning = false;
        this.activeFacts.forEach(fact => {
            if (fact.element && fact.element.parentNode) {
                fact.element.parentNode.removeChild(fact.element);
            }
        });
        this.activeFacts = [];
    },
    
    // Generate interesting fact from trip data
    generateFact(trips) {
        if (!trips || !trips.length) return null;
        
        const randomTrip = trips[Math.floor(Math.random() * trips.length)];
        if (!randomTrip) return null;
        
        const factTypes = [
            () => {
                const destination = randomTrip.train?.destination?.station?.name || randomTrip.train?.destination?.name;
                const date = randomTrip.createdAt ? new Date(randomTrip.createdAt).toLocaleDateString('de-DE') : '';
                if (!destination || destination === 'unknown') return null;
                return date ? `${date} — travelled to ${destination}` : null;
            },
            () => {
                const origin = randomTrip.train?.origin?.station?.name || randomTrip.train?.origin?.name;
                const destination = randomTrip.train?.destination?.station?.name || randomTrip.train?.destination?.name;
                if (!origin || !destination || origin === 'unknown' || destination === 'unknown') return null;
                return `${origin}  →  ${destination}`;
            },
            () => {
                const line = randomTrip.train?.lineName || randomTrip.train?.number;
                const category = randomTrip.train?.category;
                if (!line || !category) return null;
                return `${category} ${line}`;
            },
        ];
        
        // Try up to 5 times to get a non-null fact
        for (let attempt = 0; attempt < 5; attempt++) {
            const factType = factTypes[Math.floor(Math.random() * factTypes.length)];
            const result = factType();
            if (result) return result;
        }
        return null;
    },
    
    // Display a flying fact
    showFact(fact) {
        if (!this.isRunning || !fact || !this.container) return;
        if (this.activeFacts.length >= MAX_VISIBLE_FACTS) return;
        
        const now = Date.now();
        if (now - this.lastFactTime < FACT_COOLDOWN) return;
        this.lastFactTime = now;
        
        const element = document.createElement('div');
        element.className = 'fun-fact';
        element.textContent = fact;
        
        // Pick a safe zone (alternate between top and bottom)
        const zone = SAFE_ZONES[this.nextZoneIndex % SAFE_ZONES.length];
        this.nextZoneIndex++;
        
        const yPos = zone.yMin + Math.random() * (zone.yMax - zone.yMin);
        
        // Start from right edge
        element.style.top = `${yPos}%`;
        element.style.left = '100%';
        element.style.animationDuration = `${FACT_DURATION}ms`;
        
        this.container.appendChild(element);
        
        const factObj = { element };
        this.activeFacts.push(factObj);
        
        // Remove after animation
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.activeFacts = this.activeFacts.filter(f => f !== factObj);
        }, FACT_DURATION);
    },
    
    // Show facts from a batch of trips
    showFactsFromTrips(trips, count = 1) {
        if (!this.isRunning || !trips || !trips.length) return;
        
        for (let i = 0; i < count; i++) {
            const fact = this.generateFact(trips);
            if (fact) {
                setTimeout(() => this.showFact(fact), i * FACT_COOLDOWN);
            }
        }
    }
};
