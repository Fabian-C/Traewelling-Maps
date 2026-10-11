// State management compatibility module
import { store, initializeState } from './store.js';
import { createEmptyStats } from '../utils/data.js';

export function initializeAppState() {
    if (!store.get()) {
        return initializeState(createEmptyStats);
    }
    return store.get();
}

export { store };
