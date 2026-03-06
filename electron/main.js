const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const VITE_PORT   = 7000;
const SERVER_PORT = 7001;

let mainWindow   = null;
let serverProcess = null;

// ── Detect whether the Vite dev server is already running ─────────────────────
function isPortListening(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      res.resume();
      resolve(true);
    });
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

// ── Start the Express backend (production mode only) ──────────────────────────
function startServer() {
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
  if (tries > 40) { console.error('Backend did not start in time'); cb(); return; }
  const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
    res.resume(); cb();
  });
  req.on('error', () => setTimeout(() => waitForServer(cb, tries + 1), 500));
  req.end();
}

// ── Create the browser window ─────────────────────────────────────────────────
function createWindow(devMode) {
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

  if (devMode) {
    // Dev: load from the running Vite dev server
    mainWindow.loadURL(`http://localhost:${VITE_PORT}`);
  } else {
    // Production: load built static files
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const viteRunning = await isPortListening(VITE_PORT);

  if (viteRunning) {
    // Dev mode: Vite is already running — just open the window
    console.log(`[electron] Dev server detected on :${VITE_PORT} — loading dev UI`);
    createWindow(true);
  } else {
    // Production mode: start backend, wait, then load built dist
    console.log('[electron] No dev server — starting backend and loading dist/');
    startServer();
    waitForServer(() => createWindow(false));
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
