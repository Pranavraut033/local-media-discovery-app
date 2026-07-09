# State Management Store Guide

The application uses **Zustand** for client-side state management with automatic localStorage persistence. The migration off raw `lib/storage.ts` utilities is complete — that file has been removed; import stores directly from `lib/stores/`.

- ✅ Centralized state management
- ✅ Type-safe state access
- ✅ Automatic localStorage persistence
- ✅ React hooks for state consumption
- ✅ Devtools support

## New Store Architecture

### 1. **UI Store** (`lib/stores/ui.store.ts`)
Manages UI state including:
- View mode (reels/feed)
- User preferences (autoplay, badges)
- Scroll position
- Last viewed media tracking

**Usage:**
```tsx
import { useUIStore } from '@/lib/stores/ui.store';

function MyComponent() {
  const viewMode = useUIStore((state) => state.viewMode);
  const setViewMode = useUIStore((state) => state.setViewMode);
  
  return (
    <button onClick={() => setViewMode('feed')}>
      Switch to Feed
    </button>
  );
}
```

### 2. **Folders Store** (`lib/stores/folders.store.ts`)
Manages folder state including:
- Recent folders list
- Root folder (privacy-first, stored locally only)

**Usage:**
```tsx
import { useFoldersStore } from '@/lib/stores/folders.store';

function RecentFolders() {
  const recentFolders = useFoldersStore((state) => state.recentFolders);
  const addRecentFolder = useFoldersStore((state) => state.addRecentFolder);
  
  return (
    <button onClick={() => addRecentFolder('/path', 'Name')}>
      Add Folder
    </button>
  );
}
```

### 3. **Auth Store** (`lib/stores/auth.store.ts`)
Manages authentication state including:
- JWT token
- User ID
- Authentication status

**Usage:**
```tsx
import { useAuthStore } from '@/lib/stores/auth.store';

function AuthStatus() {
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  
  return <div>{userId && <p>Logged in as {userId}</p>}</div>;
}
```

## Benefits of This Approach

1. **Better Performance**: Zustand only re-renders components that use changed selectors
2. **Devtools Integration**: Can use Redux DevTools extension for debugging
3. **Middleware Support**: Can add logging, time-travel debugging, etc.
4. **Cleaner Code**: No more localStorage try-catch blocks
5. **TypeScript**: Fully type-safe state access
6. **Concurrent React**: Better compatibility with future React features

## Storage Persistence Details

Each store automatically persists to localStorage using Zustand's `persist` middleware:

- `app-ui-store` - UI preferences and view state
- `app-folders-store` - Recent folders and root folder
- `app-auth-store` - Authentication tokens (only token and userId)

All storage keys are versioned for future schema migrations.

## DevTools Integration (Optional)

To enable Redux DevTools in development:

```tsx
import { devtools } from 'zustand/middleware';

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      // ... store definition
    )
  )
);
```

## Best Practices

1. **Use Selectors**: Minimize re-renders by using specific selectors:
   ```tsx
   // Good - only subscribes to viewMode changes
   const viewMode = useUIStore((state) => state.viewMode);
   
   // Avoid - subscribes to entire state
   const state = useUIStore();
   ```

2. **Memoize Callbacks**: Wrap actions that use store:
   ```tsx
   const handleChangeMode = useCallback(() => {
     useUIStore.getState().setViewMode('feed');
   }, []);
   ```

3. **Use getState() Outside Render**: For imperative actions:
   ```tsx
   // In event handler or async function
   const token = useAuthStore.getState().token;
   ```

## Troubleshooting

### Store not persisting?
- Check browser localStorage is enabled
- Verify store name in persist config
- Check browser console for errors

### Initial state not loading?
- Ensure `persist` middleware wraps store definition
- Check that initial state matches persisted schema

### SSR Issues?
- All stores have `typeof window` checks for SSR safety
- Hydration should happen automatically on client mount

## Future Improvements

1. **Redux DevTools**: Add devtools middleware for debugging
2. **Middleware**: Add logging/sync middleware if needed
3. **localStorage Encryption**: Consider encrypting sensitive data (tokens)
4. **State Sync**: Add cross-tab synchronization if multi-tab support needed
5. **Migration**: Add store versioning for schema migrations
