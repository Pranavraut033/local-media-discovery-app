const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  isDesktop: true,
  submitUnlockPin: async (pin) => ipcRenderer.invoke('desktop:submit-unlock-pin', pin),
  getLaunchConfig: async () => ipcRenderer.invoke('desktop:get-launch-config'),
});
