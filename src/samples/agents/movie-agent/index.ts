import express from 'express';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

import {
  AgentCard,
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  Message,
  AGENT_CARD_PATH,
  TaskArtifactUpdateEvent,
  Artifact,
  Part,
  Role,
} from '../../../index.js';
import {
  InMemoryTaskStore,
  TaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from '../../../server/index.js';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '../../../server/express/index.js';
import { MessageData } from 'genkit';
import { ai } from './genkit.js';
import { searchMovies, searchPeople } from './tools.js';

if (!process.env.GEMINI_API_KEY || !process.env.TMDB_API_KEY) {
  console.error('GEMINI_API_KEY and TMDB_API_KEY environment variables are required');
  process.exit(1);
}

// Simple store for contexts
const contexts: Map<string, Message[]> = new Map();

// Load the Genkit prompt
const movieAgentPrompt = ai.prompt('movie_agent');

/**
 * MovieAgentExecutor implements the agent's core logic.
 */
class MovieAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();

  public cancelTask = async (taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {
    this.cancelledTasks.add(taskId);
    // The execute loop is responsible for publishing the final state
  };

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;

    console.log(
      `[MovieAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: Task = {
        id: taskId,
        contextId: contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          timestamp: new Date().toISOString(),
          update: undefined,
        },
        artifacts: [],
        history: [userMessage], // Start history with the current user message
        metadata: userMessage.metadata, // Carry over metadata from message if any
      };
      eventBus.publish(initialTask);
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      taskId: taskId,
      contextId: contextId,
      status: {
        state: TaskState.TASK_STATE_WORKING,
        update: {
          role: Role.ROLE_AGENT,
          messageId: uuidv4(),
          content: [
            { part: { $case: 'text', value: 'Processing your question, hang tight!' } },
          ],
          taskId: taskId,
          contextId: contextId,
          extensions: [],
          metadata: {},
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
      metadata: {},
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Prepare messages for Genkit prompt
    const historyForGenkit = contexts.get(contextId) || [];
    if (!historyForGenkit.find((m) => m.messageId === userMessage.messageId)) {
      historyForGenkit.push(userMessage);
    }
    contexts.set(contextId, historyForGenkit);

    const messages: MessageData[] = historyForGenkit
      .map((m) => {
        const textContent = m.content
          .map((p) => (p.part?.$case === 'text' ? p.part.value : ''))
          .filter((t) => !!t)
          .join('\n');

        return {
          role: (m.role === Role.ROLE_AGENT ? 'model' : 'user') as 'user' | 'model',
          content: textContent ? [{ text: textContent }] : [],
        };
      })
      .filter((m) => m.content.length > 0);

    if (messages.length === 0) {
      console.warn(
        `[MovieAgentExecutor] No valid text messages found in history for task ${taskId}.`
      );
      const failureUpdate: TaskStatusUpdateEvent = {
        taskId: taskId,
        contextId: contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          update: {
            role: Role.ROLE_AGENT,
            messageId: uuidv4(),
            content: [{ part: { $case: 'text', value: 'No message found to process.' } }],
            taskId: taskId,
            contextId: contextId,
            extensions: [],
            metadata: {},
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: {},
      };
      eventBus.publish(failureUpdate);
      return;
    }

    const goal =
      (existingTask?.metadata?.goal as string | undefined) ||
      (userMessage.metadata?.goal as string | undefined);

    try {
      // 4. Run the Genkit prompt
      const response = await movieAgentPrompt(
        { goal: goal, now: new Date().toISOString() },
        {
          messages,
          tools: [searchMovies, searchPeople],
        }
      );

      // Check if the request has been cancelled
      if (this.cancelledTasks.has(taskId)) {
        console.log(`[MovieAgentExecutor] Request cancelled for task: ${taskId}`);

        const cancelledUpdate: TaskStatusUpdateEvent = {
          taskId: taskId,
          contextId: contextId,
          status: {
            state: TaskState.TASK_STATE_CANCELLED,
            timestamp: new Date().toISOString(),
            update: undefined,
          },
          final: true, // Cancellation is a final state
          metadata: {},
        };
        eventBus.publish(cancelledUpdate);
        return;
      }

      const responseText = response.text; // Access the text property using .text()
      console.info(`[MovieAgentExecutor] Prompt response: ${responseText}`);
      const lines = responseText.trim().split('\n');
      const finalStateLine = lines.at(-1)?.trim().toUpperCase();
      const agentReplyText = lines
        .slice(0, lines.length - 1)
        .join('\n')
        .trim();

      let finalA2AState: TaskState = TaskState.TASK_STATE_UNSPECIFIED;

      if (finalStateLine === 'COMPLETED') {
        finalA2AState = TaskState.TASK_STATE_COMPLETED;
      } else if (finalStateLine === 'AWAITING_USER_INPUT') {
        finalA2AState = TaskState.TASK_STATE_INPUT_REQUIRED;
      } else {
        console.warn(
          `[MovieAgentExecutor] Unexpected final state line from prompt: ${finalStateLine}. Defaulting to 'completed'.`
        );
        finalA2AState = TaskState.TASK_STATE_COMPLETED; // Default if LLM deviates
      }

      // 5. Publish artifact with the result
      const parts: Part[] = [
        { part: { $case: 'text', value: agentReplyText || 'Completed.' } },
      ];
      const artifactId = uuidv4();
      const resultArtifact: Artifact = {
        artifactId: artifactId,
        name: 'Result',
        description: 'The result of the movie agent.',
        parts: parts,
        metadata: undefined,
        extensions: [],
      };

      const artifactUpdate: TaskArtifactUpdateEvent = {
        taskId: taskId,
        contextId: contextId,
        artifact: resultArtifact,
        lastChunk: true,
        append: false,
        metadata: {},
      };
      eventBus.publish(artifactUpdate);

      // 6. Update local history context (internal only)
      const agentMessage: Message = {
        role: Role.ROLE_AGENT,
        messageId: uuidv4(),
        content: parts,
        taskId: taskId,
        contextId: contextId,
        extensions: [],
        metadata: {},
      };
      historyForGenkit.push(agentMessage);
      contexts.set(contextId, historyForGenkit);

      // 7. Publish final task status update
      const finalUpdate: TaskStatusUpdateEvent = {
        taskId: taskId,
        contextId: contextId,
        status: {
          state: finalA2AState,
          timestamp: new Date().toISOString(),
          update: undefined,
        },
        final: true,
        metadata: {},
      };
      eventBus.publish(finalUpdate);

      console.log(`[MovieAgentExecutor] Task ${taskId} finished with state: ${finalA2AState}`);
    } catch (error: any) {
      console.error(`[MovieAgentExecutor] Error processing task ${taskId}:`, error);
      const errorUpdate: TaskStatusUpdateEvent = {
        taskId: taskId,
        contextId: contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          update: {
            role: Role.ROLE_AGENT,
            messageId: uuidv4(),
            content: [{ part: { $case: 'text', value: `Agent error: ${error.message}` } }],
            taskId: taskId,
            contextId: contextId,
            extensions: [],
            metadata: undefined,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
        metadata: undefined,
      };
      eventBus.publish(errorUpdate);
    }
  }
}

// --- Server Setup ---

const movieAgentCard: AgentCard = {
  name: 'Movie Agent',
  description: 'An agent that can answer questions about movies and actors using TMDB.',
  url: 'http://localhost:41241/',
  provider: {
    organization: 'A2A Samples',
    url: 'https://example.com/a2a-samples', // Added provider URL
  },
  version: '0.0.2', // Incremented version
  protocolVersion: '0.3.0',
  capabilities: {
    streaming: true, // The new framework supports streaming
    pushNotifications: false, // Assuming not implemented for this agent yet
    extensions: [],
  },
  securitySchemes: undefined, // Or define actual security schemes if any
  security: undefined,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text', 'task-status'], // task-status is a common output mode
  skills: [
    {
      id: 'general_movie_chat',
      name: 'General Movie Chat',
      description: 'Answer general questions or chat about movies, actors, directors.',
      tags: ['movies', 'actors', 'directors'],
      examples: [
        'Tell me about the plot of Inception.',
        'Recommend a good sci-fi movie.',
        'Who directed The Matrix?',
        'What other movies has Scarlett Johansson been in?',
        'Find action movies starring Keanu Reeves',
        'Which came out first, Jurassic Park or Terminator 2?',
      ],
      inputModes: ['text'], // Explicitly defining for skill
      outputModes: ['text', 'task-status'], // Explicitly defining for skill
      security: [],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
  preferredTransport: 'jsonrpc',
  additionalInterfaces: [],
  documentationUrl: '',
  signatures: [],
};

async function main() {
  // 1. Create TaskStore
  const taskStore: TaskStore = new InMemoryTaskStore();

  // 2. Create AgentExecutor
  const agentExecutor: AgentExecutor = new MovieAgentExecutor();

  // 3. Create DefaultRequestHandler
  const requestHandler = new DefaultRequestHandler(movieAgentCard, taskStore, agentExecutor);

  // 4. Create and setup Express.js app
  const app = express();

  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
  app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  // 5. Start the server
  const PORT = process.env.PORT || 41241;
  app.listen(PORT, (err) => {
    if (err) {
      throw err;
    }
    console.log(`[MovieAgent] Server using new framework started on http://localhost:${PORT}`);
    console.log(`[MovieAgent] Agent Card: http://localhost:${PORT}/.well-known/agent-card.json`);
    console.log('[MovieAgent] Press Ctrl+C to stop the server');
  });
}

main().catch(console.error);
