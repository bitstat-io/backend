import { z } from 'zod';

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9_-]{2,50}$/)
  .describe('Lowercase slug (2-50 chars).');

export const gameTypeSchema = z.enum(['fps', 'mmo', 'mobile', 'other']);

export const createGameSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  game_type: gameTypeSchema.optional().default('other'),
});

export const gameResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  game_type: gameTypeSchema,
  created_at: z.string(),
});

export const gamesListResponseSchema = z.object({
  games: z.array(gameResponseSchema),
});

export const createKeySchema = z.object({
  env: z.enum(['dev', 'prod']),
  scopes: z.array(z.enum(['ingest', 'read', 'admin'])).optional(),
});

export const apiKeyResponseSchema = z.object({
  id: z.string(),
  env: z.enum(['dev', 'prod']),
  scopes: z.array(z.enum(['ingest', 'read', 'admin'])),
  key_prefix: z.string(),
  key: z.string().optional(),
  created_at: z.string(),
  revoked_at: z.string().nullable(),
});

export const apiKeysListResponseSchema = z.object({
  keys: z.array(apiKeyResponseSchema),
});
