const WINDOW_MS = 60_000;
const PER_CLIENT = 12;
const GLOBAL = 600;

type Bucket = { started: number; count: number };
const clients = new Map<string, Bucket>();
let globalBucket: Bucket = { started: 0, count: 0 };

function take(bucket: Bucket, now: number, limit: number): boolean {
  if (now - bucket.started >= WINDOW_MS) {
    bucket.started = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** In-memory by design: production is one Node process. Returns only a
 * boolean; callers keep the same public invalid-credential response. */
export function allowAccessAttempt(client: string): boolean {
  const now = Date.now();
  let bucket = clients.get(client);
  if (!bucket) {
    bucket = { started: now, count: 0 };
    clients.set(client, bucket);
  }
  const allowed = take(bucket, now, PER_CLIENT);
  if (clients.size > 2_000) {
    for (const [key, value] of clients) if (now - value.started >= WINDOW_MS) clients.delete(key);
  }
  if (!allowed) return false;
  return take(globalBucket, now, GLOBAL);
}
