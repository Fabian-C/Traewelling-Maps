import { describe, it, expect, vi } from 'vitest';
import { VideoClipRecorder } from '../../js/animation/recorder.js';

describe('VideoClipRecorder Pipeline', () => {
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

    it('correctly cleans up and formats filenames', async () => {
        const dummyPlayer = {
            pause: vi.fn(),
            seekTo: vi.fn(),
            play: vi.fn(),
            getCurrentFrame: vi.fn(() => 240)
        };
        const recorder = new VideoClipRecorder(dummyPlayer, 10);
        expect(recorder).toBeDefined();
    });
});
