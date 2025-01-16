import { ProcessExecutor } from "../base";
import { ChildProcessPayload, Process } from "../../base";
import { NodeProcess } from "./process";
import { IFileSystem } from "../../../filesystem";
import { NetworkManager } from "../../../network/manager";

export class NodeProcessExecutor implements ProcessExecutor {
    constructor(
        private fileSystem: IFileSystem,
        private networkManager: NetworkManager
    ) { }

    canExecute(executable: string): boolean {
        return executable === 'node' || executable.endsWith('.js');
    }

    async execute(payload: ChildProcessPayload, pid: number, parentPid?: number): Promise<Process> {
        let executablePath = payload.executable;
        let args = payload.args;

        let cwd = payload.cwd||'/';
        // If the command is 'node', the first arg is the script
        if (executablePath === 'node') {
            if (args.length === 0) {
                throw new Error('No JavaScript file specified');
            }
            executablePath = args[0];
            args = args.slice(1);
        }

        return new NodeProcess(
            pid,
            executablePath,
            args,
            this.fileSystem,
            this.networkManager,
            parentPid, 
            cwd
        );
    }
}
