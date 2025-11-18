import sinon, { SinonStub } from 'sinon';
import { Task } from '../../../src/index.js';
import { TaskStore } from '../../../src/server/store.js';

export class MockTaskStore implements TaskStore {
  public save: SinonStub<[Task], Promise<void>> = sinon.stub();
  public load: SinonStub<[string], Promise<Task | undefined>> = sinon.stub();
}
