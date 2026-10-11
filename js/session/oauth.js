// OAuth 2.0 PKCE authentication module for Träwelling
import { CONFIG } from '../config/config.js';

function generateRandomString(length = 64) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const randomValues = new Uint8Array(length);
    window.crypto.getRandomValues(randomValues);
    return Array.from(randomValues).map(v => charset[v % charset.length]).join('');
}

function base64UrlEncode(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
}

export const OAuth = {
    /**
     * Redirects the user to Träwelling OAuth authorize endpoint
     */
    async startLogin() {
        const origin = window.location.origin;
        const isKnownOrigin = origin.includes('localhost') || 
                              origin.includes('127.0.0.1') || 
                              origin.includes('192.168.1.26') || 
                              origin.includes('fabian-c.github.io');

        if (!isKnownOrigin) {
            const proceed = confirm(
                `Note: Träwelling OAuth requires a pre-registered redirect domain. Your current host (${origin}) is not registered on Träwelling's OAuth client.\n\n` +
                `For local testing or unlisted hosts, please enter your Personal API Token in the dropdown instead.\n\n` +
                `Would you still like to try connecting with OAuth?`
            );
            if (!proceed) return;
        }

        const verifier = generateRandomString(64);
        const challenge = await generateCodeChallenge(verifier);
        const state = generateRandomString(32);
        const redirectUri = CONFIG.OAUTH.getRedirectUri();

        sessionStorage.setItem('tw_oauth_verifier', verifier);
        sessionStorage.setItem('tw_oauth_state', state);

        const params = new URLSearchParams({
            client_id: CONFIG.OAUTH.CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: CONFIG.OAUTH.SCOPES,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state: state
        });

        window.location.href = `${CONFIG.OAUTH.AUTHORIZE_URL}?${params.toString()}`;
    },

    /**
     * Checks if current URL has OAuth callback params (?code=...&state=...)
     * and exchanges code for access token if valid.
     */
    async checkForCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');
        const errorDesc = params.get('error_description');

        if (error) {
            console.error('OAuth authorization error:', error, errorDesc);
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
            const userMsg = error === 'invalid_client'
                ? 'Client authentication failed: This URL is not registered on Träwelling OAuth. Please use your Personal API Token from Träwelling Settings → Security instead.'
                : (errorDesc || error);
            throw new Error(userMsg);
        }

        if (!code) {
            return null;
        }

        const savedState = sessionStorage.getItem('tw_oauth_state');
        const verifier = sessionStorage.getItem('tw_oauth_verifier');

        // Always clean up sessionStorage state
        sessionStorage.removeItem('tw_oauth_state');
        sessionStorage.removeItem('tw_oauth_verifier');

        // Clean query parameters from URL bar without reloading
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);

        if (!state || state !== savedState) {
            console.error('OAuth state mismatch: possible CSRF or expired session');
            throw new Error('Authentication state verification failed.');
        }

        if (!verifier) {
            console.error('OAuth code verifier missing from session storage');
            throw new Error('PKCE verification code missing.');
        }

        const redirectUri = CONFIG.OAUTH.getRedirectUri();
        const payload = {
            grant_type: 'authorization_code',
            client_id: CONFIG.OAUTH.CLIENT_ID,
            redirect_uri: redirectUri,
            code_verifier: verifier,
            code: code
        };

        const response = await fetch(CONFIG.OAUTH.TOKEN_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `Token exchange failed with status ${response.status}`);
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || null,
            expiresIn: data.expires_in,
            tokenType: data.token_type
        };
    }
};
