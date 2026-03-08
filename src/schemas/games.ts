import { z } from 'zod';

export const gamesResponseSchema = z.object({
  games: z.array(
    z.object({
      game_slug: z.string().min(1),
      name: z.string().min(1),
      game_type: z.string().nullable(),
      cover_image_url: z.string().nullable(),
    }),
  ),
});
