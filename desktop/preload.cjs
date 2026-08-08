const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  isDesktop: true,
  getLaunchConfig: async () => ipcRenderer.invoke('desktop:get-launch-config'),
  getAutoPin: async () => ipcRenderer.invoke('desktop:get-auto-pin'),
  createAutoPin: async () => ipcRenderer.invoke('desktop:create-auto-pin'),
  quitApp: async () => ipcRenderer.invoke('desktop:quit-app'),
});
