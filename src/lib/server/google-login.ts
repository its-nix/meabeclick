/** Google proves a subject; existing family authorization still decides access. */
import { GOOGLE_LOGIN_DEPLOYMENT } from './google-login-settings.ts';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FamilyIdentity } from './family-auth.ts';
import { handle, inTransaction } from './db.ts';
import { consumeCredentialId } from './access-credentials.ts';
import { findAccountByEmail } from './entities.ts';
import { resolveFamilyAccess } from './family.ts';
import { isValidEmailAddress, normalizeEmail } from './email-address.ts';

export const GOOGLE_FLOW_COOKIE = 'maab_google_flow';
export const GOOGLE_PENDING_COOKIE = 'maab_google_pending';
const TTL_MS = 10 * 60 * 1000;
export const randomSecret = () => randomBytes(32).toString('base64url');
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('base64url');

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
export const googleEnabled = () => googleLoginConfig() !== null;
export function tutorGoogleEnabled() {
  return googleEnabled() && tutorGoogleEmails().length > 0;
}

export interface GoogleProfile { subject: string; email: string; name: string; authoritative: boolean }
export interface GoogleFlow {
  state_hash: string; browser_hash: string; nonce: string; verifier: string;
  intent: 'login' | 'link' | 'invite' | 'tutor';
  scope_kind: FamilyIdentity['kind'] | null; scope_id: number | null;
  credential_id: string | null; next_path: string; profile: string | null;
}

/** Only explicit local destinations survive sign-in. No arbitrary redirects. */
export function loginNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/portal';
  const parsed = new URL(raw, 'https://local.invalid');
  if (parsed.origin !== 'https://local.invalid') return '/portal';
  if (!(parsed.pathname === '/booking' || parsed.pathname === '/portal' || parsed.pathname.startsWith('/app/'))) return '/portal';
  return parsed.pathname + parsed.search;
}

export function startGoogleFlow(options: {
  intent: GoogleFlow['intent']; identity?: FamilyIdentity; credentialId?: string; next?: unknown;
}) {
  const config = googleLoginConfig();
  if (!config) throw new Error('unavailable');
  const state = randomSecret(), browser = randomSecret(), nonce = randomSecret(), verifier = randomSecret();
  handle().prepare('DELETE FROM google_auth_flows WHERE expires_at < ?').run(new Date().toISOString());
  // Outstanding flows are bounded by rate-limiting the start endpoint and expiry cleanup.
  handle().prepare(`INSERT INTO google_auth_flows
    (state_hash, browser_hash, nonce, verifier, intent, scope_kind, scope_id, credential_id, next_path, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(hashSecret(state), hashSecret(browser), nonce, verifier, options.intent,
      options.identity?.kind ?? null, options.identity?.id ?? null, options.credentialId ?? null,
      loginNext(options.next), new Date(Date.now() + TTL_MS).toISOString());
  const query = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: 'openid email profile', state, nonce, code_challenge: hashSecret(verifier),
    code_challenge_method: 'S256', prompt: 'select_account',
  });
  return { state, browser, url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
}

/** Claim before awaiting Google so a callback can never run twice. */
export function claimGoogleFlow(state: string, browser: string): GoogleFlow | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) return null;
  return inTransaction(() => {
    const key = hashSecret(state);
    const changed = handle().prepare(`UPDATE google_auth_flows SET claimed_at = ?
      WHERE state_hash = ? AND browser_hash = ? AND claimed_at IS NULL AND expires_at > ?`)
      .run(new Date().toISOString(), key, hashSecret(browser), new Date().toISOString());
    if (changed.changes !== 1) return null;
    return handle().prepare('SELECT * FROM google_auth_flows WHERE state_hash = ?').get(key) as unknown as GoogleFlow;
  });
}

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 10_000 });
export async function exchangeGoogleCode(code: string, flow: GoogleFlow): Promise<GoogleProfile> {
  const config = googleLoginConfig();
  if (!config) throw new Error('unavailable');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, code, code_verifier: flow.verifier, grant_type: 'authorization_code' }),
  });
  if (!response.ok) throw new Error('google');
  const token = await response.json() as { id_token?: string };
  if (!token.id_token) throw new Error('google');
  const { payload } = await jwtVerify(token.id_token, googleKeys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: config.clientId, algorithms: ['RS256'],
  });
  if ((payload.azp !== undefined && payload.azp !== config.clientId) || payload.nonce !== flow.nonce || !payload.sub || payload.email_verified !== true || !isValidEmailAddress(payload.email)) {
    throw new Error('google');
  }
  const email = normalizeEmail(payload.email);
  return { subject: payload.sub, email, name: typeof payload.name === 'string' ? payload.name.slice(0, 100) : '',
    // Google explicitly does not vouch for continued ownership of third-party mailboxes.
    authoritative: email.endsWith('@gmail.com') || (typeof payload.hd === 'string' && !!payload.hd),
  };
}

export function linkedGoogleIdentity(subject: string): FamilyIdentity | null {
  const row = handle().prepare('SELECT scope_kind, scope_id FROM google_identities WHERE subject = ?')
    .get(subject) as { scope_kind: FamilyIdentity['kind']; scope_id: number } | undefined;
  return row ? { kind: row.scope_kind, id: row.scope_id } : null;
}
export function hasGoogleIdentity(identity: FamilyIdentity): boolean {
  return !!handle().prepare('SELECT 1 FROM google_identities WHERE scope_kind = ? AND scope_id = ?').get(identity.kind, identity.id);
}
const same = (a: FamilyIdentity, b: FamilyIdentity) => a.kind === b.kind && a.id === b.id;

export function linkGoogleIdentity(profile: GoogleProfile, identity: FamilyIdentity): void {
  const access = resolveFamilyAccess(identity);
  if (!access) throw new Error('expired');
  const existing = linkedGoogleIdentity(profile.subject);
  if (existing) {
    if (!same(existing, identity)) throw new Error('conflict');
    return;
  }
  if (identity.kind === 'student' && !access.isSelf && normalizeEmail(access.account.email) === profile.email) {
    throw new Error('parent-account');
  }
  if (hasGoogleIdentity(identity)) throw new Error('conflict');
  handle().prepare(`INSERT INTO google_identities (subject, scope_kind, scope_id, email, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(profile.subject, identity.kind, identity.id, profile.email, new Date().toISOString());
}

export function completeGoogleIdentity(profile: GoogleProfile, flow: GoogleFlow): FamilyIdentity | null {
  return inTransaction(() => {
    if (flow.intent === 'invite') {
      if (!flow.credential_id) throw new Error('expired');
      // Linking conflict throws: transaction rolls back credential consumption too.
      const identity = consumeCredentialId(flow.credential_id);
      if (!identity) throw new Error('expired');
      linkGoogleIdentity(profile, identity);
      return identity;
    }
    if (flow.intent === 'link') {
      if (!flow.scope_kind || !flow.scope_id) throw new Error('expired');
      const identity = { kind: flow.scope_kind, id: flow.scope_id };
      linkGoogleIdentity(profile, identity);
      return identity;
    }
    const linked = linkedGoogleIdentity(profile.subject);
    if (linked) {
      if (!resolveFamilyAccess(linked)) throw new Error('expired');
      return linked;
    }
    const account = findAccountByEmail(profile.email);
    if (account) {
      if (!profile.authoritative) throw new Error('email-proof');
      const identity = { kind: 'account' as const, id: account.id };
      linkGoogleIdentity(profile, identity);
      return identity;
    }
    return null;
  });
}

export function tutorGoogleEmails(): string[] {
  // An explicit empty environment override disables tutor Google sign-in.
  const addresses = process.env.GOOGLE_TUTOR_EMAILS === undefined
    ? [...GOOGLE_LOGIN_DEPLOYMENT.tutorEmails] : process.env.GOOGLE_TUTOR_EMAILS.split(',');
  return addresses.map(email => normalizeEmail(email)).filter(Boolean);
}
export function tutorGoogleAllowed(profile: GoogleProfile): boolean {
  return profile.authoritative && tutorGoogleEmails().includes(profile.email);
}

export function savePendingProfile(flow: GoogleFlow, profile: GoogleProfile): string {
  // A fresh secret, never the public OAuth state, authorizes onboarding.
  const secret = randomSecret();
  handle().prepare(`UPDATE google_auth_flows SET profile = ?, browser_hash = ?, expires_at = ? WHERE state_hash = ?`)
    .run(JSON.stringify(profile), hashSecret(secret), new Date(Date.now() + TTL_MS).toISOString(), flow.state_hash);
  return secret;
}
export function pendingGoogleProfile(secret: string | undefined): { flow: GoogleFlow; profile: GoogleProfile } | null {
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const flow = handle().prepare(`SELECT * FROM google_auth_flows WHERE browser_hash = ? AND profile IS NOT NULL AND expires_at > ?`)
    .get(hashSecret(secret), new Date().toISOString()) as unknown as GoogleFlow | undefined;
  return flow ? { flow, profile: JSON.parse(flow.profile!) as GoogleProfile } : null;
}
export function finishPendingProfile(flow: GoogleFlow): void {
  const result = handle().prepare('DELETE FROM google_auth_flows WHERE state_hash = ? AND profile IS NOT NULL').run(flow.state_hash);
  if (result.changes !== 1) throw new Error('expired');
}
export function familyDestination(identity: FamilyIdentity, next = '/portal'): string {
  const access = resolveFamilyAccess(identity);
  if (!access) return '/portal';
  if ((next === '/booking' || next.startsWith('/booking?')) && access.canSeeParentView) return next;
  if (next.startsWith('/app/') && !next.startsWith('/app/tutor-setup')) {
    // Only family destinations. Preserve a requested learning page; its own guard checks scope.
    if (/^\/app\/(student|parent|play\/|plan\/|learn\/)/.test(next)) return next;
  }
  if (access.canSeeParentView && !access.isSelf) return '/app/parent';
  const student = access.student ?? access.students[0];
  return student ? `/app/student?s=${encodeURIComponent(student.code)}` : '/app/parent';
}
export const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'הכניסה בוטלה. אפשר לנסות שוב או להיכנס בדרך אחרת.',
  unavailable: 'הכניסה עם Google אינה זמינה כרגע. אפשר להיכנס עם קישור אישי.',
  google: 'לא הצלחנו להשלים את הכניסה עם Google. נסו שוב.',
  expired: 'הכניסה כבר לא תקפה. פתחו שוב את ההזמנה או בקשו קישור חדש.',
  'parent-account': 'נבחר חשבון ההורה. פתחו שוב את ההזמנה ובחרו את חשבון Google של התלמיד/ה.',
  conflict: 'חשבון Google הזה או הדף הזה כבר מחוברים לחשבון אחר. בחרו את החשבון המתאים או פנו למורה.',
  'email-proof': 'כדי לחבר את החשבון הקיים, היכנסו פעם אחת דרך קישור למייל ואז בחרו חיבור Google בדף שלכם.',
  tutor: 'חשבון Google הזה אינו מורשה ללוח המורה. בחרו את חשבון המורה או השתמשו בסיסמה.',
};
