import { ProcessExecutor } from './base';
export class ProcessRegistry {
    private executors: Map<string, ProcessExecutor> = new Map();

    registerExecutor(type: string, executor: ProcessExecutor): void {
        this.executors.set(type, executor);
    }

    findExecutor(executable: string): ProcessExecutor | undefined {
        for (const [, executor] of this.executors.entries()) {
            if (executor.canExecute(executable)) {
                return executor;
            }
        }
        return undefined;
    }
}
