import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
import {
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
  AgentEvent,
} from '../../server/index.js';
import { CustomUser } from './user_builder.js';
import { Message, Role } from '../../index.js';

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
      messageId: uuidv4(),
      role: Role.ROLE_AGENT,
      parts: [
        {
          content: { $case: 'text', value: finalText },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      taskId: requestContext.taskId,
      contextId: requestContext.contextId,
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    };
    eventBus.publish(AgentEvent.message(finalMessage));
  }
}
