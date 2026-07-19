const buckets = new Map();

export function isRateLimited(key, limit, windowMs) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }
  recent.push(now);
  buckets.set(key, recent);
  return false;
}
