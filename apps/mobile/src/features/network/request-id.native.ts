import * as Crypto from 'expo-crypto';

/** Expo's supported native CSPRNG. Never substitutes Math.random or a web shim. */
export function requestId() {
  return Crypto.randomUUID();
}
