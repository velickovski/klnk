/** Keep Window.fetch's browser receiver when a controller calls this as a method. */
export const browserFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
