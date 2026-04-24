import { randomUUID } from 'node:crypto';
import { AgentExecutor, ExecutionEventBus, RequestContext } from '../../server/index.js';
import { CustomUser } from './user_builder.js';
import { Message } from '../../types.js';

export class AuthenticationAgentExecutor implements AgentExecutor {
  public cancelTask = async (_taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {};

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    let finalText;
    if (
      requestContext.context?.user?.isAuthenticated &&
      requestContext.context.user instanceof CustomUser
    ) {
      const customUser = requestContext.context.user;
      finalText = `The request is coming from the authenticated user ${customUser.userName}, with email ${customUser.email} and role ${customUser.role}.`;
    } else {
      finalText = `The request is not coming from an authenticated user.`;
    }
    const finalMessage: Message = {
      kind: 'message',
      messageId: randomUUID(),
      role: 'agent',
      parts: [{ kind: 'text', text: finalText }],
    };
    eventBus.publish(finalMessage);
  }
}
