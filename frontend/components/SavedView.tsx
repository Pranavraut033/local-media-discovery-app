/**
 * SavedView Component
 * Displays all saved media items in a grid layout
 */
'use client';

import { useSavedItems } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { ArrowLeft, Bookmark } from 'lucide-react';
import Masonry from 'react-masonry-css';

interface SavedViewProps {
  onBack: () => void;
}

export function SavedView({ onBack }: SavedViewProps) {
  const { data: savedData, isLoading, error } = useSavedItems();

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
            <Bookmark size={28} />
            Saved
          </h1>
        </div>

        {/* Loading State */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading saved items...</p>
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
            <Bookmark size={28} />
            Saved
          </h1>
        </div>

        {/* Error State */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 dark:text-red-400">Failed to load saved items</p>
          </div>
        </div>
      </div>
    );
  }

  const savedItems = savedData?.savedMedia || [];

  return (
    <div className="w-full h-screen flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
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
          <Bookmark size={28} />
          Saved
        </h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          ({savedItems.length} {savedItems.length === 1 ? 'item' : 'items'})
        </span>
      </div>

      {/* Empty State */}
      {savedItems.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <Bookmark size={64} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              No saved items yet
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Tap the bookmark icon on any media to save it here for later
            </p>
          </div>
        </div>
      )}

      {/* Masonry Grid Container (Feed-like layout) */}
      {savedItems.length > 0 && (
        <div className="flex-1 overflow-y-auto p-4 pb-20">
          <Masonry
            breakpointCols={{
              default: 4,
              1536: 4,
              1280: 3,
              1024: 3,
              768: 2,
              640: 2,
              480: 1,
            }}
            className="flex -ml-4 w-auto"
            columnClassName="pl-4 bg-clip-padding"
          >
            {savedItems.map((item) => (
              <div
                key={item.id}
                className="mb-4 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
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
