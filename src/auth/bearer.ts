export function extractBearerToken(authorization?: string) {
  if (!authorization) return null;
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice('bearer '.length).trim();
  return token.length > 0 ? token : null;
}
