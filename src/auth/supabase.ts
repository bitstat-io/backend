import { jwtVerify } from 'jose';

import { env } from '../config/env';

type SupabaseUser = {
  id: string;
  email?: string;
};

const secret = env.SUPABASE_JWT_SECRET
  ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
  : null;

export async function verifySupabaseJwt(token: string): Promise<SupabaseUser | null> {
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, secret);
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) return null;
      const email = typeof payload.email === 'string' ? payload.email : undefined;
      return { id: sub, email };
    } catch {
      return null;
    }
  }

  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.SUPABASE_ANON_KEY,
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { id?: string; email?: string };
      if (!data?.id) return null;
      return { id: data.id, email: data.email };
    } catch {
      return null;
    }
  }

  return null;
}
