'use client';

import { useEffect, useState } from 'react';
import MainLayout from '@/components/MainLayout';
import LoginScreen from '@/components/LoginScreen';
import { useAuth } from '@/lib/auth';
import { ensureRcloneMount } from '@/lib/api';

export default function Home() {
  const { isAuthenticated, isLoading } = useAuth();
  const [isPreparingMount, setIsPreparingMount] = useState(true);
  const [mountError, setMountError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrapMount = async () => {
      setMountError(null);

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const result = await ensureRcloneMount();
        if (cancelled) {
          return;
        }

        if (result.mounted || result.status === 'mounted') {
          setIsPreparingMount(false);
          return;
        }

        if (result.status === 'error') {
          setMountError(result.message || 'Failed to start remote mount');
          setIsPreparingMount(false);
          return;
        }

        await new Promise((resolve) => {
          setTimeout(resolve, 1500);
        });
      }

      if (!cancelled) {
        setMountError('Remote mount is still starting. Please retry in a few seconds.');
        setIsPreparingMount(false);
      }
    };

    bootstrapMount();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isPreparingMount) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="surface-panel px-8 py-10 text-center w-full max-w-sm">
          <svg className="animate-spin h-12 w-12 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25 text-[var(--secondary)]" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75 text-[var(--primary)]" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <h1 className="editorial-title text-3xl mb-1">Connecting storage</h1>
          <p className="text-[var(--surface-muted)]">Mounting rclone remote before loading the app...</p>
        </div>
      </div>
    );
  }

  if (mountError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="surface-panel px-8 py-10 text-center w-full max-w-md">
          <h1 className="editorial-title text-3xl mb-2">Storage Not Ready</h1>
          <p className="text-[var(--surface-muted)] mb-6">{mountError}</p>
          <button
            type="button"
            onClick={() => {
              setIsPreparingMount(true);
              setMountError(null);
            }}
            className="focus-ring px-6 py-3 bg-linear-to-r from-[var(--primary)] to-[var(--primary-container)] text-[var(--on-primary)] font-semibold rounded-full"
          >
            Retry Mount
          </button>
        </div>
      </div>
    );
  }

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

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <MainLayout />;
}
