import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: async () => {
    return ipcRenderer.invoke('dialog:selectFolder');
  },
  getAppPaths: async () => {
    return ipcRenderer.invoke('app:getPaths');
  },
  getMachineId: async () => {
    return ipcRenderer.invoke('system:getMachineId');
  },
  getActivationState: async () => {
    return ipcRenderer.invoke('activation:getState');
  },
  activateLicense: async (licenseKey) => {
    return ipcRenderer.invoke('activation:activate', { licenseKey });
  },
  restartApp: async () => {
    return ipcRenderer.invoke('app:restart');
  },
  printReceipt: async (html) => {
    return ipcRenderer.invoke('print:receipt', { html });
  },
});
