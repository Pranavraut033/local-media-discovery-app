/**
 * Storage Compatibility Layer
 * Provides backward-compatible API using Zustand stores
 * Gradually migrate to store hooks instead of these functions
 */
import { useUIStore } from './stores/ui.store';
import { useFoldersStore } from './stores/folders.store';
import { useAuthStore } from './stores/auth.store';

export type ViewMode = 'reels' | 'feed';

interface UserPreferences {
  viewMode: ViewMode;
  autoPlayVideos: boolean;
  showSourceBadge: boolean;
}

interface LastViewedMedia {
  mediaId: string;
  timestamp: number;
  scrollPosition?: number;
}

export interface RecentFolder {
  path: string;
  name: string;
  timestamp: number;
}

interface LastViewedMedia {
  mediaId: string;
  timestamp: number;
  scrollPosition?: number;
}

interface UserPreferences {
  viewMode: ViewMode;
  autoPlayVideos: boolean;
  showSourceBadge: boolean;
}

// ============================================================================
// View Mode (Deprecated: Use useUIStore)
// ============================================================================
export const getViewMode = (): ViewMode => {
  return useUIStore.getState().viewMode;
};

export const setViewMode = (mode: ViewMode): void => {
  useUIStore.getState().setViewMode(mode);
};

// ============================================================================
// Last Viewed Media (Deprecated: Use useUIStore)
// ============================================================================
export const getLastViewedMedia = (): LastViewedMedia | null => {
  const state = useUIStore.getState();
  if (!state.lastViewedMediaId) return null;
  return {
    mediaId: state.lastViewedMediaId,
    timestamp: state.lastViewedTimestamp || 0,
    scrollPosition: state.lastViewedScrollPosition,
  };
};

export const setLastViewedMedia = (mediaId: string, scrollPosition?: number): void => {
  useUIStore.getState().setLastViewedMedia(mediaId, scrollPosition);
};

export const clearLastViewedMedia = (): void => {
  useUIStore.getState().clearLastViewedMedia();
};

// ============================================================================
// User Preferences (Deprecated: Use useUIStore)
// ============================================================================
export const getPreferences = (): UserPreferences => {
  return useUIStore.getState().preferences;
};

export const setPreferences = (preferences: Partial<UserPreferences>): void => {
  useUIStore.getState().setPreferences(preferences);
};

// ============================================================================
// Scroll Position (Deprecated: Use useUIStore)
// ============================================================================
export const getScrollPosition = (): number => {
  return useUIStore.getState().scrollPosition;
};

export const setScrollPosition = (position: number): void => {
  useUIStore.getState().setScrollPosition(position);
};

// ============================================================================
// Recent Folders (Deprecated: Use useFoldersStore)
// ============================================================================
export const getRecentFolders = (): RecentFolder[] => {
  return useFoldersStore.getState().recentFolders;
};

export const addRecentFolder = (path: string, name: string): void => {
  useFoldersStore.getState().addRecentFolder(path, name);
};

export const removeRecentFolder = (path: string): void => {
  useFoldersStore.getState().removeRecentFolder(path);
};

export const clearRecentFolders = (): void => {
  useFoldersStore.getState().clearRecentFolders();
};

// ============================================================================
// Root Folder (Deprecated: Use useFoldersStore)
// ============================================================================
export const getRootFolder = (): string | null => {
  return useFoldersStore.getState().rootFolder;
};

export const setRootFolder = (path: string): void => {
  useFoldersStore.getState().setRootFolder(path);
};

export const clearRootFolder = (): void => {
  useFoldersStore.getState().clearRootFolder();
};

// ============================================================================
// Auth Token Management (Deprecated: Use useAuthStore)
// ============================================================================
export const getStoredToken = (): string | null => {
  return useAuthStore.getState().token;
};

export const storeToken = (token: string): void => {
  // When storing a token, we need the userId from elsewhere
  // This is called from login, so userId should be available
  const userId = useAuthStore.getState().userId;
  if (userId) {
    useAuthStore.getState().storeToken(token, userId);
  }
};

export const removeToken = (): void => {
  useAuthStore.getState().removeToken();
};

// Export store hooks for modern usage
export { useUIStore } from './stores/ui.store';
export { useFoldersStore } from './stores/folders.store';
export { useAuthStore } from './stores/auth.store';
