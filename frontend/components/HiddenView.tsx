/**
 * HiddenView Component
 * Displays all hidden/archived media items in a grid layout
 */
'use client';

import { useHiddenItems } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { ArrowLeft, Eye, Maximize, Minimize } from 'lucide-react';
import Masonry from 'react-masonry-css';
import { useFullscreen } from '@/lib/useFullscreen';
import {
  CONTENT_BOTTOM_INSET_CLASS,
  MEDIA_GRID_CARD_CLASS,
  MEDIA_MASONRY_BREAKPOINTS,
  MEDIA_MASONRY_CLASS,
  MEDIA_MASONRY_COLUMN_CLASS,
} from '@/lib/layout';

interface HiddenViewProps {
  onBack: () => void;
}

export function HiddenView({ onBack }: HiddenViewProps) {
  const { data: hiddenData, isLoading, error } = useHiddenItems();
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  if (isLoading) {
    return (
      <div className="w-full h-screen flex flex-col bg-white dark:bg-gray-900">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white p-2 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Eye size={28} />
            Hidden
          </h1>
        </div>

        {/* Loading State */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading hidden items...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-screen flex flex-col bg-white dark:bg-gray-900">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white p-2 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Eye size={28} />
            Hidden
          </h1>
        </div>

        {/* Error State */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 dark:text-red-400">Failed to load hidden items</p>
          </div>
        </div>
      </div>
    );
  }



  const hiddenItems = hiddenData?.hiddenMedia || [];

  return (
    <div className="w-full h-screen flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white p-2 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Eye size={28} />
            Hidden
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            ({hiddenItems.length} {hiddenItems.length === 1 ? 'item' : 'items'})
          </span>
        </div>
        <button
          onClick={toggleFullscreen}
          className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white p-2 rounded-lg transition-colors"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
        </button>
      </div>

      {/* Empty State */}
      {hiddenItems.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <Eye size={64} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              No hidden items yet
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Tap the hide icon on any media to archive it here
            </p>
          </div>
        </div>
      )}

      {/* Masonry Grid Container (Feed-like layout) */}
      {hiddenItems.length > 0 && (
        <div className={`flex-1 overflow-y-auto p-4 ${CONTENT_BOTTOM_INSET_CLASS}`}>
          <Masonry
            breakpointCols={MEDIA_MASONRY_BREAKPOINTS}
            className={MEDIA_MASONRY_CLASS}
            columnClassName={MEDIA_MASONRY_COLUMN_CLASS}
          >
            {hiddenItems.map((item) => (
              <div
                key={item.id}
                className={MEDIA_GRID_CARD_CLASS}
              >
                <MediaCard
                  media={item}
                  onVisible={() => { }}
                  mode="feed"
                  className="w-full"
                />
              </div>
            ))}
          </Masonry>
        </div>
      )}
    </div>
  );
}
