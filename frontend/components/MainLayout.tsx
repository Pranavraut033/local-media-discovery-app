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
import { NavigationBar, type NavTab } from '@/components/NavigationBar';
import { getRootFolder } from '@/lib/storage';
import type { FeedMode } from '@/components/Feed';
import { useUIStore } from '@/lib/stores/ui.store';

type AppView = 'feed' | 'saved' | 'liked' | 'hidden' | 'source' | 'settings';

interface SourceViewState {
  sourceId: string;
  displayName: string;
  avatarSeed: string;
}

export default function MainLayout() {
  const [rootFolderSet, setRootFolderSet] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('feed');
  const [sourceViewState, setSourceViewState] = useState<SourceViewState | null>(null);
  const [feedMode, setFeedMode] = useState<FeedMode>('feed');

  // Check if root folder is already set (in localStorage for privacy)
  useEffect(() => {
    const checkRootFolder = () => {
      try {
        const rootFolder = getRootFolder();
        setRootFolderSet(!!rootFolder);
      } catch (error) {
        console.error('Failed to check root folder:', error);
        setRootFolderSet(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkRootFolder();
  }, []);

  const handleFolderSelected = () => {
    // Selecting a local folder should always scope the feed to local-only content.
    // This prevents stale 'all'/'remote' feedSourceType from a previous session
    // from causing rclone fetches after a fresh local-folder selection.
    useUIStore.getState().setPreferences({ feedSourceType: 'local' });
    setRootFolderSet(true);
  };

  const handleTabChange = (tab: NavTab) => {
    setCurrentView(tab as AppView);
    setSourceViewState(null);
  };

  const handleViewSource = (sourceId: string, displayName: string, avatarSeed: string) => {
    setSourceViewState({ sourceId, displayName, avatarSeed });
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

  if (!rootFolderSet) {
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
      {currentView === 'saved' && <SavedView onBack={handleBackFromSaved} />}
      {currentView === 'liked' && <LikedView onBack={handleBackFromLiked} />}
      {currentView === 'hidden' && <HiddenView onBack={handleBackFromHidden} />}
      {currentView === 'source' && sourceViewState && (
        <SourceView
          sourceId={sourceViewState.sourceId}
          displayName={sourceViewState.displayName}
          avatarSeed={sourceViewState.avatarSeed}
          onBack={handleBackFromSource}
        />
      )}
      {currentView === 'settings' && <Settings onBack={handleBackFromSettings} onViewHidden={() => setCurrentView('hidden')} />}

      {/* Navigation Bar (only show when not viewing a source) */}
      {currentView !== 'source' && !(currentView === 'feed' && feedMode === 'reels') && (
        <NavigationBar
          activeTab={currentView === 'settings' ? 'settings' : currentView === 'saved' ? 'saved' : currentView === 'liked' ? 'liked' : 'feed'}
          onTabChange={handleTabChange}
        />
      )}
    </>
  );
}
