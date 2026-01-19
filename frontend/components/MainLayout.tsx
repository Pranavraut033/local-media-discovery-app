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
import { getApiBase } from '@/lib/api';
import { getRootFolder } from '@/lib/storage';

type AppView = 'feed' | 'saved' | 'liked' | 'hidden' | 'source' | 'settings';

interface SourceViewState {
  sourceId: string;
  displayName: string;
  avatarSeed: string;
}

export default function MainLayout() {
  const API_URL = getApiBase();
  const [rootFolderSet, setRootFolderSet] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('feed');
  const [sourceViewState, setSourceViewState] = useState<SourceViewState | null>(null);

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
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-gray-900 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!rootFolderSet) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black px-4">
        <main className="flex flex-col items-center justify-center w-full max-w-2xl py-12">
          <FolderSelection onFolderSelected={handleFolderSelected} />
        </main>
      </div>
    );
  }

  return (
    <>
      {currentView === 'feed' && <Feed onViewSource={handleViewSource} />}
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
      {currentView !== 'source' && (
        <NavigationBar
          activeTab={currentView === 'settings' ? 'settings' : currentView === 'saved' ? 'saved' : currentView === 'liked' ? 'liked' : 'feed'}
          onTabChange={handleTabChange}
        />
      )}
    </>
  );
}
