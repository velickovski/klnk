/** Test-only endpoint guard. An explicit CI URL may change the loopback port,
 * but never the dedicated database, credentials, or connection options. */
export function guardedPostgresFixture(value: unknown): { url: URL; key: string } {
  const fixture = value as { url?: unknown; key?: unknown } | null;
  if (!fixture || typeof fixture.url !== 'string' || typeof fixture.key !== 'string') {
    throw new Error('Missing private PostgreSQL test fixture.');
  }
  let url: URL;
  let approved: URL;
  try {
    url = new URL(fixture.url);
    approved = new URL(process.env.KLNK_TEST_POSTGRES_URL ?? fixture.url);
  } catch {
    throw new Error('Invalid PostgreSQL test fixture URL.');
  }
  const loopback = new Set(['127.0.0.1', '[::1]', 'localhost']);
  const allowed = (address: URL) =>
    address.protocol === 'postgresql:' &&
    loopback.has(address.hostname) &&
    address.pathname === '/klnk_qa' &&
    !address.search &&
    !address.hash &&
    !!address.username &&
    !!address.password &&
    (!address.port || (Number(address.port) > 0 && Number(address.port) <= 65535));
  if (
    !allowed(url) ||
    !allowed(approved) ||
    url.href !== approved.href ||
    !/^[a-f0-9]{64}$/i.test(fixture.key)
  ) {
    throw new Error('Only the explicit loopback klnk_qa test fixture is permitted.');
  }
  return { url, key: fixture.key };
}
