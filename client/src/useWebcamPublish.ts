import { useEffect } from 'react';
import { DbConnection } from './module_bindings';

// Captures the local webcam to a canvas and relays JPEG frames through
// SpacetimeDB via the pushFrame reducer. One reducer call per CHANGED frame;
// the DB fans it out to subscribers. Energy-conscious by design:
//   - publish-on-change: skip frames that barely differ from the last sent one
//   - pause-when-hidden: stop entirely in background tabs
//   - stop when camera is off (no idle timer)
//   - modest fps/resolution
const FPS = 8;
const W = 320;
const H = 240;
const QUALITY = 0.45;
const DIFF_W = 16; // tiny thumbnail used for cheap change detection
const DIFF_H = 12;
const DIFF_THRESHOLD = 7; // mean abs luma delta below this = "unchanged"
const KEYFRAME_MS = 2000; // force a send at least this often

export function useWebcamPublish(
  conn: DbConnection | null,
  roomId: bigint,
  stream: MediaStream | null,
  camOn: boolean
) {
  useEffect(() => {
    if (!conn || !stream || !camOn) return; // no idle timer when camera is off

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const gctx = canvas.getContext('2d')!;

    const diff = document.createElement('canvas');
    diff.width = DIFF_W;
    diff.height = DIFF_H;
    const dctx = diff.getContext('2d', { willReadFrequently: true })!;

    let cancelled = false;
    let prevSample: Uint8ClampedArray | null = null;
    let lastSent = 0;

    const changedEnough = (now: number) => {
      dctx.drawImage(video, 0, 0, DIFF_W, DIFF_H);
      const cur = dctx.getImageData(0, 0, DIFF_W, DIFF_H).data;
      if (now - lastSent > KEYFRAME_MS) return true; // periodic keyframe
      if (!prevSample) return true;
      let sum = 0;
      for (let i = 0; i < cur.length; i += 4) {
        const a = (cur[i] + cur[i + 1] + cur[i + 2]) / 3;
        const b = (prevSample[i] + prevSample[i + 1] + prevSample[i + 2]) / 3;
        sum += Math.abs(a - b);
      }
      return sum / (cur.length / 4) > DIFF_THRESHOLD;
    };

    const tick = () => {
      if (cancelled || document.hidden || video.readyState < 2) return;
      const now = performance.now();
      if (!changedEnough(now)) return;
      prevSample = dctx.getImageData(0, 0, DIFF_W, DIFF_H).data;
      lastSent = now;
      gctx.drawImage(video, 0, 0, W, H);
      canvas.toBlob(
        async (blob) => {
          if (!blob || cancelled) return;
          const buf = new Uint8Array(await blob.arrayBuffer());
          try {
            conn.reducers.pushFrame({ roomId, data: buf });
          } catch {
            /* connection momentarily down */
          }
        },
        'image/jpeg',
        QUALITY
      );
    };

    const interval = setInterval(tick, 1000 / FPS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      video.srcObject = null;
    };
  }, [conn, roomId, stream, camOn]);
}
