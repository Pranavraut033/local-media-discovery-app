/**
 * SourceView Component
 * Displays all media from a specific source
 */
'use client';

import { useSourceMedia } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { ArrowLeft } from 'lucide-react';
import { getAvatarColor } from '@/lib/avatar';

interface SourceViewProps {
  sourceId: string;
  displayName: string;
  avatarSeed: string;
  onBack: () => void;
}

export function SourceView({ sourceId, displayName, avatarSeed, onBack }: SourceViewProps) {
  const { data, isLoading, error } = useSourceMedia(sourceId, 100);

  const avatarColor = getAvatarColor(avatarSeed);

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
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
            style={{ backgroundColor: avatarColor }}
          >
            {displayName.charAt(1).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {displayName}
          </h1>
        </div>

        {/* Loading State */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading media...</p>
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {displayName}
          </h1>
        </div>

        {/* Error State */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 dark:text-red-400">Failed to load media</p>
          </div>
        </div>
      </div>
    );
  }

  const mediaItems = (data as any)?.media || [];

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
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
          style={{ backgroundColor: avatarColor }}
        >
          {displayName.charAt(1).toUpperCase()}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {displayName}
        </h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          ({mediaItems.length} {mediaItems.length === 1 ? 'item' : 'items'})
        </span>
      </div>

      {/* Empty State */}
      {mediaItems.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md px-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              No media found
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              This source doesn't have any media yet
            </p>
          </div>
        </div>
      )}

      {/* Grid Container */}
      {mediaItems.length > 0 && (
        <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {mediaItems.map((item: any) => (
            <div
              key={item.id}
              className="aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
            >
              <MediaCard
                media={item}
                onVisible={() => { }}
                className="w-full h-full"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
