'use client';

import { X } from 'lucide-react';

interface KeyboardShortcutsGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['↑', '↓'], label: 'Previous / next (single-video view)' },
  { keys: ['←', '→'], label: 'Seek -5s / +5s' },
  { keys: ['Space'], label: 'Play / pause' },
  { keys: ['M'], label: 'Mute / unmute' },
  { keys: ['L'], label: 'Like' },
  { keys: ['S'], label: 'Save' },
  { keys: ['G'], label: 'Switch grid / single-video view' },
  { keys: ['F'], label: 'Toggle fullscreen' },
  { keys: ['?'], label: 'Show this guide' },
  { keys: ['Esc'], label: 'Close this guide' },
];

export function KeyboardShortcutsGuide({ isOpen, onClose }: KeyboardShortcutsGuideProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-neutral-900 border border-white/10 p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-neutral-100">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map(({ keys, label }) => (
            <li key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-neutral-300">{label}</span>
              <span className="flex gap-1 shrink-0">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-neutral-100 text-xs font-mono"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
