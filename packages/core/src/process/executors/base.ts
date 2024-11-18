import { ChildProcessPayload, Process } from '../base';

export interface ProcessExecutor {
    canExecute(executable: string): boolean;
    execute(payload: ChildProcessPayload, pid: number, parentPid?: number): Promise<Process>;
}
