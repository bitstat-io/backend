import { z } from 'zod';

export const statsQuerySchema = z.object({
  user_id: z.string().min(1),
});

export const statsResponseSchema = z.object({
  gameSlug: z.string().min(1),
  user_id: z.string().min(1),
  stats: z.record(z.string()),
});
