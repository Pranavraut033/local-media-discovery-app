export interface DesktopLaunchConfig {
  isDesktop: boolean;
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

export async function getAutoPin(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.desktopBridge?.getAutoPin) {
    return null;
  }

  try {
    const result = await window.desktopBridge.getAutoPin();
    return result?.pin ?? null;
  } catch {
    return null;
  }
}

export async function quitDesktopApp(): Promise<void> {
  if (typeof window === 'undefined' || !window.desktopBridge?.quitApp) {
    return;
  }

  await window.desktopBridge.quitApp();
}

export async function createAutoPin(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.desktopBridge?.createAutoPin) {
    return null;
  }

  try {
    const result = await window.desktopBridge.createAutoPin();
    return result?.pin ?? null;
  } catch {
    return null;
  }
}
