import { IFileSystem } from '../../../filesystem';
import { ProcessExecutor } from '../base';
import { ShellProcess } from './process';
import { ChildProcessPayload, Process } from '../../base';

export class ShellProcessExecutor implements ProcessExecutor {
    constructor(private fileSystem: IFileSystem) { }

    canExecute(executable: string): boolean {
        return executable === 'sh';
    }

    async execute(payload: ChildProcessPayload, pid: number,parantPid?: number): Promise<Process> {
        return new ShellProcess(
            pid,
            payload.executable,
            payload.args,
            this.fileSystem,
            parantPid,
            payload.cwd
        );
    }
}

