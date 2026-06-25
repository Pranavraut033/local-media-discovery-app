/**
 * Main Layout Component
 * Handles showing FolderSelection or Feed based on app state
 */
'use client';

import { useEffect, useState } from 'react';
import FolderSelection from '@/components/FolderSelection';
import { Feed } from '@/components/Feed';
import { SavedView } from '@/components/SavedView';
import { LikedView } from '@/components/LikedView';
import { HiddenView } from '@/components/HiddenView';
import { Settings } from '@/components/Settings';
import { SourceView } from '@/components/SourceView';
import { DiscoverView } from '@/components/DiscoverView';
import { NavigationBar, type NavTab } from '@/components/NavigationBar';
import { getRootFolder, clearRootFolder } from '@/lib/storage';
import type { FeedMode } from '@/components/Feed';
import { useUIStore } from '@/lib/stores/ui.store';
import ScanningProgressDialog from '@/components/ScanningProgressDialog';
import { getApiBase, authenticatedFetch } from '@/lib/api';

type AppView = 'feed' | 'discover' | 'saved' | 'liked' | 'hidden' | 'source' | 'settings';

interface SourceViewState {
  sourceId: string;
  displayName: string;
  avatarSeed: string;
  parentFolderPath?: string;
  parentFolderName?: string;
}

export default function MainLayout() {
  const [rootFolderSet, setRootFolderSet] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('feed');
  const [sourceViewState, setSourceViewState] = useState<SourceViewState | null>(null);
  const [feedMode, setFeedMode] = useState<FeedMode>('feed');

  const feedSourceType = useUIStore((s) => s.preferences.feedSourceType);

  // Check if root folder is already set (in localStorage for privacy) and
  // still exists on disk — if it was moved/deleted, fall back to folder selection.
  useEffect(() => {
    const checkRootFolder = async () => {
      try {
        const rootFolder = getRootFolder();
        if (!rootFolder) {
          setRootFolderSet(false);
          return;
        }

        const apiBase = getApiBase();
        const response = await authenticatedFetch(
          `${apiBase}/api/config/root-folder/status?${new URLSearchParams({ path: rootFolder })}`
        );

        if (response.ok) {
          const data = await response.json();
          if (!data.exists) {
            clearRootFolder();
            setRootFolderSet(false);
            return;
          }
        }

        setRootFolderSet(true);
      } catch (error) {
        console.error('Failed to check root folder:', error);
        setRootFolderSet(true);
      } finally {
        setIsChecking(false);
      }
    };

    checkRootFolder();
  }, []);

  const handleFolderSelected = (source: 'local' | 'remote' = 'local') => {
    // Local selection scopes the feed to local-only content, preventing a stale
    // 'all'/'remote' feedSourceType from a previous session from causing remote
    // fetches right after a fresh local-folder pick.
    // Remote selection sets 'all' so existing local content (if any) keeps
    // showing alongside the newly added server. 'all' also persists across
    // refresh (unlike the in-memory rootFolderSet flag), which is what keeps
    // the app on the feed instead of bouncing back to folder selection.
    useUIStore.getState().setPreferences({ feedSourceType: source === 'remote' ? 'all' : 'local' });
    setRootFolderSet(true);
  };

  const handleTabChange = (tab: NavTab) => {
    setCurrentView(tab as AppView);
    setSourceViewState(null);
  };

  const handleViewSource = (
    sourceId: string,
    displayName: string,
    avatarSeed: string,
    parentFolderPath?: string,
    parentFolderName?: string
  ) => {
    setSourceViewState({ sourceId, displayName, avatarSeed, parentFolderPath, parentFolderName });
    setCurrentView('source');
  };

  const handleBackFromSource = () => {
    setCurrentView('feed');
    setSourceViewState(null);
  };

  const handleBackFromSaved = () => {
    setCurrentView('feed');
  };

  const handleBackFromLiked = () => {
    setCurrentView('feed');
  };

  const handleBackFromHidden = () => {
    setCurrentView('feed');
  };

  const handleBackFromSettings = () => {
    setCurrentView('feed');
  };

  const handleRootFolderReset = () => {
    useUIStore.getState().setPreferences({ feedSourceType: 'local' });
    setRootFolderSet(false);
    setCurrentView('feed');
  };

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10 bg-background">
        <div className="text-center space-y-6">
          <div className="w-14 h-14 border-4 border-(--outline-variant) border-t-(--primary) rounded-full animate-spin mx-auto"></div>
          <div className="space-y-2">
            <h1 className="font-serif text-3xl tracking-tight text-(--surface-ink)">Warming up</h1>
            <p className="text-(--outline)">Loading your local workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!rootFolderSet && feedSourceType === 'local') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <main className="flex flex-col items-center justify-center w-full max-w-2xl py-12">
          <FolderSelection onFolderSelected={handleFolderSelected} />
        </main>
      </div>
    );
  }

  return (
    <>
      {currentView === 'feed' && <Feed onViewSource={handleViewSource} onModeChange={setFeedMode} />}
      {currentView === 'discover' && <DiscoverView onViewSource={handleViewSource} />}
      {currentView === 'saved' && <SavedView onBack={handleBackFromSaved} />}
      {currentView === 'liked' && <LikedView onBack={handleBackFromLiked} />}
      {currentView === 'hidden' && <HiddenView onBack={handleBackFromHidden} />}
      {currentView === 'source' && sourceViewState && (
        <SourceView
          sourceId={sourceViewState.sourceId}
          displayName={sourceViewState.displayName}
          avatarSeed={sourceViewState.avatarSeed}
          parentFolderPath={sourceViewState.parentFolderPath}
          parentFolderName={sourceViewState.parentFolderName}
          onBack={handleBackFromSource}
        />
      )}
      {currentView === 'settings' && <Settings onBack={handleBackFromSettings} onViewHidden={() => setCurrentView('hidden')} onRootFolderReset={handleRootFolderReset} />}

      {/* Navigation Bar (only show when not viewing a source) */}
      {currentView !== 'source' && !(currentView === 'feed' && feedMode === 'reels') && (
        <NavigationBar
          activeTab={currentView === 'settings' ? 'settings' : currentView === 'saved' ? 'saved' : currentView === 'liked' ? 'liked' : currentView === 'discover' ? 'discover' : 'feed'}
          onTabChange={handleTabChange}
        />
      )}

      <ScanningProgressDialog />
    </>
  );
}
