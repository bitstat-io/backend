module.exports = {
  apps: [
    {
      name: 'bitstat-api',
      cwd: __dirname,
      script: 'dist/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'bitstat-worker',
      cwd: __dirname,
      script: 'dist/workers/events-worker.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
