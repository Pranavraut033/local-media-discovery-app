/**
 * LocalStorage utilities for persisting UI preferences
 * Handles view mode, scroll position, and resume state
 */

const STORAGE_KEYS = {
  VIEW_MODE: 'app_view_mode',
  LAST_VIEWED_MEDIA: 'app_last_viewed_media',
  SCROLL_POSITION: 'app_scroll_position',
  PREFERENCES: 'app_preferences',
  RECENT_FOLDERS: 'app_recent_folders',
  ROOT_FOLDER: 'app_root_folder',
  AUTH_TOKEN: 'app_auth_token',
} as const;

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

export const getViewMode = (): ViewMode => {
  if (typeof window === 'undefined') return 'reels';
  try {
    const mode = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    return (mode === 'feed' || mode === 'reels') ? mode : 'reels';
  } catch {
    return 'reels';
  }
};

export const setViewMode = (mode: ViewMode): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);
  } catch (error) {
    console.warn('Failed to save view mode:', error);
  }
};

// Get/Set Last Viewed Media (for resume functionality)
export const getLastViewedMedia = (): LastViewedMedia | null => {
  if (typeof window === 'undefined') return null;
  try {
    const data = localStorage.getItem(STORAGE_KEYS.LAST_VIEWED_MEDIA);
    if (!data) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
};

export const setLastViewedMedia = (mediaId: string, scrollPosition?: number): void => {
  if (typeof window === 'undefined') return;
  try {
    const data: LastViewedMedia = {
      mediaId,
      timestamp: Date.now(),
      scrollPosition,
    };
    localStorage.setItem(STORAGE_KEYS.LAST_VIEWED_MEDIA, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save last viewed media:', error);
  }
};

export const clearLastViewedMedia = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.LAST_VIEWED_MEDIA);
  } catch (error) {
    console.warn('Failed to clear last viewed media:', error);
  }
};

// Get/Set User Preferences
export const getPreferences = (): UserPreferences => {
  if (typeof window === 'undefined') {
    return {
      viewMode: 'reels',
      autoPlayVideos: true,
      showSourceBadge: true,
    };
  }
  try {
    const data = localStorage.getItem(STORAGE_KEYS.PREFERENCES);
    if (!data) {
      return {
        viewMode: 'reels',
        autoPlayVideos: true,
        showSourceBadge: true,
      };
    }
    return { ...getDefaultPreferences(), ...JSON.parse(data) };
  } catch {
    return getDefaultPreferences();
  }
};

export const setPreferences = (preferences: Partial<UserPreferences>): void => {
  if (typeof window === 'undefined') return;
  try {
    const current = getPreferences();
    const updated = { ...current, ...preferences };
    localStorage.setItem(STORAGE_KEYS.PREFERENCES, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save preferences:', error);
  }
};

const getDefaultPreferences = (): UserPreferences => ({
  viewMode: 'reels',
  autoPlayVideos: true,
  showSourceBadge: true,
});

// Get/Set Scroll Position
export const getScrollPosition = (): number => {
  if (typeof window === 'undefined') return 0;
  try {
    const pos = localStorage.getItem(STORAGE_KEYS.SCROLL_POSITION);
    return pos ? parseInt(pos, 10) : 0;
  } catch {
    return 0;
  }
};

export const setScrollPosition = (position: number): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.SCROLL_POSITION, position.toString());
  } catch (error) {
    console.warn('Failed to save scroll position:', error);
  }
};

// Get/Set Recent Folders
export const getRecentFolders = (): RecentFolder[] => {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(STORAGE_KEYS.RECENT_FOLDERS);
    if (!data) return [];
    return JSON.parse(data) as RecentFolder[];
  } catch {
    return [];
  }
};

export const addRecentFolder = (path: string, name: string): void => {
  if (typeof window === 'undefined') return;
  try {
    const recent = getRecentFolders();
    // Remove if already exists
    const filtered = recent.filter((f) => f.path !== path);
    // Add to front
    const updated = [
      { path, name, timestamp: Date.now() },
      ...filtered,
    ].slice(0, 10); // Keep only last 10
    localStorage.setItem(STORAGE_KEYS.RECENT_FOLDERS, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save recent folder:', error);
  }
};

export const removeRecentFolder = (path: string): void => {
  if (typeof window === 'undefined') return;
  try {
    const recent = getRecentFolders();
    const updated = recent.filter((f) => f.path !== path);
    localStorage.setItem(STORAGE_KEYS.RECENT_FOLDERS, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to remove recent folder:', error);
  }
};

export const clearRecentFolders = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.RECENT_FOLDERS);
  } catch (error) {
    console.warn('Failed to clear recent folders:', error);
  }
};

// Get/Set Root Folder (for privacy - stored locally, not on backend)
export const getRootFolder = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEYS.ROOT_FOLDER);
  } catch {
    return null;
  }
};

export const setRootFolder = (path: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.ROOT_FOLDER, path);
  } catch (error) {
    console.warn('Failed to save root folder:', error);
  }
};

export const clearRootFolder = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.ROOT_FOLDER);
  } catch (error) {
    console.warn('Failed to clear root folder:', error);
  }
};

// Auth Token Management
export const getStoredToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  } catch {
    return null;
  }
};

export const storeToken = (token: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
  } catch (error) {
    console.warn('Failed to store auth token:', error);
  }
};

export const removeToken = (): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  } catch (error) {
    console.warn('Failed to remove auth token:', error);
  }
};
