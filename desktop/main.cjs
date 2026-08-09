const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const path = require('path');

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BACKEND_PORT = 3001;
const MEDIA_SERVER_PORT = 3002;
const FRONTEND_PORT = 3000;

// ponytail: skip build in dev, use tsx watch + next dev directly
const IS_DEV = process.env.ELECTRON_DEV === '1';

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let backendProcess = null;
/** @type {import('child_process').ChildProcess | null} */
let mediaServerProcess = null;
/** @type {http.Server | null} */
let frontendServer = null;
let isQuitting = false;

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
  // Only seed from the bundled defaults on first run — copying unconditionally on every
  // launch would wipe out any remotes the user added afterwards via the in-app config UI.
  if (!fs.existsSync(rcloneConfigPath)) {
    await fsp.copyFile(rcloneDefaultsFile, rcloneConfigPath);
  }

  const secrets = await loadOrCreateSecrets(runtimeDir);
  const dbPath = path.join(runtimeDir, 'media-discovery.db');
  await migrateLegacyDatabase(dbPath);

  runtimeState.startupConfig = {
    mediaServerSecret: secrets.mediaServerSecret,
    jwtSecret: secrets.jwtSecret,
    desktopDefaultUserName: defaults.desktopDefaultUserName || 'Desktop User',
    dbPath,
    rcloneConfigPath,
    runtimeDir,
    logsDir,
  };
}

// Older builds bundled the SQLite DB inside the app package itself
// (backend/media-discovery.db), so each update silently replaced it with the
// developer's bundled copy. Carry that data over once into the persistent
// userData location so upgrading users don't lose their library/likes/saves.
async function migrateLegacyDatabase(dbPath) {
  if (fs.existsSync(dbPath)) {
    return;
  }

  const legacyDbPath = getAppCodePath('backend', 'media-discovery.db');
  if (!fs.existsSync(legacyDbPath)) {
    return;
  }

  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${legacyDbPath}${suffix}`;
    const destination = `${dbPath}${suffix}`;
    if (fs.existsSync(source)) {
      await fsp.copyFile(source, destination);
    }
  }
}

async function loadOrCreateSecrets(runtimeDir) {
  const secretsFile = path.join(runtimeDir, 'secrets.json');

  try {
    const raw = await fsp.readFile(secretsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.jwtSecret && parsed.mediaServerSecret) {
      return parsed;
    }
  } catch {
    // No secrets file yet, generate one below.
  }

  const secrets = {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    mediaServerSecret: crypto.randomBytes(32).toString('hex'),
  };

  await fsp.writeFile(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  return secrets;
}

/**
 * Spawn a service, wait for it to report healthy, and retry on a fresh port if
 * it lost a race for its preferred one (EADDRINUSE). Shared by startBackend and
 * startMediaServer — they differ only in spawn args, port, and health URL.
 */
async function startManagedService({ label, getPort, setPort, healthUrl, spawnFn }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const port = getPort();
    let combinedOutput = '';
    console.log(`Attempt ${attempt + 1}: starting ${label} on port ${port}`);

    const child = spawnFn(port);
    child.on('error', (err) => {
      console.error(`${label} spawn error:`, err);
    });
    child.stdout?.on('data', (chunk) => {
      combinedOutput += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      combinedOutput += chunk.toString();
    });
    pipeChildLogs(label, child);

    const exitPromise = watchProcessExit(child).then((exitInfo) => ({ ok: false, exitInfo }));
    const healthPromise = waitForHealth(healthUrl(port), 45000).then(() => ({ ok: true }));
    const result = await Promise.race([healthPromise, exitPromise]);

    if (result.ok) {
      child.on('exit', (code, signal) => {
        if (!isQuitting) {
          dialog.showErrorBox(`${label} stopped`, `${label} exited unexpectedly (code=${code}, signal=${signal || 'none'}).`);
          app.quit();
        }
      });
      return child;
    }

    if (combinedOutput.includes('EADDRINUSE')) {
      setPort(await findAvailablePort(0));
      continue;
    }

    throw new Error(formatExitMessage(label, result.exitInfo));
  }

  throw new Error(`${label} failed to acquire an available port after multiple attempts.`);
}

async function startBackend() {
  const cfg = runtimeState.startupConfig;
  const backendDir = getAppCodePath('backend');
  const nodeRuntime = IS_DEV ? { env: {} } : getNodeRuntime();
  const [spawnCmd, spawnArgs, spawnCwd] = IS_DEV
    ? [path.join(backendDir, 'node_modules', '.bin', 'tsx'), ['watch', 'src/index.ts'], backendDir]
    : [nodeRuntime.command, [getAppCodePath('backend', 'dist', 'index.js')], getAppCodePath('backend', 'dist')];

  backendProcess = await startManagedService({
    label: 'Backend',
    getPort: () => runtimeState.ports.backend,
    setPort: (port) => { runtimeState.ports.backend = port; },
    healthUrl: (port) => `http://127.0.0.1:${port}/api/health`,
    spawnFn: (port) => spawn(spawnCmd, spawnArgs, {
      env: {
        ...process.env,
        ...nodeRuntime.env,
        NODE_ENV: IS_DEV ? 'development' : 'production',
        PORT: String(port),
        JWT_SECRET: cfg.jwtSecret,
        MEDIA_SERVER_SECRET: cfg.mediaServerSecret,
        DB_PATH: cfg.dbPath,
        RCLONE_CONFIG: cfg.rcloneConfigPath,
      },
      cwd: spawnCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  });
}

async function startMediaServer() {
  const cfg = runtimeState.startupConfig;
  const mediaDir = getAppCodePath('media-server');
  const nodeRuntime = IS_DEV ? { env: {} } : getNodeRuntime();
  const [spawnCmd, spawnArgs, spawnCwd] = IS_DEV
    ? [path.join(mediaDir, 'node_modules', '.bin', 'tsx'), ['watch', 'src/index.ts'], mediaDir]
    : [nodeRuntime.command, [getAppCodePath('media-server', 'dist', 'index.js')], getAppCodePath('media-server', 'dist')];

  mediaServerProcess = await startManagedService({
    label: 'Media service',
    getPort: () => runtimeState.ports.mediaServer,
    setPort: (port) => { runtimeState.ports.mediaServer = port; },
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    spawnFn: (port) => spawn(spawnCmd, spawnArgs, {
      env: {
        ...process.env,
        ...nodeRuntime.env,
        NODE_ENV: IS_DEV ? 'development' : 'production',
        PORT: String(port),
        MEDIA_SERVER_SECRET: cfg.mediaServerSecret,
        CACHE_DIR: path.join(cfg.runtimeDir, 'media-cache'),
        KEYFILE_PATH: path.join(cfg.runtimeDir, '.media-server-key'),
        RCLONE_CONFIG: cfg.rcloneConfigPath,
        // Backend may have been bumped off its preferred port (EADDRINUSE) —
        // media-server's internal /connection lookup needs the real port, not its 3001 default.
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${runtimeState.ports.backend}`,
      },
      cwd: spawnCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  });
}

async function startFrontendServer() {
  if (IS_DEV) {
    const frontendDir = getAppCodePath('frontend');
    const nextBin = path.join(frontendDir, 'node_modules', '.bin', 'next');
    const devPort = runtimeState.ports.frontend;
    console.log(`Dev mode: starting next dev on port ${devPort}`);
    // ponytail: frontendServer stays null in dev; cleanup in shutdownChildren handles the next dev process via backendProcess/mediaServerProcess list
    const nextProc = spawn(nextBin, ['dev', '-H', '127.0.0.1', '-p', String(devPort)], {
      cwd: frontendDir,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipeChildLogs('frontend', nextProc);
    nextProc.on('exit', (code, signal) => {
      if (!isQuitting) {
        dialog.showErrorBox('Frontend stopped', `next dev exited (code=${code}, signal=${signal || 'none'}).`);
        app.quit();
      }
    });
    // reuse the frontendServer slot so shutdownChildren can kill it
    frontendServer = /** @type {any} */ (nextProc);
    await waitForHealth(`http://127.0.0.1:${devPort}`, 60000);
    return;
  }

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

  // Give the backend time to unmount rclone cleanly (diskutil/umount/fusermount + pkill,
  // each with their own short timeouts) before SIGKILL. The mount service self-heals stale
  // mounts on next startup regardless, but a clean unmount avoids leaving one behind at all.
  await new Promise((resolve) => setTimeout(resolve, 6000));

  for (const child of stopList) {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }

  backendProcess = null;
  mediaServerProcess = null;

  if (frontendServer) {
    if (IS_DEV) {
      frontendServer.kill('SIGTERM');
    } else {
      await new Promise((resolve) => frontendServer.close(() => resolve()));
    }
    frontendServer = null;
  }
}

ipcMain.handle('desktop:get-launch-config', async () => {
  return {
    isDesktop: true,
    apiPort: runtimeState.ports.backend,
    mediaServerPort: runtimeState.ports.mediaServer,
  };
});

ipcMain.handle('desktop:get-auto-pin', async () => {
  const filePath = path.join(runtimeState.startupConfig.runtimeDir, 'auto-pin.enc');

  try {
    const encrypted = await fsp.readFile(filePath);
    if (!safeStorage.isEncryptionAvailable()) {
      return { pin: null };
    }
    return { pin: safeStorage.decryptString(encrypted) };
  } catch {
    return { pin: null };
  }
});

ipcMain.handle('desktop:quit-app', async () => {
  app.quit();
});

ipcMain.handle('desktop:show-in-folder', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('A file path is required.');
  }
  shell.showItemInFolder(filePath);
});

ipcMain.handle('desktop:open-file', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('A file path is required.');
  }
  const error = await shell.openPath(filePath);
  if (error) {
    throw new Error(error);
  }
});

ipcMain.handle('desktop:create-auto-pin', async () => {
  const filePath = path.join(runtimeState.startupConfig.runtimeDir, 'auto-pin.enc');
  const pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system.');
  }

  const encrypted = safeStorage.encryptString(pin);
  await fsp.writeFile(filePath, encrypted, { mode: 0o600 });
  return { pin };
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

app.on('activate', () => {
  // macOS: clicking the dock icon (or re-launching while running) should
  // re-open the window. Recreate it if it was closed, otherwise focus it.
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  } else if (!isQuitting) {
    createMainWindow();
  }
});

app.whenReady().then(async () => {
  try {
    await prepareRuntimeDefaults();
    await assignRuntimePorts();
    await startBackend();
    await startMediaServer();
    await startFrontendServer();
    createMainWindow();
  } catch (error) {
    dialog.showErrorBox('Startup failed', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});
