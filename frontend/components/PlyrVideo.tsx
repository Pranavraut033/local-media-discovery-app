'use client';

import { useEffect, useRef } from 'react';
import type Plyr from 'plyr';
import 'plyr/dist/plyr.css';

interface PlyrVideoProps {
  src: string;
  poster?: string;
  className?: string;
}

// Inline Plyr player (full controls + Plyr's own fullscreen) used in the
// single-video reels view. Replaces the old popup (PlyrVideoModal) — same
// init/destroy lifecycle, no modal chrome.
export function PlyrVideo({ src, poster, className = '' }: PlyrVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    // React (dev) Strict Mode double-invokes this effect against the *same*
    // DOM node (mount → simulated cleanup → remount) before either import()
    // resolves. Bail before constructing Plyr for a stale run instead of
    // constructing-then-destroying — destroy() blanks the shared node's src
    // via Plyr's cancelRequests(), which would wipe out the real (second)
    // run's video too, leaving only the poster visible. React already
    // removes the node from the DOM on a genuine unmount, which is enough
    // for the browser to drop the in-flight request without us touching it.
    let cancelled = false;

    import('plyr').then(({ default: PlyrClass }) => {
      if (cancelled) return;
      const player = new PlyrClass(videoEl, {
        controls: [
          'play-large',
          'play',
          'rewind',
          'fast-forward',
          'progress',
          'current-time',
          'duration',
          'mute',
          'volume',
          'captions',
          'settings',
          'pip',
          'fullscreen',
        ],
        settings: ['captions', 'speed', 'loop'],
        // Plyr's own keyboard shortcuts default to a 10s arrow-key seek and
        // would fire alongside our custom handler below; keep it fully off.
        keyboard: { focused: false, global: false },
        clickToPlay: true,
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
        autoplay: true,
        loop: { active: true },
        resetOnEnd: false,
        tooltips: { controls: true, seek: true },
        captions: { active: false, language: 'auto', update: false },
        fullscreen: { enabled: true, fallback: true, iosNative: true },
      });
      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [src]);

  // Persistent top progress bar — updates directly via ref, bypassing React
  // state, since timeupdate fires several times a second.
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const update = () => {
      const bar = progressBarRef.current;
      if (!bar || !videoEl.duration) return;
      bar.style.width = `${(videoEl.currentTime / videoEl.duration) * 100}%`;
    };

    videoEl.addEventListener('timeupdate', update);
    videoEl.addEventListener('loadedmetadata', update);
    return () => {
      videoEl.removeEventListener('timeupdate', update);
      videoEl.removeEventListener('loadedmetadata', update);
    };
  }, [src]);

  // Left/Right tap = seek ±5s. Left/Right hold (>500ms) = fast playback
  // instead of seeking: 1.5x, bumped to 2x past 10s of holding. Space
  // play/pause, M mute. Kept local to this player (not Plyr's own keyboard
  // shortcuts, which bind ArrowUp/Down to volume globally and would fight
  // with the reels prev/next navigation in Feed/DiscoverView).
  useEffect(() => {
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let speedUpTimer: ReturnType<typeof setTimeout> | null = null;
    let holding = false;
    let activeKey: string | null = null;

    const clearTimers = () => {
      if (holdTimer) clearTimeout(holdTimer);
      if (speedUpTimer) clearTimeout(speedUpTimer);
      holdTimer = null;
      speedUpTimer = null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const player = playerRef.current;
      if (!player) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.repeat) return; // ignore OS key-repeat; we track our own hold timing
        activeKey = e.key;
        holdTimer = setTimeout(() => {
          holding = true;
          player.speed = 1.5;
          speedUpTimer = setTimeout(() => {
            player.speed = 2;
          }, 10000);
        }, 500);
      } else if (e.key === ' ') {
        e.preventDefault();
        player.togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        player.muted = !player.muted;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const player = playerRef.current;
      if (!player || e.key !== activeKey) return;

      clearTimers();
      if (holding) {
        player.speed = 1;
      } else {
        const delta = e.key === 'ArrowRight' ? 5 : -5;
        player.currentTime = Math.min(Math.max(player.currentTime + delta, 0), player.duration || Infinity);
      }
      holding = false;
      activeKey = null;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearTimers();
    };
  }, []);

  return (
    <div className={`plyr-video-host relative w-full h-full bg-black ${className}`}>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        muted
        playsInline
        preload="auto"
      />
      {/* Persistent playback progress, always visible above Plyr's own
          controls (which fade out) so position is readable at a glance. */}
      <div className="absolute top-0 left-0 right-0 z-20 h-1 bg-white/20">
        <div ref={progressBarRef} className="h-full bg-amber-400" style={{ width: '0%' }} />
      </div>
      {/* Plyr sizes itself off the video's intrinsic aspect ratio (padding-bottom
          hack) by default, which makes a portrait video taller than its container
          and pushes the controls off-screen. Force it to fill the host instead. */}
      <style>{`
        .plyr-video-host, .plyr-video-host .plyr {
          width: 100%;
          height: 100%;
        }
        .plyr-video-host .plyr--video,
        .plyr-video-host .plyr__video-wrapper {
          height: 100% !important;
          padding-bottom: 0 !important;
        }
        .plyr-video-host video {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain;
        }
      `}</style>
    </div>
  );
}
