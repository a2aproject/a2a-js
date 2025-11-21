import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { AuthenticatedUser, unAuthenticatedUser } from '../authentication/user.js';


export interface SecurityHandlerOptions {
  securityConfigurations: Promise<string>;
  router: Router;
}

passport.use(new JwtStrategy({
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: 'A2A-SecurityKey'
}, (jwt_payload, done) => {
    return done(null, jwt_payload); 
}));

export const verifyBearer = (req: Request, scopes: string[], schema: any): Promise<boolean> => {
    return new Promise<boolean>((resolve, reject) => {
        passport.authenticate('jwt', { session: false }, (err: Error, user: any, info: any) => {
            if (err) {
               return reject(err);
            }
            if (!user) {
              req.user = new unAuthenticatedUser();
            } else {
              req.user = new AuthenticatedUser('authenticated user');
            }
            resolve(true);
        })(req, null, (err: any) => {
             // This callback handles standard middleware errors
             if(err) reject(err);
        });
    });
};