/**
 * VideoPlayer Component
 * Displays videos with controls and responsive sizing
 */
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  mode?: 'feed' | 'reels';
  className?: string;
  onLoad?: () => void;
  autoPlay?: boolean;
  muted?: boolean;
  shouldAutoPlayOnHover?: boolean;
  shouldAutoPlayOnMobileVisible?: boolean;
  isCardHovered?: boolean;
}

export function VideoPlayer({
  src,
  mode = 'feed',
  className = '',
  onLoad,
  autoPlay = false,
  muted = true,
  shouldAutoPlayOnHover = true,
  shouldAutoPlayOnMobileVisible = true,
  isCardHovered = false,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(muted);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTap = useRef(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const isReelsMode = mode === 'reels';
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // Set up intersection observer for mobile visibility detection
  useEffect(() => {
    if (!shouldAutoPlayOnMobileVisible || !isMobile || !containerRef.current) {
      return;
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.5 }
    );

    observerRef.current.observe(containerRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [shouldAutoPlayOnMobileVisible, isMobile]);

  // Sync video play state with React state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch((err) => {
        console.error('Video play failed:', err);
        setIsPlaying(false);
      });
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // Auto-play on hover (desktop) or when visible (mobile)
  useEffect(() => {
    const shouldPlay = (shouldAutoPlayOnHover && (isHovered || isCardHovered) && !isMobile) ||
      (shouldAutoPlayOnMobileVisible && isVisible && isMobile);

    if (shouldPlay && !isPlaying) {
      setIsPlaying(true);
    } else if (!shouldPlay && isPlaying && !autoPlay) {
      setIsPlaying(false);
    }
  }, [isHovered, isCardHovered, isVisible, isMobile, shouldAutoPlayOnHover, shouldAutoPlayOnMobileVisible, isPlaying, autoPlay]);

  // Sync mute state with React state
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = isMuted;
    }
  }, [isMuted]);

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
  };

  const handleLoadedData = () => {
    setIsLoading(false);
    onLoad?.();
  };

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    const err = video?.error;
    const codeMap: Record<number, string> = {
      1: 'MEDIA_ERR_ABORTED',
      2: 'MEDIA_ERR_NETWORK',
      3: 'MEDIA_ERR_DECODE',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    };

    const details = err
      ? {
        code: err.code,
        name: codeMap[err.code] || 'UNKNOWN',
        message: (err as any).message || undefined,
        currentSrc: video?.currentSrc,
      }
      : { currentSrc: video?.currentSrc };

    console.error('Video error:', details);
    setHasError(true);
    setIsLoading(false);
  };

  const handleFullscreen = () => {
    const video = videoRef.current;
    if (video?.requestFullscreen) {
      video.requestFullscreen();
    }
  };

  // Progress bar handlers
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && !isSeeking) {
      setCurrentTime(video.currentTime);
    }
  }, [isSeeking]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (video) {
      const time = parseFloat(e.target.value);
      video.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const handleSeekStart = useCallback(() => {
    setIsSeeking(true);
  }, []);

  const handleSeekEnd = useCallback(() => {
    setIsSeeking(false);
  }, []);

  const formatTime = (seconds: number): string => {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };
  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + 0.5, 4));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => {
      const newScale = Math.max(prev - 0.5, 1);
      if (newScale === 1) {
        setPosition({ x: 0, y: 0 });
      }
      return newScale;
    });
  }, []);

  const handleReset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Double tap to zoom
  const handleDoubleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (scale > 1) {
        handleReset();
      } else {
        setScale(2);
      }
    }
    lastTap.current = now;
  }, [scale, handleReset]);

  // Mouse drag for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y
      };
    }
  }, [scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y
      });
    }
  }, [isDragging, scale]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (hasError) {
    return (
      <div className={`w-full ${isReelsMode ? 'h-full' : 'min-h-50'} bg-gray-200 dark:bg-gray-800 flex items-center justify-center ${className}`}>
        <span className="text-gray-500 dark:text-gray-400">Video failed to load</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative ${isReelsMode ? 'w-full h-full flex items-center justify-center' : 'w-full'} bg-black group ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        handleMouseUp();
        setIsHovered(false);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onClick={handleDoubleTap}
      onTouchEnd={handleDoubleTap}
      style={{ cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default' }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
          <div className="w-8 h-8 border-4 border-gray-600 border-t-white rounded-full animate-spin"></div>
        </div>
      )}

      <video
        ref={videoRef}
        src={src}
        className={isReelsMode ? 'max-w-full max-h-full object-contain' : 'w-full h-auto object-contain'}
        style={{
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
        onLoadedData={handleLoadedData}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onError={handleError}
        muted={isMuted}
        playsInline
        controls={false}
        preload="metadata"
      />

      {/* Controls - visible on hover */}
      <div className="absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity bg-linear-to-t from-black via-transparent to-transparent pointer-events-none">
        {/* Progress Bar - Only shown on hover as part of full controls */}
        {!hasError && duration > 0 && !isPlaying && (
          <div className="flex flex-col items-center group/progress cursor-pointer pointer-events-auto px-4 pt-2">
            {/* Seek slider */}
            <input
              type="range"
              min="0"
              max={duration}
              value={currentTime}
              onChange={handleSeek}
              onMouseDown={handleSeekStart}
              onMouseUp={handleSeekEnd}
              onTouchStart={handleSeekStart}
              onTouchEnd={handleSeekEnd}
              className="w-full h-1 group-hover/progress:h-2 bg-gray-500 rounded-full appearance-none cursor-pointer transition-all hover:bg-gray-400 accent-red-500 slider"
              aria-label="Video progress"
              style={{
                background: `linear-gradient(to right, rgb(239, 68, 68) 0%, rgb(239, 68, 68) ${(currentTime / duration) * 100}%, rgb(107, 114, 128) ${(currentTime / duration) * 100}%, rgb(107, 114, 128) 100%)`
              }}
            />

            {/* Time display - visible on hover */}
            <div className="flex items-center justify-between w-full text-xs text-white opacity-0 group-hover/progress:opacity-100 transition-opacity mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-4 pointer-events-auto">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePlayPause();
              }}
              className="bg-white hover:bg-gray-200 text-black p-2 rounded-full transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleMuteToggle();
              }}
              className="bg-white hover:bg-gray-200 text-black p-2 rounded-full transition-colors"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleFullscreen();
            }}
            className="bg-white hover:bg-gray-200 text-black p-2 rounded-full transition-colors"
            aria-label="Fullscreen"
          >
            <Maximize2 size={20} />
          </button>
        </div>
      </div>

      {/* Minimal Progress Bar - Always visible when playing, independent of hover state */}
      {isPlaying && !hasError && duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center cursor-pointer pointer-events-auto px-4 py-2 group/minimal-progress hover:bg-black/10 transition-colors z-20">
          {/* Seek slider - minimal version */}
          <input
            type="range"
            min="0"
            max={duration}
            value={currentTime}
            onChange={handleSeek}
            onMouseDown={handleSeekStart}
            onMouseUp={handleSeekEnd}
            onTouchStart={handleSeekStart}
            onTouchEnd={handleSeekEnd}
            className="w-full h-0.5 group-hover/minimal-progress:h-1 bg-gray-500 rounded-full appearance-none cursor-pointer transition-all accent-red-500 slider-minimal"
            aria-label="Video progress"
            style={{
              background: `linear-gradient(to right, rgb(239, 68, 68) 0%, rgb(239, 68, 68) ${(currentTime / duration) * 100}%, rgb(107, 114, 128) ${(currentTime / duration) * 100}%, rgb(107, 114, 128) 100%)`
            }}
          />
        </div>
      )}

      {/* Zoom Controls - Only in reels mode */}
      {isReelsMode && !isLoading && !hasError && (
        <div className="absolute bottom-20 right-4 flex flex-col gap-2 z-20 pointer-events-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleZoomIn();
            }}
            className="bg-white/90 hover:bg-white text-black p-2 rounded-full shadow-lg transition-colors"
            aria-label="Zoom in"
          >
            <ZoomIn size={20} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleZoomOut();
            }}
            className="bg-white/90 hover:bg-white text-black p-2 rounded-full shadow-lg transition-colors"
            aria-label="Zoom out"
          >
            <ZoomOut size={20} />
          </button>
          {scale > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              className="bg-white/90 hover:bg-white text-black px-3 py-1 rounded-full shadow-lg transition-colors text-xs font-medium"
            >
              Reset
            </button>
          )}
        </div>
      )}

      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          opacity: 0;
          transition: opacity 0.2s;
        }

        .slider:hover::-webkit-slider-thumb {
          opacity: 1;
        }

        .slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          border: none;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .slider:hover::-moz-range-thumb {
          opacity: 1;
        }

        .slider-minimal::-webkit-slider-thumb {
          appearance: none;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          opacity: 0;
          transition: opacity 0.2s;
        }

        .slider-minimal:hover::-webkit-slider-thumb {
          opacity: 1;
        }

        .slider-minimal::-moz-range-thumb {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          border: none;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .slider-minimal:hover::-moz-range-thumb {
          opacity: 1;
        }

        video:fullscreen {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
      `}</style>
    </div>
  );
}
