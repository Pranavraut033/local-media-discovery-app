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

  useEffect(() => {
    if (!videoRef.current) return;

    let player: Plyr | null = null;

    import('plyr').then(({ default: PlyrClass }) => {
      if (!videoRef.current) return;
      player = new PlyrClass(videoRef.current, {
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
        keyboard: { focused: true, global: false },
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
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [src]);

  // Left/Right seek ±5s, Space play/pause, M mute. Kept local to this player
  // (not Plyr's own keyboard shortcuts, which bind ArrowUp/Down to volume
  // globally and would fight with the reels prev/next navigation in
  // Feed/DiscoverView).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const player = playerRef.current;
      if (!player) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? 5 : -5;
        player.currentTime = Math.min(Math.max(player.currentTime + delta, 0), player.duration || Infinity);
      } else if (e.key === ' ') {
        e.preventDefault();
        player.togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        player.muted = !player.muted;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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
