// Fun facts train carriage cards module for data fetching
// Displays interesting trip information as stacked cards in right margin

const FACT_DISPLAY_DURATION = 4000; // 4 seconds before fade out
const FACT_COOLDOWN = 500; // Minimum ms between facts
const MAX_VISIBLE_FACTS = 4; // Maximum cards visible at once

const ICONS = {
    route: '🚂'
};

export const FunFacts = {
    container: null,
    isRunning: false,
    lastFactTime: 0,
    activeFacts: [],
    
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
        this.activeFacts = [];
        this.init();
        this.container.innerHTML = '';
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
    
    // Generate interesting fact from trip data with type
    generateFact(trips) {
        if (!trips || !trips.length) return null;
        
        const randomTrip = trips[Math.floor(Math.random() * trips.length)];
        if (!randomTrip) return null;
        
        const origin = randomTrip.train?.origin?.station?.name || randomTrip.train?.origin?.name;
        const destination = randomTrip.train?.destination?.station?.name || randomTrip.train?.destination?.name;
        const date = randomTrip.createdAt ? new Date(randomTrip.createdAt).toLocaleDateString('de-DE') : '';
        
        if (!origin || !destination || origin === 'unknown' || destination === 'unknown') return null;
        
        return { 
            text: date ? `${date}: ${origin} → ${destination}` : `${origin} → ${destination}`, 
            type: 'route'
        };
    },
    
    // Add a fact card to the stack
    addFact(fact) {
        if (!this.isRunning || !fact || !this.container) return;
        
        const now = Date.now();
        if (now - this.lastFactTime < FACT_COOLDOWN) return;
        
        // Limit to max 3 visible cards
        if (this.activeFacts.length >= MAX_VISIBLE_FACTS) return;
        
        this.lastFactTime = now;
        
        const element = document.createElement('div');
        element.className = `fun-fact ${fact.type}`;
        
        const icon = document.createElement('span');
        icon.className = 'fun-fact-icon';
        icon.textContent = ICONS[fact.type] || '📝';
        
        const text = document.createElement('span');
        text.className = 'fun-fact-text';
        text.textContent = fact.text;
        
        element.appendChild(icon);
        element.appendChild(text);
        
        // Prepend to stack at top (newest on top)
        this.container.insertBefore(element, this.container.firstChild);
        
        const factObj = { element, addedAt: now };
        this.activeFacts.push(factObj);
        
        // Clean up after animation completes (6 seconds)
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.activeFacts = this.activeFacts.filter(f => f !== factObj);
        }, FACT_DISPLAY_DURATION);
    },
    
    // Show facts from a batch of trips
    showFactsFromTrips(trips, count = 1) {
        if (!this.isRunning || !trips || !trips.length) return;
        
        for (let i = 0; i < count; i++) {
            const fact = this.generateFact(trips);
            if (fact) {
                setTimeout(() => this.addFact(fact), i * FACT_COOLDOWN);
            }
        }
    }
};
