const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const BACKEND_PORT = 3001;
const MEDIA_SERVER_PORT = 3002;
const FRONTEND_PORT = 3000;

/** @type {BrowserWindow | null} */
let unlockWindow = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let backendProcess = null;
/** @type {import('child_process').ChildProcess | null} */
let mediaServerProcess = null;
/** @type {http.Server | null} */
let frontendServer = null;
let isQuitting = false;
let isUnlocked = false;

const runtimeState = {
  startupConfig: null,
  ports: {
    backend: BACKEND_PORT,
    mediaServer: MEDIA_SERVER_PORT,
    frontend: FRONTEND_PORT,
  },
};

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({ port: resolvedPort, server });
    });
  });
}

async function findAvailablePort(preferredPort) {
  try {
    const result = await reservePort(preferredPort);
    await new Promise((resolve) => result.server.close(resolve));
    return result.port;
  } catch (error) {
    if (error && error.code !== 'EADDRINUSE') {
      throw error;
    }
    const result = await reservePort(0);
    await new Promise((resolve) => result.server.close(resolve));
    return result.port;
  }
}

async function assignRuntimePorts() {
  const reserved = [];

  try {
    reserved.push(await reservePort(0));
    reserved.push(await reservePort(0));
    reserved.push(await reservePort(0));

    runtimeState.ports = {
      backend: reserved[0].port,
      mediaServer: reserved[1].port,
      frontend: reserved[2].port,
    };

    console.log('Assigned ports:', runtimeState.ports);
  } finally {
    await Promise.all(
      reserved.map(({ server }) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
      ),
    );
  }
}

function resolveHome(input) {
  if (!input) return input;
  if (input === '~') return app.getPath('home');
  if (input.startsWith('~/')) {
    return path.join(app.getPath('home'), input.slice(2));
  }
  return input;
}

function getResourcePath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, 'resources', ...segments);
}

function getAppCodePath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', ...segments);
  }
  return path.join(__dirname, '..', ...segments);
}

function getNodeRuntime() {
  if (app.isPackaged) {
    return {
      command: process.execPath,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
      },
    };
  }

  return {
    command: process.env.DESKTOP_NODE_BINARY || process.env.NODE_BINARY || 'node',
    env: {},
  };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mapping = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
  };

  return mapping[ext] || 'application/octet-stream';
}

async function waitForHealth(url, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // Service may still be booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for service: ${url}`);
}

function pipeChildLogs(label, child) {
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });

  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });
}

function watchProcessExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

function formatExitMessage(name, exitInfo) {
  return `${name} exited unexpectedly (code=${exitInfo.code}, signal=${exitInfo.signal || 'none'}).`;
}

async function prepareRuntimeDefaults() {
  const defaultsFile = getResourcePath('defaults', 'app-defaults.json');
  const rcloneDefaultsFile = getResourcePath('defaults', 'rclone.conf');
  const rawDefaults = await fsp.readFile(defaultsFile, 'utf-8');
  const defaults = JSON.parse(rawDefaults);

  const runtimeDir = path.join(app.getPath('userData'), 'runtime');
  const rcloneDir = path.join(runtimeDir, 'rclone');
  const logsDir = path.join(runtimeDir, 'logs');

  await fsp.mkdir(runtimeDir, { recursive: true });
  await fsp.mkdir(rcloneDir, { recursive: true });
  await fsp.mkdir(logsDir, { recursive: true });

  const rcloneConfigPath = path.join(rcloneDir, 'rclone.conf');
  await fsp.copyFile(rcloneDefaultsFile, rcloneConfigPath);

  const configuredDefaultRoot = resolveHome(defaults.defaultRootFolder || '~/Pictures');
  const defaultRootFolder = configuredDefaultRoot || path.join(app.getPath('home'), 'Pictures');
  await fsp.mkdir(defaultRootFolder, { recursive: true });

  runtimeState.startupConfig = {
    launchPin: defaults.launchPin || '155102',
    autoLoginPin: defaults.autoLoginPin || '155102',
    defaultRootFolder,
    mediaServerSecret: defaults.mediaServerSecret || 'desktop-local-media-secret-155102',
    jwtSecret: defaults.jwtSecret || 'desktop-local-jwt-secret-155102',
    desktopDefaultUserName: defaults.desktopDefaultUserName || 'Desktop User',
    rcloneConfigPath,
    runtimeDir,
    logsDir,
  };
}

async function startBackend() {
  const backendScript = getAppCodePath('backend', 'dist', 'index.js');
  const cfg = runtimeState.startupConfig;
  const nodeRuntime = getNodeRuntime();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const backendPort = runtimeState.ports.backend;
    let combinedOutput = '';
    console.log(`Attempt ${attempt + 1}: starting backend on port ${backendPort} using ${nodeRuntime.command}`);

    backendProcess = spawn(nodeRuntime.command, [backendScript], {
      env: {
        ...process.env,
        ...nodeRuntime.env,
        NODE_ENV: 'production',
        PORT: String(backendPort),
        JWT_SECRET: cfg.jwtSecret,
        MEDIA_SERVER_SECRET: cfg.mediaServerSecret,
        AUTO_CREATE_DEFAULT_USER: 'true',
        DESKTOP_DEFAULT_PIN: cfg.autoLoginPin,
        DESKTOP_DEFAULT_USER_NAME: cfg.desktopDefaultUserName,
        RCLONE_CONFIG: cfg.rcloneConfigPath,
      },
      cwd: path.dirname(backendScript),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    backendProcess.stdout?.on('data', (chunk) => {
      combinedOutput += chunk.toString();
    });
    backendProcess.stderr?.on('data', (chunk) => {
      combinedOutput += chunk.toString();
    });
    pipeChildLogs('backend', backendProcess);

    const exitPromise = watchProcessExit(backendProcess).then((exitInfo) => ({ ok: false, exitInfo }));
    const healthPromise = waitForHealth(`http://127.0.0.1:${backendPort}/api/health`, 45000).then(() => ({ ok: true }));
    const result = await Promise.race([healthPromise, exitPromise]);

    if (result.ok) {
      backendProcess.on('exit', (code, signal) => {
        if (!isQuitting) {
          dialog.showErrorBox('Backend stopped', `Backend exited unexpectedly (code=${code}, signal=${signal || 'none'}).`);
          app.quit();
        }
      });
      return;
    }

    if (combinedOutput.includes('EADDRINUSE')) {
      runtimeState.ports.backend = await findAvailablePort(0);
      continue;
    }

    throw new Error(formatExitMessage('Backend', result.exitInfo));
  }

  throw new Error('Backend failed to acquire an available port after multiple attempts.');
}

async function startMediaServer() {
  const mediaScript = getAppCodePath('media-server', 'dist', 'index.js');
  const cfg = runtimeState.startupConfig;
  const nodeRuntime = getNodeRuntime();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const mediaServerPort = runtimeState.ports.mediaServer;
    let combinedOutput = '';
    console.log(`Attempt ${attempt + 1}: starting media-server on port ${mediaServerPort} using ${nodeRuntime.command}`);

    mediaServerProcess = spawn(nodeRuntime.command, [mediaScript], {
      env: {
        ...process.env,
        ...nodeRuntime.env,
        NODE_ENV: 'production',
        PORT: String(mediaServerPort),
        MEDIA_SERVER_SECRET: cfg.mediaServerSecret,
        CACHE_DIR: path.join(cfg.runtimeDir, 'media-cache'),
        KEYFILE_PATH: path.join(cfg.runtimeDir, '.media-server-key'),
        RCLONE_CONFIG: cfg.rcloneConfigPath,
      },
      cwd: path.dirname(mediaScript),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    mediaServerProcess.stdout?.on('data', (chunk) => {
      combinedOutput += chunk.toString();
    });
    mediaServerProcess.stderr?.on('data', (chunk) => {
      combinedOutput += chunk.toString();
    });
    pipeChildLogs('media-server', mediaServerProcess);

    const exitPromise = watchProcessExit(mediaServerProcess).then((exitInfo) => ({ ok: false, exitInfo }));
    const healthPromise = waitForHealth(`http://127.0.0.1:${mediaServerPort}/health`, 45000).then(() => ({ ok: true }));
    const result = await Promise.race([healthPromise, exitPromise]);

    if (result.ok) {
      mediaServerProcess.on('exit', (code, signal) => {
        if (!isQuitting) {
          dialog.showErrorBox('Media service stopped', `Media service exited unexpectedly (code=${code}, signal=${signal || 'none'}).`);
          app.quit();
        }
      });
      return;
    }

    if (combinedOutput.includes('EADDRINUSE')) {
      runtimeState.ports.mediaServer = await findAvailablePort(0);
      continue;
    }

    throw new Error(formatExitMessage('Media service', result.exitInfo));
  }

  throw new Error('Media service failed to acquire an available port after multiple attempts.');
}

async function startFrontendServer() {
  const frontendDir = getAppCodePath('frontend', 'out');
  const frontendPort = runtimeState.ports.frontend;

  if (!fs.existsSync(frontendDir)) {
    throw new Error(`Frontend export directory not found at ${frontendDir}. Run the root build before launching desktop.`);
  }

  frontendServer = http.createServer(async (req, res) => {
    const reqUrl = req.url || '/';
    const urlPath = reqUrl.split('?')[0];
    const normalizedPath = decodeURIComponent(urlPath).replace(/\\/g, '/');

    let candidate = path.join(frontendDir, normalizedPath === '/' ? 'index.html' : normalizedPath);

    try {
      const stat = await fsp.stat(candidate);
      if (stat.isDirectory()) {
        candidate = path.join(candidate, 'index.html');
      }
    } catch {
      if (!path.extname(candidate)) {
        candidate = `${candidate}.html`;
      }
    }

    let finalPath = candidate;

    if (!finalPath.startsWith(frontendDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(finalPath)) {
      finalPath = path.join(frontendDir, 'index.html');
    }

    try {
      const content = await fsp.readFile(finalPath);
      res.writeHead(200, { 'Content-Type': getContentType(finalPath) });
      res.end(content);
    } catch (_error) {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    frontendServer.listen(frontendPort, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createUnlockWindow() {
  unlockWindow = new BrowserWindow({
    width: 420,
    height: 320,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    title: 'Unlock Local Media Discovery',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  unlockWindow.loadFile(path.join(__dirname, 'unlock.html'));

  unlockWindow.on('closed', () => {
    unlockWindow = null;
    if (!isUnlocked) {
      app.quit();
    }
  });
}

function createMainWindow() {
  if (mainWindow) {
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'Local Media Discovery',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const launchUrl = new URL(`http://127.0.0.1:${runtimeState.ports.frontend}`);
  launchUrl.searchParams.set('apiPort', String(runtimeState.ports.backend));
  launchUrl.searchParams.set('mediaServerPort', String(runtimeState.ports.mediaServer));

  mainWindow.loadURL(launchUrl.toString());

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdownChildren() {
  const stopList = [backendProcess, mediaServerProcess].filter(Boolean);

  for (const child of stopList) {
    child.kill('SIGTERM');
  }

  await new Promise((resolve) => setTimeout(resolve, 3000));

  for (const child of stopList) {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }

  backendProcess = null;
  mediaServerProcess = null;

  if (frontendServer) {
    await new Promise((resolve) => frontendServer.close(() => resolve()));
    frontendServer = null;
  }
}

ipcMain.handle('desktop:submit-unlock-pin', async (_event, pin) => {
  const launchPin = runtimeState.startupConfig?.launchPin || '155102';
  if (pin !== launchPin) {
    return { success: false, message: 'Incorrect unlock PIN' };
  }

  isUnlocked = true;
  if (unlockWindow) {
    unlockWindow.close();
    unlockWindow = null;
  }

  createMainWindow();
  return { success: true };
});

ipcMain.handle('desktop:get-launch-config', async () => {
  const cfg = runtimeState.startupConfig;
  return {
    isDesktop: true,
    autoLoginPin: cfg?.autoLoginPin || null,
    defaultRootFolder: cfg?.defaultRootFolder || null,
    apiPort: runtimeState.ports.backend,
    mediaServerPort: runtimeState.ports.mediaServer,
  };
});

app.on('before-quit', async (event) => {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  event.preventDefault();
  await shutdownChildren();
  app.exit(0);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(async () => {
  try {
    await prepareRuntimeDefaults();
    await assignRuntimePorts();
    await startBackend();
    await startMediaServer();
    await startFrontendServer();
    createUnlockWindow();
  } catch (error) {
    dialog.showErrorBox('Startup failed', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});
