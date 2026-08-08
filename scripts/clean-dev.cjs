#!/usr/bin/env node
/**
 * Dev cleanup: removes compiled output (dist/out/.next) and the Electron
 * app's userData directory (runtime db, rclone config, secrets, cache).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');

// Electron defaults app.getName() to "Electron" when run unpackaged via
// `electron desktop/main.cjs` (npm run desktop:dev), and to the packaged
// productName once built with electron-builder.
const ELECTRON_APP_NAMES = ['Electron', 'Local Media Discovery', 'local-media-discovery-app'];

function getElectronUserDataDirs() {
  const home = os.homedir();
  return ELECTRON_APP_NAMES.map((name) => {
    switch (process.platform) {
      case 'darwin':
        return path.join(home, 'Library', 'Application Support', name);
      case 'win32':
        return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), name);
      default:
        return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), name);
    }
  });
}

const targets = [
  path.join(root, 'backend', 'dist'),
  path.join(root, 'media-server', 'dist'),
  path.join(root, 'frontend', 'out'),
  path.join(root, 'frontend', '.next'),
  // Only the app's own "runtime" subdir (db, cache, secrets, rclone config) —
  // not the whole Electron userData dir, which is shared with other dev apps.
  ...getElectronUserDataDirs().map((dir) => path.join(dir, 'runtime')),
];

for (const target of targets) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`Removed ${target}`);
  } else {
    console.log(`Skipped (not found) ${target}`);
  }
}
