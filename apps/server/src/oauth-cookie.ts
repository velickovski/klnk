export const oauthCookieName = 'klnk_google_oauth';
const valid = /^[A-Za-z0-9_-]{43}$/;
export function oauthCookie(binding: string, production: boolean, clear = false) {
  if (!clear && !valid.test(binding)) throw new Error('Invalid browser binding.');
  return `${oauthCookieName}=${clear ? '' : binding}; Path=/integrations/google-calendar; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${production ? '; Secure' : ''}`;
}
export function readOAuthCookie(header?: string) {
  const matches = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${oauthCookieName}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0].slice(oauthCookieName.length + 1);
  return valid.test(value) ? value : undefined;
}
