import { api } from '../../api';

/** Shared authenticated transport already fences identity/origin and validates wire schemas. */
export const networkApi = {
  request: <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    if (!path.startsWith('/network/'))
      return Promise.reject(new Error('Use an internal network endpoint.'));
    return api<T>(path, method, body);
  },
};
