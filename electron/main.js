import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selecionar pasta de backup',
  });

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0] ?? null;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,

    // 🖼️ Ícone do app
    icon: path.join(__dirname, '../assets/icon.ico'),

    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // ❌ Remove o menu padrão
  Menu.setApplicationMenu(null);

  // Alternativa (opcional)
  win.setMenuBarVisibility(false);

  // 🌐 Dev
  win.loadURL('http://localhost:3000');

  // 📦 Prod
  // win.loadFile('out/index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});