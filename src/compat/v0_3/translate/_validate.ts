import { A2AError } from '../server/error.js';

export function requireArray<T>(value: T[] | undefined | null, path: string): T[] {
  if (!Array.isArray(value)) {
    throw A2AError.invalidParams(`${path} is required and must be an array`);
  }
  return value;
}

export function requireObject<T>(value: T | undefined | null, path: string): T {
  if (value == null || typeof value !== 'object') {
    throw A2AError.invalidParams(`${path} is required`);
  }
  return value;
}
