'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getStoredToken, storeToken, removeToken } from '@/lib/storage';
import { getApiBase } from '@/lib/api';

interface AuthContextType {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
  login: (token: string, userId: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      const storedToken = getStoredToken();
      
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const apiBase = getApiBase();
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
        } else {
          // Token invalid, remove it
          removeToken();
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        removeToken();
      } finally {
        setIsLoading(false);
      }
    };

    verifyToken();
  }, []);

  const login = useCallback((newToken: string, newUserId: string) => {
    storeToken(newToken);
    setToken(newToken);
    setUserId(newUserId);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    removeToken();
    setToken(null);
    setUserId(null);
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, userId, token, login, logout, isLoading }}>
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
