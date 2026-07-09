'use client';

import { useEffect, useRef, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import LoginScreen from '@/components/LoginScreen';
import SetupScreen from '@/components/SetupScreen';
import { useAuth } from '@/lib/auth';
import { authenticatedFetch, ensureRcloneMount, getApiBase } from '@/lib/api';
import { useFoldersStore } from '@/lib/stores/folders.store';
import { RotateCw, X } from 'lucide-react';

export default function Home() {
  const { isAuthenticated, isLoading, requiresSetup } = useAuth();
  const autoIndexBootstrapDoneRef = useRef(false);
  const [showRemountPrompt, setShowRemountPrompt] = useState(false);
  const [isRemounting, setIsRemounting] = useState(false);

  // Re-check the rclone mount whenever the app window comes back into view
  // (e.g. minimized/closed and reopened) — the mount can have been torn down
  // by the backend's inactivity timeout while the window was hidden.
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkMount = async () => {
      try {
        const result = await ensureRcloneMount();
        setShowRemountPrompt(!(result.mounted || result.status === 'mounted'));
      } catch {
        setShowRemountPrompt(true);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') checkMount();
    };

    window.addEventListener('focus', checkMount);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', checkMount);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated]);

  const handleRemountClick = async () => {
    setIsRemounting(true);
    try {
      const result = await ensureRcloneMount();
      setShowRemountPrompt(!(result.mounted || result.status === 'mounted'));
    } finally {
      setIsRemounting(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    const bootstrapMount = async () => {
      try {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const result = await ensureRcloneMount();
          if (cancelled) {
            return;
          }

          if (result.mounted || result.status === 'mounted') {
            return;
          }

          if (result.status === 'error') {
            console.warn('Rclone mount failed:', result.message);
            return;
          }

          await new Promise((resolve) => {
            setTimeout(resolve, 1500);
          });
        }

        if (!cancelled) {
          console.warn('Rclone mount is still starting after 20 attempts.');
        }
      } catch (error) {
        console.warn('Rclone mount check failed:', error);
      }
    };

    bootstrapMount();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || autoIndexBootstrapDoneRef.current) {
      return;
    }

    autoIndexBootstrapDoneRef.current = true;
    let cancelled = false;

    const bootstrapIndexingIfEmpty = async () => {
      try {
        const apiBase = getApiBase();
        const statusResponse = await authenticatedFetch(`${apiBase}/api/index/status`);
        if (!statusResponse.ok || cancelled) {
          return;
        }

        const statusData = (await statusResponse.json().catch(() => null)) as { status?: { mediaCount?: number } } | null;
        const mediaCount = statusData?.status?.mediaCount ?? 0;
        if (mediaCount > 0) {
          return;
        }

        // Only re-trigger indexing for a folder the user has explicitly selected.
        const targetRootFolder = useFoldersStore.getState().rootFolder;
        if (!targetRootFolder) {
          return;
        }

        await authenticatedFetch(`${apiBase}/api/config/root-folder`, {
          method: 'POST',
          body: JSON.stringify({ path: targetRootFolder, autoIndex: true }),
        });
      } catch (error) {
        console.error('Auto-index bootstrap failed:', error);
      }
    };

    bootstrapIndexingIfEmpty();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="surface-panel px-8 py-10 text-center w-full max-w-sm">
          <svg className="animate-spin h-12 w-12 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25 text-[var(--secondary)]" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75 text-[var(--primary)]" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <h1 className="editorial-title text-3xl mb-1">Preparing your feed</h1>
          <p className="text-[var(--surface-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  if (requiresSetup) {
    return <SetupScreen />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <>
      <MainLayout />
      {showRemountPrompt && (
        <div className="fixed bottom-4 right-4 z-50 surface-panel px-4 py-3 flex items-center gap-3 shadow-lg max-w-sm">
          <span className="text-sm text-[var(--surface-muted)]">Remote source isn&apos;t mounted.</span>
          <button
            onClick={handleRemountClick}
            disabled={isRemounting}
            className="flex items-center gap-1 text-sm font-medium text-[var(--primary)] disabled:opacity-50"
          >
            <RotateCw size={14} className={isRemounting ? 'animate-spin' : ''} />
            {isRemounting ? 'Remounting…' : 'Remount'}
          </button>
          <button onClick={() => setShowRemountPrompt(false)} aria-label="Dismiss" className="text-[var(--surface-muted)]">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
