import { z } from 'zod';

export const gamesResponseSchema = z.object({
  games: z.array(
    z.object({
      game_slug: z.string().min(1),
    }),
  ),
});
