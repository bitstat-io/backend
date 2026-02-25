import type { ApiKeyRecord } from '../auth/types';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ApiKeyRecord;
  }
}
