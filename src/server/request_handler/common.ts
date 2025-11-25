import { AgentCard } from '../../types.js';
import { ServerCallContext } from '../context.js';

export type ExtendedCardModifier = (
  extendedAgentCard: AgentCard,
  agentCard: AgentCard,
  context?: ServerCallContext
) => Promise<AgentCard>;
