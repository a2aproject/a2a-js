import { Request, RequestHandler } from 'express';
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { AuthenticatedUser, unAuthenticatedUser } from '../authentication/user.js';
import * as OpenApiValidator from 'express-openapi-validator';

export interface AuthenticationHandlerOptions {
  securityConfigurations: Promise<string>;
}

passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: 'A2A-SecurityKey',
    },
    (jwt_payload, done) => {
      return done(null, jwt_payload);
    }
  )
);

export const verifyBearer = (req: Request, _scopes: string[], _schema: unknown): Promise<boolean> => {
  return new Promise<boolean>((resolve, reject) => {
    passport.authenticate('jwt', { session: false }, (err: Error, user: unknown, _info: unknown) => {
      if (err) {
        return reject(err);
      }
      if (!user) {
        req.user = new unAuthenticatedUser();
      } else {
        req.user = new AuthenticatedUser();
      }
      resolve(true);
    })(req, null, (err: unknown) => {
      // This callback handles standard middleware errors
      if (err) reject(err);
    });
  });
};

export const authenticationHandler = (options: AuthenticationHandlerOptions): RequestHandler => {
  return async (req, res, next) => {
    try {
      const apiSpec = await options.securityConfigurations;
      const validatorMiddlewares = OpenApiValidator.middleware({
        apiSpec,
        validateRequests: false,
        validateResponses: false,
        validateSecurity: {
          handlers: {
            BearerAuth: verifyBearer,
          },
        },
      });
      const middlewares = Array.isArray(validatorMiddlewares)
        ? validatorMiddlewares
        : [validatorMiddlewares];

      const runMiddleware = (index: number) => {
        if (index < middlewares!.length) {
          middlewares![index](req, res, (err) => {
            if (err) {
              return next(err);
            }
            runMiddleware(index + 1);
          });
        } else {
          next();
        }
      };
      runMiddleware(0);
    } catch (err) {
      next(err);
    }
  };
};
