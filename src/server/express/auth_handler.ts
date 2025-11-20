import { NextFunction, Request, RequestHandler, Response } from 'express';
import { IncomingHttpHeaders } from 'http';
import { AgentCard } from '../../types.js';
import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { validateAuthentication } from '../authentication/auth.js';
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';


export interface JsonRpcHandlerOptions {
  requestHandler: A2ARequestHandler;
}

passport.use(new JwtStrategy({
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: 'a-string-secret-at-least-256-bits-long'
}, (jwt_payload, done) => {
    return done(null, jwt_payload); 
}));

export function authHandler(options: JsonRpcHandlerOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentCard: AgentCard = await options.requestHandler.getAgentCard();
      const validAuthentications: string[] = [];
      const headers: IncomingHttpHeaders = req.headers;
      passport.authenticate('jwt', { session: false }, (err: any, user: any, info: any) => {
          
          if (err) return next(err); // Error in the strategy itself
          
          if (!user) {
              // THIS is where it lands if headers are missing or token is bad.
              return res.status(401).json({ message: "Unauthorized: No token provided" });
          }

          // If successful, attach user and move on
          req.user = user;
          next();
          
      })(req, res, next);

      console.log("I verified the authentication")

      if (agentCard.securitySchemes) {
        for (const [schemeName, config] of Object.entries(agentCard.securitySchemes)) {
          /*
          if(validateAuthentication(config, headers)){
            validAuthentications.push(schemeName);
          }
          */
          passport.authenticate('jwt', { session: false })        
        }
      }

      if (!agentCard.security || agentCard.security.length === 0) {
        next();
        return;
      }

      const isAuthorized = agentCard.security.some((requirementObj) => {
        const requiredSchemes = Object.keys(requirementObj);

        if (requiredSchemes.length === 0) {
          return true;
        }
        return requiredSchemes.every((requiredScheme) =>
          validAuthentications.includes(requiredScheme)
        );
      });

      if (isAuthorized) {
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    } catch (error) {
      next(error);
    }
  };
}