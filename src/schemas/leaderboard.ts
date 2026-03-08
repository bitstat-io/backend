import { z } from 'zod';

export const windowSchema = z.enum(['all', '1d', '7d', '30d']);

export const leaderboardQuerySchema = z.object({
  window: windowSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const leaderboardResponseSchema = z.object({
  game: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    game_type: z.string().nullable(),
    cover_image_url: z.string().nullable(),
  }),
  window: windowSchema,
  entries: z.array(
    z.object({
      rank: z.number().int().min(1),
      user_id: z.string().min(1),
      score: z.number(),
    }),
  ),
});

export type LeaderboardWindow = z.infer<typeof windowSchema>;
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
