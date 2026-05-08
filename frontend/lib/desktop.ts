export interface DesktopLaunchConfig {
  isDesktop: boolean;
  autoLoginPin: string | null;
  defaultRootFolder: string | null;
}

let launchConfigPromise: Promise<DesktopLaunchConfig | null> | null = null;

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.desktopBridge?.isDesktop);
}

export async function getDesktopLaunchConfig(): Promise<DesktopLaunchConfig | null> {
  if (typeof window === 'undefined' || !window.desktopBridge?.getLaunchConfig) {
    return null;
  }

  if (!launchConfigPromise) {
    launchConfigPromise = window.desktopBridge
      .getLaunchConfig()
      .then((config) => config)
      .catch(() => null);
  }

  return launchConfigPromise;
}
