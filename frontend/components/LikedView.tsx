/**
 * LikedView Component
 * Displays all liked media items in a grid layout
 */
'use client';

import { useLikedItems } from '@/lib/hooks';
import { MediaCard } from './MediaCard';
import { ArrowLeft, Heart } from 'lucide-react';
import Masonry from 'react-masonry-css';
import {
  MEDIA_MASONRY_BREAKPOINTS,
  MEDIA_MASONRY_CLASS,
  MEDIA_MASONRY_COLUMN_CLASS,
} from '@/lib/layout';

interface LikedViewProps {
  onBack: () => void;
}

export function LikedView({ onBack }: LikedViewProps) {
  const { data: likedData, isLoading, error } = useLikedItems();

  if (isLoading) {
    return (
      <div className="w-full h-screen flex flex-col bg-neutral-950">
        <div className="h-14 md:h-16 border-b border-white/10 px-4 md:px-8 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
          <h1 className="font-serif text-xl md:text-2xl tracking-tight text-neutral-100 flex items-center gap-2">
            <Heart size={24} />
            Liked
          </h1>
          {onBack && (
            <button
              onClick={onBack}
              className="h-10 w-10 rounded-lg bg-black/40 text-white/80 backdrop-blur-md border border-white/15 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              aria-label="Go back"
            >
              <ArrowLeft size={20} />
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto"></div>
            <p className="text-neutral-400 text-sm">Loading liked items...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-screen flex flex-col bg-neutral-950">
        <div className="h-14 md:h-16 border-b border-white/10 px-4 md:px-8 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
          <h1 className="font-serif text-xl md:text-2xl tracking-tight text-neutral-100 flex items-center gap-2">
            <Heart size={24} />
            Liked
          </h1>
          {onBack && (
            <button
              onClick={onBack}
              className="h-10 w-10 rounded-lg bg-black/40 text-white/80 backdrop-blur-md border border-white/15 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              aria-label="Go back"
            >
              <ArrowLeft size={20} />
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 text-sm">Failed to load liked items</p>
          </div>
        </div>
      </div>
    );
  }

  const likedItems = likedData?.likedMedia || [];

  return (
    <div className="w-full h-screen flex flex-col bg-neutral-950 overflow-hidden">
      <div className="h-14 md:h-16 border-b border-white/10 px-4 md:px-8 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
        <h1 className="font-serif text-xl md:text-2xl tracking-tight text-neutral-100 flex items-center gap-2">
          <Heart size={24} />
          Liked {likedItems.length > 0 && <span className="text-xs text-neutral-400 ml-2">({likedItems.length})</span>}
        </h1>
        {onBack && (
          <button
            onClick={onBack}
            className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
        )}
      </div>

      {/* Empty State */}
      {likedItems.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-md">
            <Heart size={56} className="mx-auto text-neutral-600" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-neutral-100">No liked items yet</h2>
              <p className="text-sm text-neutral-400">Tap the heart icon on any media to like it</p>
            </div>
          </div>
        </div>
      )}

      {/* Masonry Grid Container (Feed-like layout) */}
      {likedItems.length > 0 && (
        <div className="flex-1 overflow-y-auto pt-2 pb-24 md:pb-8 px-2 md:px-4">
          <div className="mx-auto max-w-[1600px]">
            <Masonry
              breakpointCols={MEDIA_MASONRY_BREAKPOINTS}
              className={MEDIA_MASONRY_CLASS}
              columnClassName={MEDIA_MASONRY_COLUMN_CLASS}
            >
              {likedItems.map((item) => (
                <div key={item.id} className="mb-2 md:mb-4 break-inside-avoid">
                  <MediaCard
                    media={item}
                    onVisible={() => { }}
                    mode="feed"
                    className="w-full rounded-2xl overflow-hidden"
                  />
                </div>
            ))}
          </Masonry>
        </div>
          </div>
      )}
    </div>
  );
}
