import { z } from 'zod';

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9_-]{2,50}$/)
  .describe('Lowercase slug (2-50 chars).');

export const gameTypeSchema = z.string().trim().min(1).max(100);
export const coverImageUrlSchema = z.string().url().max(2048);

export const createGameSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  game_type: gameTypeSchema.optional(),
  cover_image_url: coverImageUrlSchema.optional(),
});

export const updateGameSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    game_type: gameTypeSchema.nullable().optional(),
    cover_image_url: coverImageUrlSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided.',
  });

export const publishGameSchema = z.object({
  env: z.enum(['dev', 'prod']),
});

export const gameResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  game_type: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  is_published_prod: z.boolean(),
  is_published_dev: z.boolean(),
  published_prod_at: z.string().nullable(),
  published_dev_at: z.string().nullable(),
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
