/**
 * Formatting and buddy extraction helpers for the Trips database and explorer
 */

import { escapeHtml } from '../utils/format.js';

/**
 * Extract all travel companions / buddies from checkin metadata, mentions, and text
 * @param {Object} trip - Raw journey / checkin record
 * @param {string} currentUser - Current session username to exclude from buddies
 * @returns {Array<{username: string, displayName: string}>}
 */
export function getTripBuddies(trip, currentUser = '') {
    if (!trip) return [];
    const buddies = new Map();
    const currentClean = (currentUser || '').toLowerCase().trim();

    const addBuddy = (u, display = '') => {
        if (!u || typeof u !== 'string') return;
        const clean = u.replace(/^@/, '').trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        if (currentClean && key === currentClean) return;
        if (!buddies.has(key)) {
            buddies.set(key, {
                username: clean,
                displayName: display || clean
            });
        }
    };

    // 1. Mentions array in bodyMentions or properties.bodyMentions
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') {
        try { mentions = JSON.parse(mentions); } catch { mentions = []; }
    }
    if (Array.isArray(mentions)) {
        mentions.forEach(m => {
            if (typeof m === 'string') {
                addBuddy(m);
            } else if (m && typeof m === 'object') {
                addBuddy(m.username || m.name, m.displayName || m.name || m.username);
            }
        });
    }

    // 2. Companions / buddies / fellowPassengers array
    let companions = trip.companions || trip.properties?.companions || trip.buddies || trip.properties?.buddies || trip.fellowPassengers;
    if (typeof companions === 'string') {
        try { companions = JSON.parse(companions); } catch { companions = []; }
    }
    if (Array.isArray(companions)) {
        companions.forEach(c => {
            if (typeof c === 'string') {
                addBuddy(c);
            } else if (c && typeof c === 'object') {
                addBuddy(c.username || c.name, c.displayName || c.name || c.username);
            }
        });
    }

    // 3. Regex @mentions in body text
    const body = trip.body || trip.properties?.body || '';
    if (typeof body === 'string' && body.includes('@')) {
        const matches = body.match(/@([a-zA-Z0-9_\-\.]+)/g);
        if (matches) {
            matches.forEach(m => addBuddy(m));
        }
    }

    return Array.from(buddies.values());
}

/**
 * Render comment/notes text safely with clickable @mention profile links
 * @param {string} text
 * @returns {string} Safe HTML string with linked @mentions
 */
export function renderLinkedComment(text) {
    if (!text || typeof text !== 'string') return '';
    const safe = escapeHtml(text);
    return safe.replace(/@([a-zA-Z0-9_\-\.]+)/g, (match, username) => {
        return `<a href="https://traewelling.de/profile/${encodeURIComponent(username)}" target="_blank" rel="noopener noreferrer" class="comment-mention-link" title="Open @${username} on Träwelling" onclick="event.stopPropagation()">@${username}</a>`;
    });
}

