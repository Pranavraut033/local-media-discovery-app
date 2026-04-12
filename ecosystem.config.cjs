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
    }
  ]
};
