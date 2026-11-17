/** Kept free of database imports so boot-checks.ts can use it before the DB opens. */
import { GOOGLE_LOGIN_DEPLOYMENT } from './google-login-settings.ts';

export function googleLoginConfig() {
  // A dedicated pair must be complete. Reusing Meet is an explicit deployment
  // setting, enabled only after its client registered the login callback.
  const dedicated = !!(process.env.GOOGLE_LOGIN_CLIENT_ID || process.env.GOOGLE_LOGIN_CLIENT_SECRET);
  const clientId = dedicated ? process.env.GOOGLE_LOGIN_CLIENT_ID
    : GOOGLE_LOGIN_DEPLOYMENT.reuseMeetClient ? process.env.GOOGLE_WEB_CLIENT_ID : undefined;
  const clientSecret = dedicated ? process.env.GOOGLE_LOGIN_CLIENT_SECRET
    : GOOGLE_LOGIN_DEPLOYMENT.reuseMeetClient ? process.env.GOOGLE_WEB_CLIENT_SECRET : undefined;
  const site = process.env.SITE_URL?.replace(/\/+$/, '');
  if (!clientId || !clientSecret || !site) return null;
  return { clientId, clientSecret, redirectUri: `${site}/auth/google/callback` };
}
