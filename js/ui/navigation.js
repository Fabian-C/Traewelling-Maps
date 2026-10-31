/**
 * Navigation Bar and Header Link Synchronizer
 * Preserves the active username parameter (?user=...) across top navigation cross-links
 * between Interactive Map, Trip Database, Rail Wrapped, and Documentation.
 */

export function syncNavigationLinks(username, doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) {
        return;
    }

    if (!username && typeof window !== 'undefined') {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            username = urlParams.get('user') || '';
        } catch {
            username = '';
        }
    }

    const cleanUser = (username || '').trim();
    const query = cleanUser ? `?user=${encodeURIComponent(cleanUser)}` : '';

    // Specific navigation buttons and header links across all pages
    const navSelectors = [
        '#navMapLink',
        '#navTripsLink',
        '#navWrappedLink',
        '#navDocsLink',
        '#navV2Link',
        '#menuTripsBtn',
        '#menuWrappedBtn',
        '#menuDocsBtn',
        '#statsWrappedLink',
        '.nav-link-btn',
        '.docs-nav-btn'
    ].join(', ');

    const linkElements = doc.querySelectorAll ? doc.querySelectorAll(navSelectors) : [];
    linkElements.forEach(link => {
        const rawHref = link.getAttribute('href') || '';
        // Skip external links, hashes, and links with specific trip targets
        if (!rawHref || rawHref.startsWith('http') || rawHref.startsWith('#') || rawHref.includes('trip=') || rawHref.includes('status=')) {
            return;
        }

        const targetPage = rawHref.split('?')[0];
        if (targetPage.endsWith('.html')) {
            link.setAttribute('href', `${targetPage}${query}`);
        }
    });
}
