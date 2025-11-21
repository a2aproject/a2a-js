import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express, { Express, RequestHandler, ErrorRequestHandler } from 'express';

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import * as OpenApiValidator from 'express-openapi-validator';
import { AGENT_CARD_PATH } from '../../constants.js';
import { jsonErrorHandler, jsonRpcHandler } from './json_rpc_handler.js';
import { agentCardHandler } from './agent_card_handler.js';
import { verifyBearer } from './auth_handler.js';

export class A2AExpressApp {
  private requestHandler: A2ARequestHandler;
  private openApiSecurityConfiguration: Promise<string>;


  constructor(requestHandler: A2ARequestHandler) {
    this.requestHandler = requestHandler;
    this.openApiSecurityConfiguration = this.extractOpenAPIRules();
  }

  private async extractOpenAPIRules(): Promise<string> {
    const agentCard = await this.requestHandler.getAgentCard();

    const openApiSpec = {
      openapi: '3.0.0',
      info: {
        title: 'A2A API',
        version: '1.0.0',
      },
      components: {
        securitySchemes: agentCard.securitySchemes || {},
      },
      security: agentCard.security || [],
      paths: {
        '/': {
          post: {
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
      },
    };

    const filePath = path.join(os.tmpdir(), 'openapi.json');
    fs.writeFileSync(filePath, JSON.stringify(openApiSpec, null, 2));
    return filePath;
  }

  /**
   * Adds A2A routes to an existing Express app.
   * @param app Optional existing Express app.
   * @param baseUrl The base URL for A2A endpoints (e.g., "/a2a/api").
   * @param middlewares Optional array of Express middlewares to apply to the A2A routes.
   * @param agentCardPath Optional custom path for the agent card endpoint (defaults to .well-known/agent-card.json).
   * @returns The Express app with A2A routes.
   */
  public async setupRoutes(
    app: Express,
    baseUrl: string = '',
    middlewares?: Array<RequestHandler | ErrorRequestHandler>,
    agentCardPath: string = AGENT_CARD_PATH
  ): Promise<Express> {
    const router = express.Router();

    // Doing it here to maintain previous behaviour of invoking provided middlewares
    // after JSON body is parsed, jsonRpcHandler registers JSON parsing on the local router.
    // body-parser used by express.json() ignores subsequent calls and is safe to be added twice:
    // https://github.com/expressjs/body-parser/blob/168afff3470302aa28050a8ae6681fa1fdaf71a2/lib/read.js#L41.
    router.use(express.json(), jsonErrorHandler);

    if (middlewares && middlewares.length > 0) {
      router.use(middlewares);
    }

    const apiSpec = await this.openApiSecurityConfiguration;
    router.use(
          OpenApiValidator.middleware({
          apiSpec,
          validateRequests: false,
          validateResponses: false,
          validateSecurity: {
              handlers: {
                  // The name here must match the security scheme in your openapi.yaml
                  BearerAuth: verifyBearer, 
              }
          }
      })
    )
    router.use(jsonRpcHandler({ requestHandler: this.requestHandler }));
    router.use(`/${agentCardPath}`, agentCardHandler({ agentCardProvider: this.requestHandler }));

    const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
      res.status(err.status || 500).json({
        message: err.message,
        errors: err.errors,
      });
    };
    router.use(errorHandler);

    app.use(baseUrl, router);
    return app;
  }
}
