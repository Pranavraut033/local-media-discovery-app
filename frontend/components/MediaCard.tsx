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
import { useLikeMutation, useSaveMutation, useViewMutation, useHideMutation, FeedItem } from '@/lib/hooks';
import { getStreamUrl } from '@/lib/api';
import { Maximize2 } from 'lucide-react';


interface MediaCardProps {
  media: FeedItem;
  onVisible?: () => void;
  onViewSource?: (sourceId: string, displayName: string, avatarSeed: string) => void;
  onVideoExpand?: (src: string, title?: string) => void;
  mode?: 'feed' | 'reels';
  className?: string;
  enableHoverAutoplay?: boolean;
  enableMobileAutoplay?: boolean;
}

export function MediaCard({ media, onVisible, onViewSource, onVideoExpand, mode = 'feed', className = '', enableHoverAutoplay = true, enableMobileAutoplay = true }: MediaCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRecordedView = useRef(false);
  const [currentLiked, setCurrentLiked] = useState(media?.liked ?? false);
  const [currentSaved, setCurrentSaved] = useState(media?.saved ?? false);
  const [currentHidden, setCurrentHidden] = useState(media?.hidden ?? false);
  const [optimisticMediaId, setOptimisticMediaId] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const likeMutation = useLikeMutation();
  const saveMutation = useSaveMutation();
  const hideMutation = useHideMutation();
  const viewMutation = useViewMutation();

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
  }, [media?.id, media?.sourceId, onVisible, viewMutation]);

  if (!media) {
    return null;
  }

  const usesOptimisticState = optimisticMediaId === media.id;
  const likedValue = usesOptimisticState ? currentLiked : media.liked;
  const savedValue = usesOptimisticState ? currentSaved : media.saved;
  const hiddenValue = usesOptimisticState ? currentHidden : media.hidden;

  const handleLike = async () => {
    setOptimisticMediaId(media.id);
    setCurrentLiked(!likedValue);
    await likeMutation.mutateAsync({ mediaId: media.id, sourceId: media.sourceId });
  };

  const handleSave = async () => {
    setOptimisticMediaId(media.id);
    setCurrentSaved(!savedValue);
    await saveMutation.mutateAsync({ mediaId: media.id, sourceId: media.sourceId });
  };

  const handleHide = async () => {
    setOptimisticMediaId(media.id);
    setCurrentHidden(!hiddenValue);
    await hideMutation.mutateAsync({ mediaId: media.id, sourceId: media.sourceId });
  };

  // Prefer the fast media-server stream URL when the backend has issued a token;
  // fall back to the backend media file route if the media server is not available.
  const mediaSource = getStreamUrl(media.streamToken, media.id);

  return (
    <div
      ref={containerRef}
      className={`group relative flex flex-col bg-transparent overflow-hidden transition-all ${'w-full' + (isReelsMode ? ' h-full' : '')
        } ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Media Display Area */}
      <div className={`relative flex items-center justify-center ${'w-full' + (isReelsMode ? ' h-full bg-black' : ' bg-neutral-900')
        }`}>
        {isImage ? (
          <div className="relative w-full h-full">
            <ImageViewer
              key={mediaSource}
              src={mediaSource}
              alt={media.path}
              mode={mode}
              className={isReelsMode ? 'w-full h-full' : 'w-full'}
            />
          </div>
        ) : isVideo ? (
          <div className="relative w-full h-full">
            <VideoPlayer
              key={mediaSource}
              src={mediaSource}
              mode={mode}
              className={isReelsMode ? 'w-full h-full' : 'w-full'}
              shouldAutoPlayOnHover={enableHoverAutoplay}
              shouldAutoPlayOnMobileVisible={enableMobileAutoplay}
              isCardHovered={isHovered}
            />
            {!isReelsMode && onVideoExpand && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onVideoExpand(mediaSource, media.displayName);
                }}
                className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                aria-label="Open in video player"
              >
                <Maximize2 size={15} />
              </button>
            )}
          </div>
        ) : (
          <div className="w-full min-h-50 flex items-center justify-center text-neutral-500">
            <span className="text-sm">Unsupported media type: {media.type}</span>
          </div>
        )}

      </div>

      {/* Feed Mode Footer (kept outside media frame to avoid content obstruction) */}
      {!isReelsMode && (
        <div className="bg-neutral-950/95 border-t border-white/10 p-3 space-y-3">
          <SourceBadge
            displayName={media.displayName}
            avatarSeed={media.avatarSeed}
            onClick={onViewSource ? () => onViewSource(media.sourceId, media.displayName, media.avatarSeed) : undefined}
          />

          <div className="flex gap-2">
            <LikeButton
              liked={likedValue}
              onToggle={handleLike}
              isLoading={likeMutation.isPending}
              className="flex-1 h-9"
            />
            <SaveButton
              saved={savedValue}
              onToggle={handleSave}
              isLoading={saveMutation.isPending}
              className="flex-1 h-9"
            />
            <HideButton
              hidden={hiddenValue}
              onToggle={handleHide}
              isLoading={hideMutation.isPending}
              className="flex-1 h-9"
            />
          </div>
        </div>
      )}

      {/* Info Bar - Reels Mode Only (Bottom with gradient veil) */}
      {isReelsMode && (
        <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/90 via-black/40 to-transparent pt-12 px-4 pb-6 z-20">
          {/* Source Badge */}
          <div className="mb-4">
            <SourceBadge
              displayName={media.displayName}
              avatarSeed={media.avatarSeed}
              onClick={onViewSource ? () => onViewSource(media.sourceId, media.displayName, media.avatarSeed) : undefined}
            />
          </div>

          {/* File Info - Minimal */}
          <details className="text-xs text-neutral-300">
            <summary className="cursor-pointer text-neutral-400 hover:text-neutral-100 transition-colors">
              Details
            </summary>
            <div className="mt-2 space-y-1 text-neutral-400 text-xs">
              <p className="truncate">{media.path}</p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
