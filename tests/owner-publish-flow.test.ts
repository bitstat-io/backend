import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/supabase', () => ({
  verifySupabaseJwt: vi.fn(),
}));

vi.mock('../src/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('../src/services/games/ownership', () => ({
  findOwnedGameBySlug: vi.fn(),
}));

vi.mock('../src/services/games/registry', async () => {
  const actual = await vi.importActual<object>('../src/services/games/registry');
  return {
    ...actual,
    syncPublicGameCache: vi.fn(),
  };
});

import { buildServer } from '../src/index';
import { verifySupabaseJwt } from '../src/auth/supabase';
import { getDb } from '../src/db/client';
import { findOwnedGameBySlug } from '../src/services/games/ownership';
import { syncPublicGameCache } from '../src/services/games/registry';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'game-1',
    slug: 'tetris',
    name: 'Tetris',
    game_type: 'puzzle',
    cover_image_url: 'https://project.supabase.co/storage/v1/object/public/games/tetris.png',
    is_published_prod: true,
    is_published_dev: false,
    published_prod_at: '2026-03-08T00:00:00.000Z',
    published_dev_at: null,
    created_at: '2026-03-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('owner publish flow', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('updates game metadata and refreshes the public cache', async () => {
    vi.mocked(verifySupabaseJwt).mockResolvedValue({ id: 'user-1', email: 'owner@example.com' });
    vi.mocked(findOwnedGameBySlug).mockResolvedValue({
      gameId: 'game-1',
      tenantId: 'tenant-1',
      gameSlug: 'tetris',
      name: 'Tetris',
      gameType: 'puzzle',
      coverImageUrl: null,
      isPublishedProd: false,
      isPublishedDev: false,
      publishedProdAt: null,
      publishedDevAt: null,
      createdAt: '2026-03-07T00:00:00.000Z',
    });

    const query = vi.fn().mockResolvedValue({
      rows: [
        makeRow({
          name: 'Tetris DX',
          cover_image_url: 'https://project.supabase.co/storage/v1/object/public/games/tetris-dx.png',
          is_published_prod: false,
          published_prod_at: null,
        }),
      ],
    });
    vi.mocked(getDb).mockReturnValue({ query } as any);
    vi.mocked(syncPublicGameCache).mockResolvedValue(undefined);

    const app = await buildServer();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/dashboard/games/tetris',
      headers: { authorization: 'Bearer owner-token' },
      payload: {
        name: 'Tetris DX',
        cover_image_url: 'https://project.supabase.co/storage/v1/object/public/games/tetris-dx.png',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'game-1',
      slug: 'tetris',
      name: 'Tetris DX',
      game_type: 'puzzle',
      cover_image_url: 'https://project.supabase.co/storage/v1/object/public/games/tetris-dx.png',
      is_published_prod: false,
      is_published_dev: false,
      published_prod_at: null,
      published_dev_at: null,
      created_at: '2026-03-07T00:00:00.000Z',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(syncPublicGameCache).toHaveBeenCalledWith('game-1');

    await app.close();
  });

  it('rejects publishing when no cover image is configured', async () => {
    vi.mocked(verifySupabaseJwt).mockResolvedValue({ id: 'user-1', email: 'owner@example.com' });
    vi.mocked(findOwnedGameBySlug).mockResolvedValue({
      gameId: 'game-1',
      tenantId: 'tenant-1',
      gameSlug: 'tetris',
      name: 'Tetris',
      gameType: 'puzzle',
      coverImageUrl: null,
      isPublishedProd: false,
      isPublishedDev: false,
      publishedProdAt: null,
      publishedDevAt: null,
      createdAt: '2026-03-07T00:00:00.000Z',
    });
    vi.mocked(getDb).mockReturnValue({ query: vi.fn() } as any);

    const app = await buildServer();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/dashboard/games/tetris/publish',
      headers: { authorization: 'Bearer owner-token' },
      payload: { env: 'prod' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'A cover image is required before publishing.',
      },
    });
    expect(syncPublicGameCache).not.toHaveBeenCalled();

    await app.close();
  });

  it('publishes and unpublishes a game environment explicitly', async () => {
    vi.mocked(verifySupabaseJwt).mockResolvedValue({ id: 'user-1', email: 'owner@example.com' });
    vi.mocked(findOwnedGameBySlug).mockResolvedValue({
      gameId: 'game-1',
      tenantId: 'tenant-1',
      gameSlug: 'tetris',
      name: 'Tetris',
      gameType: 'puzzle',
      coverImageUrl: 'https://project.supabase.co/storage/v1/object/public/games/tetris.png',
      isPublishedProd: false,
      isPublishedDev: false,
      publishedProdAt: null,
      publishedDevAt: null,
      createdAt: '2026-03-07T00:00:00.000Z',
    });

    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [makeRow()],
      })
      .mockResolvedValueOnce({
        rows: [makeRow({ is_published_prod: false })],
      });
    vi.mocked(getDb).mockReturnValue({ query } as any);
    vi.mocked(syncPublicGameCache).mockResolvedValue(undefined);

    const app = await buildServer();

    const publishResponse = await app.inject({
      method: 'PUT',
      url: '/v1/dashboard/games/tetris/publish',
      headers: { authorization: 'Bearer owner-token' },
      payload: { env: 'prod' },
    });
    expect(publishResponse.statusCode).toBe(200);
    expect(publishResponse.json().is_published_prod).toBe(true);

    const unpublishResponse = await app.inject({
      method: 'PUT',
      url: '/v1/dashboard/games/tetris/unpublish',
      headers: { authorization: 'Bearer owner-token' },
      payload: { env: 'prod' },
    });
    expect(unpublishResponse.statusCode).toBe(200);
    expect(unpublishResponse.json().is_published_prod).toBe(false);

    expect(syncPublicGameCache).toHaveBeenNthCalledWith(1, 'game-1');
    expect(syncPublicGameCache).toHaveBeenNthCalledWith(2, 'game-1');

    await app.close();
  });
});
