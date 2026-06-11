export { };

declare global {
  interface Window {
    desktopBridge?: {
      isDesktop?: boolean;
      getLaunchConfig?: () => Promise<{
        isDesktop: boolean;
      }>;
      getAutoPin?: () => Promise<{ pin: string | null }>;
      createAutoPin?: () => Promise<{ pin: string }>;
      quitApp?: () => Promise<void>;
    };
  }
}
