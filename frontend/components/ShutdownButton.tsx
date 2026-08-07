/**
 * ShutdownButton
 * Stops the app (desktop: quits Electron; browser: stops backend/media-server/frontend).
 * Shared by Settings' System Control section and every view's header.
 */
'use client';

import { useState } from 'react';
import { Power, RotateCw } from 'lucide-react';
import { getApiBase, authenticatedFetch } from '@/lib/api';
import { isDesktopRuntime, quitDesktopApp } from '@/lib/desktop';

interface ShutdownButtonProps {
  /** 'icon' matches the small header icon buttons; 'block' matches Settings' full-width row. */
  variant?: 'icon' | 'block';
  className?: string;
}

export function ShutdownButton({ variant = 'icon', className = '' }: ShutdownButtonProps) {
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const isDesktop = isDesktopRuntime();

  const handleShutdown = async () => {
    const confirmMessage = isDesktop
      ? 'Quit Local Media Discovery? All background services will be stopped.'
      : 'Stop all services (backend, frontend, media-server)? The app will become unavailable until you restart it.';

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      setIsShuttingDown(true);
      if (isDesktop) {
        await quitDesktopApp();
      } else {
        await authenticatedFetch(`${getApiBase()}/api/admin/shutdown`, { method: 'POST' });
      }
    } catch {
      // Expected — the server stops mid-response
    }
  };

  if (variant === 'block') {
    return (
      <button
        onClick={handleShutdown}
        disabled={isShuttingDown}
        className={`w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-2 ${className}`}
      >
        {isShuttingDown ? (
          <>
            <RotateCw size={16} className="animate-spin" />
            {isDesktop ? 'Quitting...' : 'Stopping services...'}
          </>
        ) : (
          <>
            <Power size={16} />
            {isDesktop ? 'Quit App' : 'Stop All Services'}
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleShutdown}
      disabled={isShuttingDown}
      className={`h-10 w-10 rounded-lg bg-black/40 text-white/80 hover:text-red-400 backdrop-blur-md border border-white/15 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50 ${className}`}
      aria-label={isDesktop ? 'Quit app' : 'Stop all services'}
      title={isDesktop ? 'Quit app' : 'Stop all services'}
    >
      {isShuttingDown ? <RotateCw size={18} className="animate-spin" /> : <Power size={18} />}
    </button>
  );
}
