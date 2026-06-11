'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/lib/storage';
import { getApiBase } from '@/lib/api';
import { connectSSE, disconnectSSE } from '@/lib/sse';
import { isDesktopRuntime, getAutoPin } from '@/lib/desktop';

interface AuthContextType {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  requiresSetup: boolean;
  login: (token: string, userId: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      const apiBase = getApiBase();
      const storedToken = useAuthStore.getState().token;

      if (!storedToken) {
        try {
          const setupResponse = await fetch(`${apiBase}/api/auth/check-setup`);
          if (setupResponse.ok) {
            const setupData = await setupResponse.json();
            if (setupData.requiresSetup) {
              setRequiresSetup(true);
              setIsLoading(false);
              return;
            }
          }
        } catch (error) {
          console.error('Check-setup failed:', error);
        }

        if (isDesktopRuntime()) {
          const autoPin = await getAutoPin();
          if (autoPin) {
            try {
              const response = await fetch(`${apiBase}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: autoPin }),
              });

              if (response.ok) {
                const data = await response.json();
                useAuthStore.getState().storeToken(data.token, data.userId);
                setToken(data.token);
                setUserId(data.userId);
                setIsAuthenticated(true);
                connectSSE();
                setIsLoading(false);
                return;
              }
            } catch (error) {
              console.error('Desktop auto-login failed:', error);
            }
          }
        }

        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`${apiBase}/api/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: storedToken }),
        });

        if (response.ok) {
          const data = await response.json();
          setToken(storedToken);
          setUserId(data.userId);
          setIsAuthenticated(true);
          connectSSE();
        } else {
          // Token invalid, remove it
          useAuthStore.getState().removeToken();
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        useAuthStore.getState().removeToken();
      } finally {
        setIsLoading(false);
      }
    };

    verifyToken();
  }, []);

  const login = useCallback((newToken: string, newUserId: string) => {
    useAuthStore.getState().storeToken(newToken, newUserId);
    setToken(newToken);
    setUserId(newUserId);
    setIsAuthenticated(true);
    connectSSE();
  }, []);

  const logout = useCallback(() => {
    disconnectSSE();
    useAuthStore.getState().removeToken();
    setToken(null);
    setUserId(null);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, userId, token, requiresSetup, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
