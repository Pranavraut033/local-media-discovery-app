/**
 * Auth Store
 * Manages authentication tokens and user ID with persistent storage
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;

  storeToken: (token: string, userId: string) => void;
  getToken: () => string | null;
  removeToken: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      userId: null,
      isAuthenticated: false,

      storeToken: (token: string, userId: string) =>
        set({
          token,
          userId,
          isAuthenticated: true,
        }),

      getToken: () => get().token,

      removeToken: () =>
        set({
          token: null,
          userId: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'app-auth-store',
      version: 1,
      // Only persist token and userId, not isAuthenticated (calculated on mount)
      partialize: (state) => ({
        token: state.token,
        userId: state.userId,
      }),
    }
  )
);
