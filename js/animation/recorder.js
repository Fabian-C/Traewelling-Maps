/**
 * In-Browser Video Recorder for Remotion Compositions
 * Records playback from HTML5 canvas using MediaRecorder API and WebM encoding
 */

export class RemotionRecorder {
    constructor(playerRef) {
        this.playerRef = playerRef;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.chunks = [];
    }

    async recordAndDownload({ filename = 'traewelling-journey.webm', onProgress = () => {} }) {
        if (!this.playerRef) {
            throw new Error('Player reference not found');
        }

        const container = document.getElementById('playerContainer');
        const canvas = container ? container.querySelector('canvas') : null;

        if (!canvas) {
            throw new Error('Canvas element not found in Remotion player. Ensure the player is rendered.');
        }

        // Seek to beginning
        this.playerRef.pause();
        this.playerRef.seekTo(0);

        // Capture canvas stream at 30 FPS
        const stream = canvas.captureStream(30);

        let mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }

        this.chunks = [];
        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 4500000 // 4.5 Mbps
        });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };

        const totalFrames = 180;
        const recordingPromise = new Promise((resolve, reject) => {
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                resolve();
            };
            this.mediaRecorder.onerror = reject;
        });

        this.mediaRecorder.start(100);
        this.isRecording = true;
        this.playerRef.play();

        // Monitor playback and finish when reached end
        const checkEnd = setInterval(() => {
            const currentFrame = this.playerRef.getCurrentFrame();
            onProgress(Math.min(100, Math.round((currentFrame / totalFrames) * 100)));

            if (currentFrame >= totalFrames - 2) {
                clearInterval(checkEnd);
                this.playerRef.pause();
                this.mediaRecorder.stop();
                this.isRecording = false;
            }
        }, 100);

        return recordingPromise;
    }
}

