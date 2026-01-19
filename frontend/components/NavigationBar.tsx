/**
 * Navigation Bar Component
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
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 z-50">
      <div className="flex justify-around items-center h-16 max-w-7xl mx-auto px-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${isActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={24} className={isActive ? 'stroke-2' : 'stroke-1.5'} />
              <span className={`text-xs mt-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
