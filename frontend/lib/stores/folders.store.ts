/**
 * Folders Store
 * Manages recent folders and root folder with persistent storage
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RecentFolder {
  path: string;
  name: string;
  timestamp: number;
}

interface FoldersState {
  // Recent Folders
  recentFolders: RecentFolder[];
  addRecentFolder: (path: string, name: string) => void;
  removeRecentFolder: (path: string) => void;
  clearRecentFolders: () => void;

  // Root Folder (privacy-first, stored locally only)
  rootFolder: string | null;
  setRootFolder: (path: string) => void;
  clearRootFolder: () => void;
}

export const useFoldersStore = create<FoldersState>()(
  persist(
    (set) => ({
      // Recent Folders
      recentFolders: [],
      addRecentFolder: (path: string, name: string) =>
        set((state) => {
          // Remove if already exists
          const filtered = state.recentFolders.filter((f) => f.path !== path);
          // Add to front and keep only last 10
          return {
            recentFolders: [
              { path, name, timestamp: Date.now() },
              ...filtered,
            ].slice(0, 10),
          };
        }),
      removeRecentFolder: (path: string) =>
        set((state) => ({
          recentFolders: state.recentFolders.filter((f) => f.path !== path),
        })),
      clearRecentFolders: () => set({ recentFolders: [] }),

      // Root Folder
      rootFolder: null,
      setRootFolder: (path: string) => set({ rootFolder: path }),
      clearRootFolder: () => set({ rootFolder: null }),
    }),
    {
      name: 'app-folders-store',
      version: 1,
    }
  )
);
