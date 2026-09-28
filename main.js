const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

// Global error shielding - prevents ECONNRESET dialogs from crashing the UI
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT' || err.message?.includes('ECONNRESET'))) {
    console.warn('[Process] Suppressed network exception:', err.message);
    return;
  }
  console.error('[Process] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Process] Suppressed unhandled rejection:', reason);
});

let mainWindow;
// Backend is loaded inline during app's lifecycle

// ─── Window Creation ──────────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,           // Custom title bar
    transparent: false,
    backgroundColor: '#0d0f13',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      devTools: !app.isPackaged, // Disable devTools in production
    },
    show: false,
    titleBarStyle: 'hidden',
  });

  // Load app
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
  } else {
    // In dev, load from the built frontend dist
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Disable developer tools in production
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
      if (input.key === 'F12' || 
          (input.control && input.shift && (input.key === 'I' || input.key === 'J')) ||
          (input.control && input.key === 'U')) {
        event.preventDefault();
      }
    });

    // Disable right-click context menu
    mainWindow.webContents.on('context-menu', (event) => {
      event.preventDefault();
    });

    // Disable developer tools completely
    mainWindow.webContents.setDevToolsWebContents(null);
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── IPC Handlers (Custom Title Bar) ─────────────────────────────────────────
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('open-file-dialog', async (event, options = {}) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options.filters || [
      { name: 'Media Files', extensions: ['mp3', 'mp4', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'webm', 'mkv'] },
      { name: 'VST Plugins', extensions: ['dll', 'vst3'] },
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

app.whenReady().then(async () => {
  console.log('Electron app ready. Configuring permissions & backend...');
  
  // Grant microphone, camera, media and display capture permissions
  const { desktopCapturer } = require('electron');
  if (session.defaultSession) {
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      return true;
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });

    if (typeof session.defaultSession.setDisplayMediaRequestHandler === 'function') {
      session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
          if (sources && sources.length > 0) {
            callback({ video: sources[0], audio: 'loopback' });
          } else {
            callback({});
          }
        } catch (e) {
          console.error('[DisplayMedia] Error selecting capture source:', e);
          callback({});
        }
      });
    }
  }

  try {
    process.env.USER_DATA_PATH = app.getPath('userData');
    process.env.PORT = '3001';
    require('./backend/server.js');
    console.log('Backend loaded successfully! Creating window...');
  } catch (err) {
    console.error('Failed to require backend:', err);
  }
  
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
