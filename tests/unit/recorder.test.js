import { describe, it, expect, vi, afterEach } from 'vitest';
import { VideoClipRecorder } from '../../js/animation/recorder.js';

describe('VideoClipRecorder Pipeline', () => {
    const originalMediaRecorder = globalThis.MediaRecorder;

    afterEach(() => {
        globalThis.MediaRecorder = originalMediaRecorder;
    });

    it('initializes with default totalFrames and idle recording state', () => {
        const dummyPlayer = { pause: vi.fn(), seekTo: vi.fn(), play: vi.fn(), getCurrentFrame: vi.fn(() => 0) };
        const recorder = new VideoClipRecorder(dummyPlayer, 240);
        expect(recorder.totalFrames).toBe(240);
        expect(recorder.isRecording).toBe(false);
        expect(recorder.chunks).toEqual([]);
    });

    it('throws descriptive error if player reference is missing', async () => {
        const recorder = new VideoClipRecorder(null, 120);
        await expect(recorder.recordAndDownload({})).rejects.toThrow('Video player is not initialized yet.');
    });

    it('selects video/mp4 as optimal mime type when MP4 is supported', () => {
        globalThis.MediaRecorder = {
            isTypeSupported: vi.fn((mime) => mime.startsWith('video/mp4'))
        };
        const optimal = VideoClipRecorder.getOptimalMimeType();
        expect(optimal).toContain('video/mp4');
    });

    it('falls back to video/webm if video/mp4 is unsupported by browser', () => {
        globalThis.MediaRecorder = {
            isTypeSupported: vi.fn((mime) => mime === 'video/webm;codecs=vp9' || mime === 'video/webm')
        };
        const optimal = VideoClipRecorder.getOptimalMimeType();
        expect(optimal).toBe('video/webm;codecs=vp9');
    });

    it('defaults to video/mp4 if MediaRecorder API is undefined', () => {
        delete globalThis.MediaRecorder;
        const optimal = VideoClipRecorder.getOptimalMimeType();
        expect(optimal).toBe('video/mp4');
    });
});
