export type ConnectionOptions = { allowLocalHttp?: boolean; physicalDevice?: boolean };

export function isLoopback(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

export function isLocalHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopback(host) || host.endsWith('.local')) return true;
  const parts = host.split('.').map(Number);
  return parts.length === 4 && parts.every(p => Number.isInteger(p) && p >= 0 && p <= 255)
    && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

/** Only an API origin is accepted. Never let a connection URL contain credentials. */
export function normalizeApiUrl(input: string, options: ConnectionOptions = {}) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a complete server address, such as https://agent.example.com.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('Use an HTTPS server address.');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Use only the server origin, without a path, password, query, or fragment.');
  if (options.physicalDevice && isLoopback(url.hostname)) throw new Error('Localhost points to this iPhone. Use your computer’s LAN address or an HTTPS backend address.');
  if (url.protocol === 'http:' && (!options.allowLocalHttp || !isLocalHost(url.hostname))) throw new Error('HTTPS is required. Local development HTTP requires a private LAN address and your explicit selection below.');
  return url.origin;
}
