'use client';

import { useEffect, useRef, useCallback } from 'react';
import type Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { X } from 'lucide-react';

interface PlyrVideoModalProps {
  isOpen: boolean;
  src: string;
  title?: string;
  onClose: () => void;
}

export function PlyrVideoModal({ isOpen, src, title, onClose }: PlyrVideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Plyr | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Initialise/destroy Plyr when the modal opens/closes or src changes
  useEffect(() => {
    if (!isOpen || !videoRef.current) return;

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
  }, [isOpen, src]);

  // Lock body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label={title ?? 'Video player'}
    >
      {/* Modal panel — full viewport height, flex column so video takes remaining space */}
      <div className="relative flex flex-col w-full max-w-5xl mx-4 gap-2" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
        {/* Header bar */}
        <div className="flex items-center justify-between px-1 shrink-0">
          {title ? (
            <p className="text-sm font-medium text-neutral-200 truncate max-w-[calc(100%-3rem)]">
              {title}
            </p>
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            aria-label="Close video player"
          >
            <X size={18} />
          </button>
        </div>

        {/* Plyr video container — grows to fill remaining space, never overflows */}
        <div
          className="relative min-h-0 flex-1 rounded-2xl overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <video
            ref={videoRef}
            src={src}
            className="w-full h-full"
            style={{ maxHeight: 'calc(100dvh - 5rem)' }}
            playsInline
            preload="metadata"
          />
        </div>
      </div>
    </div>
  );
}
