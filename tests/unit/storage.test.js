import { describe, it, expect, beforeEach } from 'vitest';
import { Storage, STORAGE_KEYS } from '../../js/storage/storage.js';

describe('Storage manager', () => {
    beforeEach(() => {
        Storage.remove('test_key');
        Storage.remove(STORAGE_KEYS.TOKEN);
    });

    it('exposes defined storage key constants', () => {
        expect(STORAGE_KEYS.TOKEN).toBe('tw_token');
        expect(STORAGE_KEYS.AUTH_METHOD).toBe('tw_auth_method');
        expect(STORAGE_KEYS.STUDIO_TABLE_MODE).toBe('tw_studio_table_mode');
    });

    it('sets and gets simple string values with fallback', () => {
        expect(Storage.get('non_existent', 'default')).toBe('default');
        Storage.set('test_key', 'hello_world');
        expect(Storage.get('test_key')).toBe('hello_world');
        Storage.remove('test_key');
        expect(Storage.get('test_key', 'fallback')).toBe('fallback');
    });

    it('handles JSON objects and invalid JSON safely', () => {
        const obj = { id: 42, active: true, list: ['a', 'b'] };
        Storage.setJSON('test_json', obj);
        expect(Storage.getJSON('test_json')).toEqual(obj);

        // Corrupted JSON returns fallback without throwing
        Storage.set('test_corrupted', '{bad json');
        expect(Storage.getJSON('test_corrupted', { fallback: true })).toEqual({ fallback: true });

        Storage.remove('test_json');
        Storage.remove('test_corrupted');
    });

    it('manages session storage keys', () => {
        expect(Storage.getSession('sess_key', 'none')).toBe('none');
        Storage.setSession('sess_key', 'verifier_xyz');
        expect(Storage.getSession('sess_key')).toBe('verifier_xyz');
        Storage.removeSession('sess_key');
        expect(Storage.getSession('sess_key')).toBeNull();
    });
});
