import { AuthenticationError } from './errors';

/**
 * Read the GitHub token from the environment. The token is never a parameter
 * default, never hardcoded, and never included in error messages.
 */
export function loadToken(env: Record<string, string | undefined> = process.env): string {
  const token = (env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '').trim();
  if (!token) {
    throw new AuthenticationError('No GitHub token configured: set GITHUB_TOKEN (or GH_TOKEN) in the environment.');
  }
  return token;
}
