/**
 * UI State Store
 * Manages view mode, preferences, and scroll position with persistent storage
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ViewMode = 'reels' | 'feed';

interface UserPreferences {
  viewMode: ViewMode;
  autoPlayVideos: boolean;
  showSourceBadge: boolean;
}

interface UIState {
  // View Mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // Preferences
  preferences: UserPreferences;
  setPreferences: (prefs: Partial<UserPreferences>) => void;

  // Scroll Position
  scrollPosition: number;
  setScrollPosition: (position: number) => void;

  // Last Viewed Media
  lastViewedMediaId: string | null;
  lastViewedTimestamp: number | null;
  lastViewedScrollPosition: number | undefined;
  setLastViewedMedia: (mediaId: string, scrollPosition?: number) => void;
  clearLastViewedMedia: () => void;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  viewMode: 'reels',
  autoPlayVideos: true,
  showSourceBadge: true,
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // View Mode
      viewMode: 'reels',
      setViewMode: (mode: ViewMode) => set({ viewMode: mode }),

      // Preferences
      preferences: DEFAULT_PREFERENCES,
      setPreferences: (prefs: Partial<UserPreferences>) =>
        set((state) => ({
          preferences: { ...state.preferences, ...prefs },
        })),

      // Scroll Position
      scrollPosition: 0,
      setScrollPosition: (position: number) => set({ scrollPosition: position }),

      // Last Viewed Media
      lastViewedMediaId: null,
      lastViewedTimestamp: null,
      lastViewedScrollPosition: undefined,
      setLastViewedMedia: (mediaId: string, scrollPosition?: number) =>
        set({
          lastViewedMediaId: mediaId,
          lastViewedTimestamp: Date.now(),
          lastViewedScrollPosition: scrollPosition,
        }),
      clearLastViewedMedia: () =>
        set({
          lastViewedMediaId: null,
          lastViewedTimestamp: null,
          lastViewedScrollPosition: undefined,
        }),
    }),
    {
      name: 'app-ui-store',
      version: 1,
    }
  )
);
