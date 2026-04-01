/**
 * Navigation Bar Component
 * Ethos Narrative mobile bottom action pod with glass morphism
 * Provides navigation between main feed, saved items, liked items, and settings
 */
'use client';

import { Home, Bookmark, Heart, Settings } from 'lucide-react';

export type NavTab = 'feed' | 'saved' | 'liked' | 'settings';

interface NavigationBarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export function NavigationBar({ activeTab, onTabChange }: NavigationBarProps) {
  const tabs = [
    { id: 'feed' as NavTab, label: 'Feed', icon: Home },
    { id: 'saved' as NavTab, label: 'Saved', icon: Bookmark },
    { id: 'liked' as NavTab, label: 'Liked', icon: Heart },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="mx-auto max-w-md flex h-14 items-center justify-between rounded-full bg-black/45 px-4 backdrop-blur-lg border border-white/15">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded-lg px-2 py-1 ${
                isActive
                  ? 'text-white'
                  : 'text-neutral-400 hover:text-neutral-100'
              }`}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={22} className={`${
                isActive ? 'stroke-2' : 'stroke-1.5'
              }`} />
              <span className={`text-xs mt-0.5 ${
                isActive ? 'font-semibold' : 'font-medium'
              }`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
