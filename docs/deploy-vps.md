# VPS Deployment Guide

This guide assumes a single Ubuntu VPS running:
- BitStat API
- BitStat worker
- Redis
- Nginx

Supabase remains the hosted Postgres/Auth/Storage provider.

## Recommended VPS
- 2 vCPU
- 4 GB RAM
- 80 GB SSD

## 1. Install system packages
```bash
sudo apt update
sudo apt install -y nginx redis-server
```

Install Node.js 20:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Install PM2:
```bash
sudo npm install -g pm2
pm2 -v
```

## 2. Lock down Redis
Edit `/etc/redis/redis.conf`:
- keep `bind 127.0.0.1 ::1`
- keep protected mode enabled
- enable AOF persistence for better recovery

Then restart Redis:
```bash
sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

## 3. Copy the backend to the VPS
Example target path:
```bash
sudo mkdir -p /var/www/bitstat-backend
sudo chown -R $USER:$USER /var/www/bitstat-backend
cd /var/www/bitstat-backend
git clone https://github.com/bitstat-io/backend.git .
```

## 4. Configure environment
Create `.env` from `.env.example`:
```bash
cp .env.example .env
```

Minimum production values:
```env
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
REDIS_STREAM_ENV=prod
SUPABASE_DB_URL=postgresql://...
SUPABASE_JWT_SECRET=...
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
```

## 5. Install dependencies and build
```bash
cd /var/www/bitstat-backend
npm ci
npm run build
```

## 6. Bootstrap the database
Run:
- `db/schema.sql`
- optionally `db/seed.sql`

Use the Supabase SQL editor or any Postgres client connected to your production database.

## 7. Start API and worker with PM2
From the repo root:
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Useful commands:
```bash
pm2 status
pm2 logs bitstat-api
pm2 logs bitstat-worker
pm2 restart bitstat-api
pm2 restart bitstat-worker
```

## 8. Configure Nginx
Copy the template from `deploy/nginx/bitstat.conf` to `/etc/nginx/sites-available/bitstat` and replace `api.example.com` with your real domain.

Then enable it:
```bash
sudo ln -s /etc/nginx/sites-available/bitstat /etc/nginx/sites-enabled/bitstat
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## 9. Add TLS
If your DNS is pointed at the VPS:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

## 10. Verify the deployment
Health:
```bash
curl http://127.0.0.1:3000/v1/health
curl http://127.0.0.1:3000/v1/health/ready
```

Public endpoint:
```bash
curl https://api.example.com/v1/games
```

## Operational notes
- The API and worker are separate processes. Both must be running.
- Redis is required for ingest and public registry reads.
- Keep Redis private to localhost; do not expose port `6379` publicly.
- Use `ufw` or your cloud firewall to expose only `22`, `80`, and `443`.
