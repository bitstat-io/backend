import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import { env } from './config/env';
import { registerRoutes } from './routes';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: 'info',
    },
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW_MS,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'BitStat API',
        version: '0.1.0',
        description:
          'BitStat MVP API for game analytics ingestion and public leaderboards.\n\n' +
          'Quick start:\n' +
          '1. Ingest events with `POST /v1/events/batch` using your API key.\n' +
          '2. Fetch public leaderboards with `GET /v1/games/{gameSlug}/leaderboards` (prod)\n' +
          '   or `GET /v1/games/dev/{gameSlug}/leaderboards` (dev).\n' +
          '3. Use owner JWT routes under `GET /v1/dashboard/games/{gameSlug}/...`\n' +
          '   for dashboard stats, overview, and live stream data.\n\n' +
          'Authentication:\n' +
          '- Provide `X-API-Key: <key>` (or `Authorization: Bearer <key>`) for protected endpoints.\n' +
          '- Provide `Authorization: Bearer <Supabase access token>` for owner dashboard endpoints.',
      },
      tags: [
        { name: 'Ingest', description: 'Event ingestion endpoints' },
        { name: 'Leaderboards', description: 'Public leaderboard endpoints' },
        { name: 'Games', description: 'Public game discovery endpoints' },
        { name: 'Stats', description: 'Per-player stats endpoints' },
        { name: 'Scoring', description: 'Per-game scoring rules' },
        { name: 'Dashboard', description: 'Admin dashboard endpoints' },
        { name: 'Health', description: 'Service health checks' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject(input: any) {
      const api = input.openapiObject as any;
      const paths = api.paths ?? {};

      const ingestExample = {
        events: [
          {
            user_id: 'player_123',
            session_id: 'session_abc',
            client_ts: 1761246154,
            category: 'design',
            event_id: 'match_complete',
            game_type: 'fps',
            platform: 'pc',
            region: 'na',
            event_properties: {
              kills: 8,
              deaths: 3,
              assists: 2,
            },
          },
          {
            user_id: 'player_991',
            session_id: 'session_xyz',
            client_ts: 1761246160,
            category: 'business',
            event_id: 'purchase',
            game_type: 'mobile',
            platform: 'mobile',
            region: 'eu',
            event_properties: {
              coins: 1200,
              level: 12,
              iap_amount: 4.99,
            },
          },
        ],
      };

      const setRequestExample = (path: string, method: string, example: unknown) => {
        const operation = paths?.[path]?.[method];
        const content = operation?.requestBody?.content;
        const json = content?.['application/json'];
        if (json) {
          json.example = example;
        }
      };

      const setResponseExample = (path: string, method: string, status: string, example: unknown) => {
        const operation = paths?.[path]?.[method];
        const content = operation?.responses?.[status]?.content;
        const json = content?.['application/json'];
        if (json) {
          json.example = example;
        }
      };

      setRequestExample('/v1/events/batch', 'post', ingestExample);
      setResponseExample('/v1/events/batch', 'post', '200', { accepted: 2, rejected: 0 });

      setResponseExample('/v1/games', 'get', '200', {
        games: [
          {
            game_slug: 'tetris',
            name: 'Tetris',
            game_type: 'puzzle',
            cover_image_url: 'https://cdn.example.com/games/tetris.png',
          },
          {
            game_slug: 'space-racer',
            name: 'Space Racer',
            game_type: 'racer',
            cover_image_url: 'https://cdn.example.com/games/space-racer.png',
          },
        ],
      });

      setResponseExample('/v1/games/{gameSlug}/leaderboards', 'get', '200', {
        game: {
          slug: 'tetris',
          name: 'Tetris',
          game_type: 'puzzle',
          cover_image_url: 'https://cdn.example.com/games/tetris.png',
        },
        window: '1d',
        entries: [
          { rank: 1, user_id: 'player_123', score: 230 },
          { rank: 2, user_id: 'player_991', score: 210 },
        ],
      });

      setResponseExample('/v1/games/dev/{gameSlug}/leaderboards', 'get', '200', {
        game: {
          slug: 'tetris',
          name: 'Tetris',
          game_type: 'puzzle',
          cover_image_url: 'https://cdn.example.com/games/tetris.png',
        },
        window: '1d',
        entries: [
          { rank: 1, user_id: 'player_123', score: 230 },
          { rank: 2, user_id: 'player_991', score: 210 },
        ],
      });

      setResponseExample('/v1/games/{gameSlug}/stats', 'get', '200', {
        gameSlug: 'tetris',
        user_id: 'player_123',
        stats: {
          events: '42',
          kills: '12',
          deaths: '4',
          assists: '9',
          matches: '3',
        },
      });

      setResponseExample('/v1/dashboard/games/{gameSlug}/stats', 'get', '200', {
        gameSlug: 'tetris',
        user_id: 'player_123',
        stats: {
          events: '42',
          kills: '12',
          deaths: '4',
          assists: '9',
          matches: '3',
        },
      });

      return api;
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
      defaultModelsExpandDepth: -1,
      defaultModelExpandDepth: 2,
    },
    theme: {
      title: 'BitStat API Docs',
      js: [
        {
          filename: 'bitstat-theme.js',
          content: `
            (function () {
              const STORAGE_KEY = 'bitstat:docs:theme';
              const DEFAULT_THEME = 'dark';

              function applyTheme(theme) {
                document.body.classList.remove('theme-dark', 'theme-light');
                document.body.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
                document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
              }

              function currentTheme() {
                const stored = window.localStorage.getItem(STORAGE_KEY);
                return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
              }

              function setTheme(theme) {
                window.localStorage.setItem(STORAGE_KEY, theme);
                applyTheme(theme);
                updateLabel(theme);
              }

              function updateLabel(theme) {
                const btn = document.getElementById('bitstat-theme-toggle');
                if (!btn) return;
                const next = theme === 'light' ? 'dark' : 'light';
                btn.textContent = next === 'light' ? 'Light mode' : 'Dark mode';
                btn.setAttribute('aria-label', 'Switch to ' + next + ' mode');
              }

              function mountToggle() {
                const topbar = document.querySelector('.swagger-ui .topbar .topbar-wrapper');
                if (!topbar) return false;
                if (document.getElementById('bitstat-theme-toggle')) return true;

                const button = document.createElement('button');
                button.id = 'bitstat-theme-toggle';
                button.type = 'button';
                button.className = 'bitstat-theme-toggle';
                button.addEventListener('click', function () {
                  const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
                  setTheme(next);
                });
                topbar.appendChild(button);
                updateLabel(currentTheme());
                return true;
              }

              function init() {
                applyTheme(currentTheme());
                if (mountToggle()) return;
                const interval = setInterval(function () {
                  if (mountToggle()) clearInterval(interval);
                }, 200);
              }

              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
              } else {
                init();
              }
            })();
          `,
        },
      ],
      css: [
        {
          filename: 'bitstat-dark.css',
          content: `
            :root {
              --bg: #000000;
              --panel: #0a0a0a;
              --panel-2: #111111;
              --border: #2a2a2a;
              --text: #f8fafc;
              --muted: #cbd5f5;
              --link: #7dd3fc;
              --chip-text: #0b0b0b;
              --shadow: none;
              --op-get: rgba(56, 189, 248, 0.14);
              --op-post: rgba(34, 197, 94, 0.14);
              --op-put: rgba(245, 158, 11, 0.16);
              --op-del: rgba(239, 68, 68, 0.16);
            }

            body.theme-light {
              --bg: #f5f7fb;
              --panel: #ffffff;
              --panel-2: #f1f5f9;
              --border: #d1d5db;
              --text: #0b0d10;
              --muted: #475569;
              --link: #0369a1;
              --chip-text: #0b0d10;
              --shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
              --op-get: rgba(56, 189, 248, 0.22);
              --op-post: rgba(34, 197, 94, 0.22);
              --op-put: rgba(245, 158, 11, 0.22);
              --op-del: rgba(239, 68, 68, 0.22);
            }

            html, body { background: var(--bg); color: var(--text); }
            .swagger-ui { color: var(--text); }
            .swagger-ui a { color: var(--link); }

            .swagger-ui .topbar { background: var(--panel); border-bottom: 1px solid var(--border); }
            .swagger-ui .topbar .topbar-wrapper { display: flex; align-items: center; gap: 12px; }
            .swagger-ui .topbar a { color: var(--text); }
            .swagger-ui .topbar .download-url-wrapper input[type=text] {
              background: var(--panel); color: var(--text); border: 1px solid var(--border);
            }

            .swagger-ui .info .title,
            .swagger-ui .info p,
            .swagger-ui .info li,
            .swagger-ui .info table,
            .swagger-ui .info a { color: var(--text); }

            .swagger-ui .opblock { background: var(--panel-2); border-color: var(--border); box-shadow: var(--shadow); }
            .swagger-ui .opblock-summary { border-color: var(--border); }
            .swagger-ui .opblock .opblock-summary-method { color: var(--chip-text); }
            .swagger-ui .opblock-tag { color: var(--text); border-bottom: 1px solid var(--border); }
            .swagger-ui .opblock-summary-description { color: var(--muted); }
            .swagger-ui .scheme-container { background: var(--panel-2); box-shadow: var(--shadow); border: 1px solid var(--border); }

            .swagger-ui .btn { background: var(--panel); color: var(--text); border: 1px solid var(--border); }
            .swagger-ui .btn:hover { background: var(--panel-2); }

            .swagger-ui input,
            .swagger-ui select,
            .swagger-ui textarea {
              background: var(--panel); color: var(--text); border: 1px solid var(--border);
            }
            .swagger-ui input::placeholder,
            .swagger-ui textarea::placeholder { color: var(--muted); }

            .swagger-ui .model,
            .swagger-ui .model-title,
            .swagger-ui .model-box,
            .swagger-ui .parameter__name,
            .swagger-ui .parameter__type,
            .swagger-ui .response-col_status,
            .swagger-ui .response-col_links { color: var(--text); }

            .swagger-ui table thead tr td,
            .swagger-ui table thead tr th { color: var(--muted); }
            .swagger-ui .markdown p,
            .swagger-ui .markdown li { color: var(--muted); }
            .swagger-ui .json-schema-2020-12-keyword__name { color: var(--link); }

            .swagger-ui .opblock.opblock-get { border-color: #38bdf8; background: var(--op-get); }
            .swagger-ui .opblock.opblock-post { border-color: #22c55e; background: var(--op-post); }
            .swagger-ui .opblock.opblock-put { border-color: #f59e0b; background: var(--op-put); }
            .swagger-ui .opblock.opblock-delete { border-color: #ef4444; background: var(--op-del); }

            .swagger-ui svg { fill: currentColor !important; stroke: currentColor !important; }
            .swagger-ui svg path { fill: currentColor !important; stroke: currentColor !important; }
            .swagger-ui .arrow { fill: currentColor !important; }

            .bitstat-theme-toggle {
              margin-left: auto;
              padding: 6px 12px;
              border-radius: 6px;
              border: 1px solid var(--border);
              background: var(--panel-2);
              color: var(--text);
              font-size: 12px;
              font-weight: 600;
              cursor: pointer;
            }
            .bitstat-theme-toggle:hover { background: var(--panel); }
          `,
        },
      ],
    },
  });

  await registerRoutes(app);

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
