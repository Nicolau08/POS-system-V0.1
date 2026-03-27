const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,

    // 🖼️ Ícone do app
    icon: path.join(__dirname, '../assets/icon.ico'),

    webPreferences: {
      contextIsolation: true,
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