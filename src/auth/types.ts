export type ApiScope = 'ingest' | 'read' | 'admin';

export type EnvName = 'dev' | 'prod';

export type GameScope = {
  tenantId: string;
  gameId: string;
  gameSlug: string;
  env: EnvName;
};

export type ApiKeyRecord = {
  key: string;
  scopes: ApiScope[];
  scope: GameScope;
};
