/**
 * ImageViewer Component
 * Displays images with optimized loading and caching
 */
'use client';

import Image from 'next/image';
import { useState, useRef, useCallback } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useLazyImage } from '@/lib/hooks';

interface ImageViewerProps {
  src: string;
  alt: string;
  mode?: 'feed' | 'reels';
  className?: string;
  onLoad?: () => void;
}

export function ImageViewer({ src, alt, mode = 'feed', className = '', onLoad }: ImageViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const imageRef = useRef<HTMLDivElement>(null);
  const imgElementRef = useRef<HTMLImageElement>(null!);
  const lastTap = useRef(0);

  const isReelsMode = mode === 'reels';

  // Use lazy image loading hook
  useLazyImage(imgElementRef, src);

  const handleLoadingComplete = () => {
    setIsLoading(false);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };

  // Zoom controls
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
        <span className="text-gray-500 dark:text-gray-400">Image failed to load</span>
      </div>
    );
  }

  return (
    <div
      ref={imageRef}
      className={`relative ${isReelsMode ? 'w-full h-full flex items-center justify-center' : 'w-full'} overflow-hidden bg-gray-100 dark:bg-gray-900 ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleDoubleTap}
      onTouchEnd={handleDoubleTap}
      style={{ cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default' }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-800 z-10" style={{ minHeight: '200px' }}>
          <div className="w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin"></div>
        </div>
      )}
      <img
        ref={imgElementRef}
        src={src}
        alt={alt}
        className={isReelsMode ? 'max-w-full max-h-full object-contain' : 'w-full h-auto object-cover'}
        style={{
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
        onLoad={handleLoadingComplete}
        onError={handleError}
        draggable={false}
      />

      {/* Zoom Controls - Only in reels mode */}
      {isReelsMode && !isLoading && !hasError && (
        <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-20">
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
  );
}
