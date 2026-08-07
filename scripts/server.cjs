#!/usr/bin/env node
// ponytail: plain child_process fan-out instead of pulling in pm2/concurrently —
// backend/media-server/frontend already default to binding 0.0.0.0 (see their
// respective configs), so all this needs to do is start the three `npm run dev`
// scripts side by side and forward Ctrl+C. Reach for pm2 if you need auto-restart
// on crash or detached/background operation across terminal sessions.

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

const services = [
  { label: 'backend', dir: 'backend', port: 3001 },
  { label: 'media', dir: 'media-server', port: 3002 },
  { label: 'frontend', dir: 'frontend', port: 3000 },
];

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

const lanIp = lanAddress();
console.log(`\nStarting dev server stack — reachable on the LAN at http://${lanIp}:3000\n`);

const children = services.map(({ label, dir, port }) => {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: path.join(root, dir),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[${label}]`;
  child.stdout.on('data', (chunk) => process.stdout.write(`${prefix} ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`${prefix} ${chunk}`));
  child.on('exit', (code, signal) => {
    console.error(`${prefix} exited (code=${code}, signal=${signal || 'none'})`);
    // The Settings "Stop All Services" / header shutdown button only calls the
    // backend's /api/admin/shutdown, which exits just the backend process. Treat
    // that (or any other service dying) as a signal to tear down the whole stack
    // instead of leaving the rest running as orphans.
    shutdown();
  });

  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down...');
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => {
    for (const child of children) if (!child.killed) child.kill('SIGKILL');
    process.exit(0);
  }, 6000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
