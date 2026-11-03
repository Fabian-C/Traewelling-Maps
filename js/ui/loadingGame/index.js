/**
 * Loading Screen Mini-Game Manager (Modular Facade)
 * Decouples the data fetch orchestrator from specific game implementations.
 * Allows switching or removing games anytime by swapping or setting activeGame.
 */

import { CheckinRandomizer } from './checkinRandomizer.js';
import { DelayBingo } from './delayBingo.js';

export const LoadingGame = {
    // Current active game implementation (defaults to Check-in Text Randomizer)
    activeGame: CheckinRandomizer,

    /**
     * Set or swap the active game engine at runtime.
     * Pass null to disable loading games completely.
     * @param {Object|null} gameEngine Game engine with start(), stop(), onTripBatch() methods
     */
    setActiveGame(gameEngine) {
        if (this.activeGame && typeof this.activeGame.destroy === 'function') {
            this.activeGame.destroy();
        }
        this.activeGame = gameEngine || null;
    },

    /**
     * Initialize DOM containers if needed
     */
    init() {
        if (this.activeGame && typeof this.activeGame.init === 'function') {
            return this.activeGame.init();
        }
        return null;
    },

    /**
     * Start the loading game when data fetching begins
     * @param {Object} options Options including username and incremental flag
     */
    start(options = {}) {
        if (this.activeGame && typeof this.activeGame.start === 'function') {
            this.activeGame.start(options);
        }
    },

    /**
     * Notify the active game about a newly arrived batch of trips
     * @param {Array<Object>} trips Incoming trip records
     */
    onTripBatch(trips = []) {
        if (this.activeGame && typeof this.activeGame.onTripBatch === 'function') {
            this.activeGame.onTripBatch(trips);
        }
    },

    /**
     * Stop the game when fetch completes or cancels
     */
    stop() {
        if (this.activeGame && typeof this.activeGame.stop === 'function') {
            this.activeGame.stop();
        }
    },

    /**
     * Reset the game board/state
     */
    reset() {
        if (this.activeGame && typeof this.activeGame.reset === 'function') {
            this.activeGame.reset();
        }
    },

    /**
     * Destroy DOM elements and cleanup
     */
    destroy() {
        if (this.activeGame && typeof this.activeGame.destroy === 'function') {
            this.activeGame.destroy();
        }
    }
};

export { CheckinRandomizer, DelayBingo };
