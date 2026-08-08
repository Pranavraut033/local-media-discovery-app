/**
 * SavedView Component
 * Displays all saved media items in a grid layout (with fullscreen)
 */
'use client';

import { useSavedItems } from '@/lib/hooks';
import { MediaGalleryView } from './MediaGalleryView';
import { ArrowLeft, Bookmark } from 'lucide-react';

interface SavedViewProps {
  onBack: () => void;
}

export function SavedView({ onBack }: SavedViewProps) {
  const { data: savedData, isLoading, error } = useSavedItems();
  const savedItems = savedData?.savedMedia || [];

  const renderHeader = (showCount: boolean) => (
    <div className="h-14 md:h-16 border-b border-white/10 px-4 md:px-8 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent">
      <div className="flex items-center gap-4">
        {onBack && (
          <button
            onClick={onBack}
            className="h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-white backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className="font-serif text-xl md:text-2xl tracking-tight text-neutral-100 flex items-center gap-2">
          <Bookmark size={24} />
          Saved
        </h1>
        {showCount && (
          <span className="text-xs text-neutral-400">
            ({savedItems.length})
          </span>
        )}
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="w-full h-dvh flex flex-col bg-neutral-950">
        {renderHeader(false)}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto"></div>
            <p className="text-neutral-400 text-sm">Loading saved items...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-dvh flex flex-col bg-neutral-950">
        {renderHeader(false)}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 text-sm">Failed to load saved items</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MediaGalleryView
      items={savedItems}
      title="Saved"
      icon={<Bookmark size={24} />}
      onBack={onBack}
      emptyState={
        <div className="text-center space-y-4 max-w-md">
          <Bookmark size={56} className="mx-auto text-neutral-600" />
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-neutral-100">No saved items yet</h2>
            <p className="text-sm text-neutral-400">Tap the bookmark icon on any media to save it here</p>
          </div>
        </div>
      }
    />
  );
}
