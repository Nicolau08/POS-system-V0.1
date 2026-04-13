import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: async () => {
    return ipcRenderer.invoke('dialog:selectFolder');
  },
});
