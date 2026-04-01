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
  const [isPlaying, setIsPlaying] = useState(false);
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
  const shouldAutoPlay = autoPlay ||
    ((shouldAutoPlayOnHover && (isHovered || isCardHovered) && !isMobile) ||
      (shouldAutoPlayOnMobileVisible && isVisible && isMobile));
  const showExpandedControls = !isReelsMode && (isHovered || isSeeking);
  const showProgressInExpandedControls = !hasError && duration > 0 && showExpandedControls;
  const showBottomPlayingProgress = !isReelsMode && !hasError && duration > 0 && isPlaying && !showExpandedControls;
  const showStaticReelsControls = isReelsMode && !hasError;
  const progressPercent = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  const stopEventPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

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

  // Keep the media element aligned with the desired autoplay behavior.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (shouldAutoPlay) {
      video.play().catch((err) => {
        console.error('Video play failed:', err);
      });
    } else {
      video.pause();
    }
  }, [shouldAutoPlay]);

  // Sync mute state with React state
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = isMuted;
    }
  }, [isMuted]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch((err) => {
        console.error('Video play failed:', err);
      });
      return;
    }

    video.pause();
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
          message: (err as { message?: string }).message || undefined,
          currentSrc: video?.currentSrc,
        }
      : { currentSrc: video?.currentSrc };

    console.error('Video error:', details);
    setHasError(true);
    setIsLoading(false);
    setIsPlaying(false);
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
  const handleDoubleTap = useCallback(() => {
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
    <div className={`${isReelsMode ? 'w-full h-full flex flex-col bg-black' : ''} ${className}`}>
      <div
        ref={containerRef}
        className={`relative ${isReelsMode ? 'w-full flex-1 flex items-center justify-center' : 'w-full'} bg-black group`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp();
          setIsHovered(false);
        }}
        onMouseEnter={() => {
          if (!isReelsMode) {
            setIsHovered(true);
          }
        }}
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
        loop
        onLoadedData={handleLoadedData}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={handleError}
        muted={isMuted}
        playsInline
        controls={false}
        preload="metadata"
      />

      {/* Expanded controls - visible while hovering/seeking */}
      <div className={`absolute inset-x-0 bottom-0 flex flex-col justify-end transition-opacity bg-linear-to-t from-black/70 via-black/20 to-transparent pointer-events-none ${showExpandedControls ? 'opacity-100' : 'opacity-0'}`}>
        {/* Progress bar above action buttons when media is hovered */}
        {showProgressInExpandedControls && (
          <div
            className="flex flex-col items-center group/progress pointer-events-auto px-4 pt-2"
            onClick={stopEventPropagation}
            onMouseDown={stopEventPropagation}
            onTouchStart={stopEventPropagation}
            onTouchEnd={stopEventPropagation}
          >
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
              onClick={stopEventPropagation}
              onPointerDown={stopEventPropagation}
              onPointerUp={stopEventPropagation}
              className="w-full h-1 bg-gray-500 rounded-full appearance-none cursor-pointer transition-colors hover:bg-gray-400 accent-red-500 slider"
              aria-label="Video progress"
              style={{
                background: `linear-gradient(to right, rgb(239, 68, 68) 0%, rgb(239, 68, 68) ${progressPercent}%, rgb(107, 114, 128) ${progressPercent}%, rgb(107, 114, 128) 100%)`
              }}
            />

            {/* Time display - visible on hover */}
            <div className="flex items-center justify-between w-full text-xs text-white opacity-0 group-hover/progress:opacity-100 transition-opacity mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        )}

        <div
          className="flex items-center justify-between p-4 pointer-events-auto"
          onClick={stopEventPropagation}
          onMouseDown={stopEventPropagation}
          onTouchStart={stopEventPropagation}
          onTouchEnd={stopEventPropagation}
        >
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

      {/* Minimal progress bar at bottom while playing and not hovering */}
      {showBottomPlayingProgress && (
        <div
          className="absolute bottom-0 left-0 right-0 flex flex-col items-center pointer-events-auto px-4 py-2 group/minimal-progress hover:bg-black/10 transition-colors z-20"
          onClick={stopEventPropagation}
          onMouseDown={stopEventPropagation}
          onTouchStart={stopEventPropagation}
          onTouchEnd={stopEventPropagation}
        >
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
            onClick={stopEventPropagation}
            onPointerDown={stopEventPropagation}
            onPointerUp={stopEventPropagation}
            className="w-full h-1 bg-gray-500 rounded-full appearance-none cursor-pointer transition-colors accent-red-500 slider-minimal"
            aria-label="Video progress"
            style={{
              background: `linear-gradient(to right, rgb(239, 68, 68) 0%, rgb(239, 68, 68) ${progressPercent}%, rgb(107, 114, 128) ${progressPercent}%, rgb(107, 114, 128) 100%)`
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

      </div>

      {showStaticReelsControls && (
        <div
          className="bg-black/95 border-t border-white/15 p-3 space-y-2"
          onClick={stopEventPropagation}
          onMouseDown={stopEventPropagation}
          onTouchStart={stopEventPropagation}
          onTouchEnd={stopEventPropagation}
        >
          {duration > 0 && (
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
              onClick={stopEventPropagation}
              onPointerDown={stopEventPropagation}
              onPointerUp={stopEventPropagation}
              className="w-full h-1 bg-gray-500 rounded-full appearance-none cursor-pointer accent-red-500 slider"
              aria-label="Video progress"
              style={{
                background: `linear-gradient(to right, rgb(239, 68, 68) 0%, rgb(239, 68, 68) ${progressPercent}%, rgb(107, 114, 128) ${progressPercent}%, rgb(107, 114, 128) 100%)`
              }}
            />
          )}

          <div className="flex items-center justify-between text-xs text-white/90">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlayPause();
                }}
                className="bg-white hover:bg-gray-200 text-black p-2 rounded-full transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMuteToggle();
                }}
                className="bg-white hover:bg-gray-200 text-black p-2 rounded-full transition-colors"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
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
              <Maximize2 size={18} />
            </button>
          </div>
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
