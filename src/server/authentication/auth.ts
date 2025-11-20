import { IncomingHttpHeaders } from 'http';
import { SecurityScheme } from '../../types.js';

export function validateAuthentication(
  securityScheme: SecurityScheme,
  headers: IncomingHttpHeaders
): boolean {
  switch (securityScheme.type) {
    case 'http':
      const authHeader = headers['authorization'];
      if (authHeader) {
        const [scheme, token] = authHeader.split(' ');
        if (!scheme || !token) {
          return;
        }

        switch (scheme) {
          case 'Basic':
            return validateBasicToken(token)
          case 'Bearer':
            return validateBearerToken(token)
        }
      }
      break;
    default:
      return;
  }
}
