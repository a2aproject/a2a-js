import express, { Express, RequestHandler, ErrorRequestHandler } from 'express';

import { A2ARequestHandler } from '../request_handler/a2a_request_handler.js';
import { AGENT_CARD_PATH } from '../../constants.js';
import { jsonErrorHandler, jsonRpcHandler } from './json_rpc_handler.js';
import { agentCardHandler } from './agent_card_handler.js';
import { UserBuilder } from './common.js';

/**
 * @deprecated Use specific middlewares ({@link jsonRpcHandler}, {@link agentCardHandler}) directly.
 */
export class A2AExpressApp {
  private requestHandler: A2ARequestHandler;
  private userBuilder: UserBuilder;

  constructor(
    requestHandler: A2ARequestHandler,
    userBuilder: UserBuilder = UserBuilder.noAuthentication
  ) {
    this.requestHandler = requestHandler;
    this.userBuilder = userBuilder;
  }

  /**
   * Adds A2A routes to an existing Express app.
   * @param app Optional existing Express app.
   * @param baseUrl The base URL for A2A endpoints (e.g., "/a2a/api").
   * @param middlewares Optional array of Express middlewares to apply to the A2A routes.
   * @param agentCardPath Optional custom path for the agent card endpoint (defaults to .well-known/agent-card.json).
   * @returns The Express app with A2A routes.
   */
  public setupRoutes(
    app: Express,
    baseUrl: string = '',
    middlewares?: Array<RequestHandler | ErrorRequestHandler>,
    agentCardPath: string = AGENT_CARD_PATH
  ): Express {
    const router = express.Router();

    // Doing it here to maintain previous behaviour of invoking provided middlewares
    // after JSON body is parsed, jsonRpcHandler registers JSON parsing on the local router.
    // body-parser used by express.json() ignores subsequent calls and is safe to be added twice:
    // https://github.com/expressjs/body-parser/blob/168afff3470302aa28050a8ae6681fa1fdaf71a2/lib/read.js#L41.
    router.use(express.json(), jsonErrorHandler);

    if (middlewares && middlewares.length > 0) {
      router.use(middlewares);
    }

    router.use(
      jsonRpcHandler({
        requestHandler: this.requestHandler,
        userBuilder: this.userBuilder,
      })
    );
    router.use(`/${agentCardPath}`, agentCardHandler({ agentCardProvider: this.requestHandler }));

    app.use(baseUrl, router);
    return app;
  }
}
