import { AuthError } from '../exceptions/auth-errors.js';
export function extractBearerToken(request: {
  headers: { authorization?: string };
  rawHeaders: string[];
}): string {
  let count = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i].toLowerCase() === 'authorization') count++;
  const value = request.headers.authorization;
  const matched =
    typeof value === 'string' ? /^Bearer[\t ]+(\S+)$/i.exec(value) : null;
  if (count > 1 || !matched || matched[1].length > 4096)
    throw new AuthError('AUTHENTICATION_REQUIRED');
  return matched[1];
}
