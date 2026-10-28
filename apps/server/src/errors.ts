export class HttpError extends Error { constructor(public statusCode: number, public code: string, message: string) { super(message); } }
export function requireValue<T>(value: T | undefined | null, message = 'Resource not found'): T { if (value === undefined || value === null) throw new HttpError(404,'not_found',message); return value; }
