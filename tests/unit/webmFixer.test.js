import { describe, it, expect } from 'vitest';
import fs from 'fs';
import {
    readVint,
    encodeVint,
    encodeUint,
    encodeFloat64,
    createEbmlElement,
    inspectWebM,
    fixWebM,
    EBML_ID
} from '../../js/animation/webmFixer.js';

describe('WebM & EBML Container Spec Fixer', () => {
    describe('VINT Encoding and Decoding', () => {
        it('correctly encodes and decodes 1-byte VINTs (values < 127)', () => {
            const values = [0, 1, 42, 100, 126];
            for (const val of values) {
                const encoded = encodeVint(val);
                expect(encoded.length).toBe(1);
                const decoded = readVint(encoded, 0);
                expect(decoded.value).toBe(val);
                expect(decoded.length).toBe(1);
                expect(decoded.isUnknown).toBe(false);
            }
        });

        it('correctly encodes and decodes 2-byte VINTs (127 <= values < 16383)', () => {
            const values = [127, 255, 1000, 16382];
            for (const val of values) {
                const encoded = encodeVint(val);
                expect(encoded.length).toBe(2);
                const decoded = readVint(encoded, 0);
                expect(decoded.value).toBe(val);
                expect(decoded.length).toBe(2);
                expect(decoded.isUnknown).toBe(false);
            }
        });

        it('correctly encodes and decodes 3-byte and 4-byte VINTs', () => {
            const val3 = 500000;
            const encoded3 = encodeVint(val3);
            expect(encoded3.length).toBe(3);
            expect(readVint(encoded3, 0).value).toBe(val3);

            const val4 = 100000000;
            const encoded4 = encodeVint(val4);
            expect(encoded4.length).toBe(4);
            expect(readVint(encoded4, 0).value).toBe(val4);
        });

        it('detects unknown length VINT markers', () => {
            const unknown1 = new Uint8Array([0xFF]);
            expect(readVint(unknown1, 0).isUnknown).toBe(true);

            const unknown8 = new Uint8Array([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
            expect(readVint(unknown8, 0).isUnknown).toBe(true);
        });
    });

    describe('Data Type Encoders', () => {
        it('encodes uints in minimal bytes', () => {
            expect(encodeUint(10).length).toBe(1);
            expect(encodeUint(300).length).toBe(2);
            expect(encodeUint(70000).length).toBe(3);
            expect(encodeUint(20000000).length).toBe(4);
        });

        it('encodes float64 in 8-byte big-endian IEEE 754', () => {
            const floatBytes = encodeFloat64(8000.0);
            expect(floatBytes.length).toBe(8);
            const view = new DataView(floatBytes.buffer);
            expect(view.getFloat64(0, false)).toBe(8000.0);
        });
    });

    describe('EBML Element Creation', () => {
        it('creates a well-formed EBML element with ID and VINT size', () => {
            const payload = new Uint8Array([1, 2, 3, 4]);
            const element = createEbmlElement(EBML_ID.DURATION, payload);
            expect(element.length).toBe(2 + 1 + 4); // 2 bytes ID (0x4489), 1 byte size (0x84), 4 bytes payload
            expect(element[0]).toBe(0x44);
            expect(element[1]).toBe(0x89);
            expect(element[2]).toBe(0x84);
            expect(Array.from(element.subarray(3))).toEqual([1, 2, 3, 4]);
        });
    });

    describe('WebM Inspection and Spec Compliance Fixes', () => {
        it('detects missing duration and cues in raw Chromium MediaRecorder streams', () => {
            if (fs.existsSync('/tmp/test_raw.webm')) {
                const rawBytes = fs.readFileSync('/tmp/test_raw.webm');
                const inspection = inspectWebM(rawBytes);
                expect(inspection.hasEbmlHeader).toBe(true);
                expect(inspection.hasSegment).toBe(true);
                expect(inspection.hasInfo).toBe(true);
                expect(inspection.hasTracks).toBe(true);
                // The raw stream has missing duration and cues:
                expect(inspection.hasDuration).toBe(false);
                expect(inspection.hasCues).toBe(false);
                expect(inspection.hasSeekHead).toBe(false);
                expect(inspection.isIndeterminateSegment).toBe(true);
            }
        });

        it('transforms raw WebM stream into fully spec-compliant seekable WebM', () => {
            if (fs.existsSync('/tmp/test_raw.webm')) {
                const rawBytes = fs.readFileSync('/tmp/test_raw.webm');
                const targetDuration = 2500.0;
                const fixed = fixWebM(rawBytes, { durationMs: targetDuration, fps: 30 });

                expect(fixed).toBeInstanceOf(Uint8Array);
                expect(fixed.length).toBeGreaterThan(rawBytes.length);

                const inspection = inspectWebM(fixed);
                expect(inspection.hasEbmlHeader).toBe(true);
                expect(inspection.hasSegment).toBe(true);
                expect(inspection.isIndeterminateSegment).toBe(false);
                expect(inspection.hasSeekHead).toBe(true);
                expect(inspection.hasInfo).toBe(true);
                expect(inspection.hasDuration).toBe(true);
                expect(inspection.durationMs).toBeCloseTo(targetDuration, 1);
                expect(inspection.hasTracks).toBe(true);
                expect(inspection.hasCues).toBe(true);
                expect(inspection.cueCount).toBeGreaterThanOrEqual(1);
            }
        });

        it('computes duration automatically from simple blocks when not explicitly provided', () => {
            if (fs.existsSync('/tmp/test_multi.webm')) {
                const rawBytes = fs.readFileSync('/tmp/test_multi.webm');
                const fixed = fixWebM(rawBytes, { fps: 30 });
                const inspection = inspectWebM(fixed);

                expect(inspection.hasDuration).toBe(true);
                // 90 frames at 30 fps is ~3000ms
                expect(inspection.durationMs).toBeGreaterThan(2800);
                expect(inspection.durationMs).toBeLessThan(3200);
                expect(inspection.hasCues).toBe(true);
                expect(inspection.hasSeekHead).toBe(true);
            }
        });
    });
});
