module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'dist/index.js',
      cwd: './backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'media-server',
      script: 'dist/index.js',
      cwd: './media-server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        // MEDIA_SERVER_SECRET must match the value set in the backend env.
        // Set it via: pm2 set media-server MEDIA_SERVER_SECRET <secret>
        // or inject via a .env file before starting.
      },
      error_file: './logs/media-server-error.log',
      out_file: './logs/media-server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'frontend',
      script: 'npx',
      args: 'serve -s ./out -l 3000',
      cwd: './frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        API_PORT: 3001
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      // Mounts hetzner-crypt remote via rclone FUSE.
      // Started on ecosystem boot; stopped by rclone-watchdog on inactivity.
      // Re-started automatically when the website calls /api/rclone/mount/ensure.
      name: 'rclone-mount',
      script: './scripts/rclone-mount.sh',
      interpreter: 'bash',
      cwd: '.',
      instances: 1,
      autorestart: false,
      watch: false,
      env: {
        RCLONE_MOUNT_DIR: process.env.RCLONE_MOUNT_DIR || `${process.env.HOME}/hetzner_mount`,
        RCLONE_CACHE_DIR: process.env.RCLONE_CACHE_DIR || `${process.env.HOME}/rclone-cache`
      },
      error_file: './logs/rclone-mount-error.log',
      out_file: './logs/rclone-mount-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      // Watches the rclone mount and stops it after 10 min of inactivity.
      // Always running; restarts automatically if it crashes.
      name: 'rclone-watchdog',
      script: './scripts/rclone-watchdog.sh',
      interpreter: 'bash',
      cwd: '.',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        RCLONE_MOUNT_DIR: process.env.RCLONE_MOUNT_DIR || `${process.env.HOME}/hetzner_mount`
      },
      error_file: './logs/rclone-watchdog-error.log',
      out_file: './logs/rclone-watchdog-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
