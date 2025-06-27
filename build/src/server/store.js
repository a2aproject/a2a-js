// ========================
// InMemoryTaskStore
// ========================
// Use Task directly for storage
export class InMemoryTaskStore {
    store = new Map();
    async load(taskId) {
        const entry = this.store.get(taskId);
        // Return copies to prevent external mutation
        return entry ? { ...entry } : undefined;
    }
    async save(task) {
        // Store copies to prevent internal mutation if caller reuses objects
        this.store.set(task.id, { ...task });
    }
}
//# sourceMappingURL=store.js.map