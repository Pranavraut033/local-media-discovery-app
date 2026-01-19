/**
 * Like and Save Button Components
 */
'use client';

import { Heart, Bookmark, Eye } from 'lucide-react';

interface LikeButtonProps {
  liked: boolean;
  onToggle: () => void;
  isLoading?: boolean;
  className?: string;
}

export function LikeButton({ liked, onToggle, isLoading = false, className = '' }: LikeButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${liked
        ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300'
        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        } disabled:opacity-50 ${className}`}
      aria-label={liked ? 'Unlike' : 'Like'}
    >
      <Heart
        size={20}
        className={liked ? 'fill-current' : ''}
      />
      <span className="text-sm font-medium">Like</span>
    </button>
  );
}

interface SaveButtonProps {
  saved: boolean;
  onToggle: () => void;
  isLoading?: boolean;
  className?: string;
}

export function SaveButton({ saved, onToggle, isLoading = false, className = '' }: SaveButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${saved
        ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        } disabled:opacity-50 ${className}`}
      aria-label={saved ? 'Unsave' : 'Save'}
    >
      <Bookmark
        size={20}
        className={saved ? 'fill-current' : ''}
      />
      <span className="text-sm font-medium">Save</span>
    </button>
  );
}

interface HideButtonProps {
  hidden: boolean;
  onToggle: () => void;
  isLoading?: boolean;
  className?: string;
}

export function HideButton({ hidden, onToggle, isLoading = false, className = '' }: HideButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={isLoading}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${hidden
        ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
        } disabled:opacity-50 ${className}`}
      aria-label={hidden ? 'Unhide' : 'Hide'}
      title={hidden ? 'Unhide media' : 'Hide media'}
    >
      <Eye
        size={20}
        className={hidden ? 'line-through' : ''}
      />
      <span className="text-sm font-medium">{hidden ? 'Hidden' : 'Hide'}</span>
    </button>
  );
}
