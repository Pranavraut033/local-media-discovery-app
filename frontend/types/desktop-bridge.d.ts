export { };

declare global {
  interface Window {
    desktopBridge?: {
      isDesktop?: boolean;
      getLaunchConfig?: () => Promise<{
        isDesktop: boolean;
        autoLoginPin: string | null;
        defaultRootFolder: string | null;
      }>;
      submitUnlockPin?: (pin: string) => Promise<{ success: boolean; message?: string }>;
    };
  }
}
