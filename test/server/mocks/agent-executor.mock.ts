import sinon, { SinonStub, SinonFakeTimers } from 'sinon';
import { AgentExecutor } from '../../../src/server/agent_execution/agent_executor.js';
import { RequestContext, ExecutionEventBus } from '../../../src/server/index.js';

/**
 * A mock implementation of AgentExecutor to control agent behavior during tests.
 */
export class MockAgentExecutor implements AgentExecutor {
    // Stubs to control and inspect calls to execute and cancelTask
    public execute: SinonStub<
        [RequestContext, ExecutionEventBus],
        Promise<void>
    > = sinon.stub();
    
    public cancelTask: SinonStub<[string, ExecutionEventBus], Promise<void>> =
        sinon.stub();
}

/**
 * Fake implementation of the task execution events.
 */
export const fakeTaskExecute = async (ctx: RequestContext, bus: ExecutionEventBus) => {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;
    
    // Publish task creation
    bus.publish({ 
        id: taskId, 
        contextId, 
        status: { state: "submitted" }, 
        kind: 'task' 
    });
    
    // Publish working status
    bus.publish({ 
        taskId, 
        contextId, 
        kind: 'status-update', 
        status: { state: "working" }, 
        final: false 
    });
    
    // Publish completion
    bus.publish({ 
        taskId, 
        contextId, 
        kind: 'status-update', 
        status: { state: "completed" }, 
        final: true 
    });
    
    bus.finished();
}

/**
 * A realistic mock of AgentExecutor for cancellation tests.
 */
export class CancellableMockAgentExecutor implements AgentExecutor {
    private cancelledTasks = new Set<string>();
    private clock: SinonFakeTimers;

    constructor(clock: SinonFakeTimers) {
        this.clock = clock;
    }

    public execute = async (
        requestContext: RequestContext,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        const taskId = requestContext.taskId;
        const contextId = requestContext.contextId;
        
        eventBus.publish({ id: taskId, contextId, status: { state: "submitted" }, kind: 'task' });
        eventBus.publish({ taskId, contextId, kind: 'status-update', status: { state: "working" }, final: false });
        
        // Simulate a long-running process
        for (let i = 0; i < 5; i++) {
            if (this.cancelledTasks.has(taskId)) {
                eventBus.publish({ taskId, contextId, kind: 'status-update', status: { state: "canceled" }, final: true });
                eventBus.finished();
                return;
            }
            // Use fake timers to simulate work
            await this.clock.tickAsync(100); 
        }

        eventBus.publish({ taskId, contextId, kind: 'status-update', status: { state: "completed" }, final: true });
        eventBus.finished();
    };
    
    public cancelTask = async (
        taskId: string,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        this.cancelledTasks.add(taskId);
        // The execute loop is responsible for publishing the final state
    };
    
    // Stub for spying on cancelTask calls
    public cancelTaskSpy = sinon.spy(this, 'cancelTask');
}
