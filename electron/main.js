'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const VITE_PORT   = 7000;
const SERVER_PORT = 7099;
const isDev       = process.env.NODE_ENV === 'development';

let mainWindow   = null;
let serverProcess = null;

// ── Start the Express backend (production mode only) ──────────────────────────
function startServer() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: 'inherit',
  });
  serverProcess.on('error', (err) => console.error('Server error:', err));
}

function waitForServer(cb, tries = 0) {
  if (tries > 40) { console.error('Backend did not start'); cb(); return; }
  const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
    res.resume(); cb();
  });
  req.on('error', () => setTimeout(() => waitForServer(cb, tries + 1), 500));
  req.end();
}

// ── Create the browser window ─────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Portfolio Signal Finder',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${VITE_PORT}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Fix GPU cache / network service crash errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('no-sandbox');

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (isDev) {
    createWindow();
  } else {
    startServer();
    waitForServer(createWindow);
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
