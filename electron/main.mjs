import * as electron from 'electron/main';
const { app, BrowserWindow, shell } = electron;
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === 'development';
const SERVER_PORT = 7001;

let mainWindow = null;
let serverProcess = null;

function startServer() {
  const { spawn } = require('child_process');
  const serverPath = path.join(__dirname, '..', 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: 'inherit',
  });
  serverProcess.on('error', (err) => {
    console.error('Server process error:', err);
  });
}

function waitForServer(cb, tries = 0) {
  if (tries > 30) {
    console.error('Backend did not start in time');
    cb();
    return;
  }
  const req = http.get(`http://localhost:${SERVER_PORT}/api/stock/AAPL`, (res) => {
    res.resume();
    cb();
  });
  req.on('error', () => {
    setTimeout(() => waitForServer(cb, tries + 1), 500);
  });
  req.end();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Portfolio Signal Finder',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:7000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (!isDev) {
    startServer();
    waitForServer(createWindow);
  } else {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
