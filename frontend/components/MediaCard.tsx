/**
 * MediaCard Component
 * Main card for displaying media in Reels mode
 */
'use client';

import { ImageViewer } from './ImageViewer';
import { VideoPlayer } from './VideoPlayer';
import { SourceBadge } from './SourceBadge';
import { LikeButton, SaveButton, HideButton } from './InteractionButtons';
import { useEffect, useRef, useState } from 'react';
import { useLikeMutation, useSaveMutation, useViewMutation, useHideMutation, useFeed, FeedItem } from '@/lib/hooks';
import { getMediaUrl } from '@/lib/api';


interface MediaCardProps {
  media: FeedItem;
  onVisible?: () => void;
  onViewSource?: (sourceId: string, displayName: string, avatarSeed: string) => void;
  mode?: 'feed' | 'reels';
  className?: string;
  enableHoverAutoplay?: boolean;
  enableMobileAutoplay?: boolean;
}

export function MediaCard({ media, onVisible, onViewSource, mode = 'feed', className = '', enableHoverAutoplay = true, enableMobileAutoplay = true }: MediaCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRecordedView = useRef(false);
  const [currentLiked, setCurrentLiked] = useState(media?.liked ?? false);
  const [currentSaved, setCurrentSaved] = useState(media?.saved ?? false);
  const [currentHidden, setCurrentHidden] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const likeMutation = useLikeMutation();
  const saveMutation = useSaveMutation();
  const hideMutation = useHideMutation();
  const viewMutation = useViewMutation();

  // Sync component state with media prop changes
  useEffect(() => {
    if (media) {
      setCurrentLiked(media.liked);
      setCurrentSaved(media.saved);
    }
  }, [media?.id, media?.liked, media?.saved]);

  const normalizedType = media?.type?.toLowerCase() || '';
  const isImage = normalizedType === 'image' || normalizedType.startsWith('image/');
  const isVideo = normalizedType === 'video' || normalizedType.startsWith('video/');

  const isReelsMode = mode === 'reels';

  // Use Intersection Observer to detect when media is visible
  useEffect(() => {
    if (!media?.id) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRecordedView.current) {
          hasRecordedView.current = true;
          onVisible?.();
          // Record view after a short delay once media is visible
          setTimeout(() => {
            viewMutation.mutate({ mediaId: media.id, sourceId: media.sourceId });
          }, 1000);
        }
      },
      { threshold: 0.5 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [media?.id, onVisible, viewMutation]);

  if (!media) {
    return null;
  }

  const handleLike = async () => {
    setCurrentLiked(!currentLiked);
    await likeMutation.mutateAsync({ mediaId: media.id, sourceId: media.sourceId });
  };

  const handleSave = async () => {
    setCurrentSaved(!currentSaved);
    await saveMutation.mutateAsync({ mediaId: media.id, sourceId: media.sourceId });
  };

  const handleHide = async () => {
    setCurrentHidden(!currentHidden);
    await hideMutation.mutateAsync({ mediaId: media.id, sourceId: media.sourceId });
  };

  // Get media source - use data URL if available, otherwise construct from API
  const mediaSource = getMediaUrl(media.id);

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-transparent overflow-hidden ${isReelsMode ? 'w-full h-full' : 'w-full bg-white dark:bg-gray-900 rounded-lg'
        } ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Media Display Area */}
      <div className={`relative flex items-center justify-center ${isReelsMode ? 'w-full h-full bg-black' : 'bg-gray-100 dark:bg-gray-800'
        }`}>
        {isImage ? (
          <div className="relative w-full h-full">
            <ImageViewer
              src={mediaSource}
              alt={media.path}
              mode={mode}
              className={isReelsMode ? 'w-full h-full' : 'w-full'}
            />
            {/* Image badge overlay */}
            <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded">
              IMAGE
            </div>
          </div>
        ) : isVideo ? (
          <div className="relative w-full h-full">
            <VideoPlayer
              src={mediaSource}
              mode={mode}
              className={isReelsMode ? 'w-full h-full' : 'w-full'}
              shouldAutoPlayOnHover={enableHoverAutoplay}
              shouldAutoPlayOnMobileVisible={enableMobileAutoplay}
              isCardHovered={isHovered}
            />
            {/* Video badge overlay */}
            <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
              VIDEO
            </div>
          </div>
        ) : (
          <div className="w-full min-h-50 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <span>Unsupported media type: {media.type}</span>
          </div>
        )}
      </div>

      {/* Info and Interactions Bar */}
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-3">
        {/* Source Badge */}
        <div className="mb-3">
          <SourceBadge
            displayName={media.displayName}
            avatarSeed={media.avatarSeed}
            onClick={onViewSource ? () => onViewSource(media.sourceId, media.displayName, media.avatarSeed) : undefined}
          />
        </div>

        {/* Action Buttons - Always Visible */}
        <div className="flex gap-2 mb-3">
          <LikeButton
            liked={currentLiked}
            onToggle={handleLike}
            isLoading={likeMutation.isPending}
            className="flex-1"
          />
          <SaveButton
            saved={currentSaved}
            onToggle={handleSave}
            isLoading={saveMutation.isPending}
            className="flex-1"
          />
          <HideButton
            hidden={currentHidden}
            onToggle={handleHide}
            isLoading={hideMutation.isPending}
            className="flex-1"
          />
        </div>

        {/* File Info - Collapsible */}
        <details className="text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
            File details
          </summary>
          <div className="mt-2 space-y-1">
            <p className="truncate">{media.path}</p>
            <p className="text-gray-400 dark:text-gray-500">Depth: {media.depth}</p>
          </div>
        </details>
      </div>
    </div>
  );
}
