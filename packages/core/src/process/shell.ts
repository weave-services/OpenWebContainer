import { Shell } from "../shell/shell";
import { IFileSystem, ProcessEvent, ProcessState, ProcessType } from "../interfaces";
import { Process } from "./base";

/**
 * Shell Process Implementation
 */
export class ShellProcess extends Process {
    private shell: Shell;
    private prompt: string;

    constructor(
        pid: number,
        executablePath: string,
        args: string[],
        fileSystem: IFileSystem
    ) {
        super(pid, ProcessType.SHELL, executablePath, args);
        this.shell = new Shell(fileSystem);
        this.prompt = '$ ';
    }

    async start(): Promise<void> {
        try {
            this._state = ProcessState.RUNNING;
            this.emit(ProcessEvent.START, { pid: this.pid });

            // Run the command if args are provided
            if (this.args.length > 0) {
                const result = await this.shell.execute(this.args[0], this.args.slice(1));

                if (result.stdout) {
                    this.emit(ProcessEvent.MESSAGE, { stdout: result.stdout });
                }
                if (result.stderr) {
                    this.emit(ProcessEvent.MESSAGE, { stderr: result.stderr });
                }

                this._exitCode = result.exitCode;
                this._state = this._exitCode === 0 ? ProcessState.COMPLETED : ProcessState.FAILED;
            } else {
                // Interactive mode
                this.emit(ProcessEvent.MESSAGE, { stdout: this.prompt });
            }

            this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
        } catch (error) {
            this._state = ProcessState.FAILED;
            this._exitCode = 1;
            this.emit(ProcessEvent.ERROR, { pid: this.pid, error });
            this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
            throw error;
        }
    }

    async executeCommand(commandString: string): Promise<void> {
        if (this.state !== ProcessState.RUNNING) {
            throw new Error('Shell is not running');
        }

        // Split the command string, preserving quoted strings
        const args = commandString.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

        // Remove quotes from quoted arguments
        const processedArgs = args.map(arg =>
            arg.replace(/^["'](.+)["']$/, '$1')
        );

        if (processedArgs.length === 0) {
            this.emit(ProcessEvent.MESSAGE, { stdout: this.prompt });
            return;
        }

        const [command, ...commandArgs] = processedArgs;
        const result = await this.shell.execute(command, commandArgs);

        if (result.stdout) {
            this.emit(ProcessEvent.MESSAGE, { stdout: result.stdout });
        }
        if (result.stderr) {
            this.emit(ProcessEvent.MESSAGE, { stderr: result.stderr });
        }

        this.emit(ProcessEvent.MESSAGE, { stdout: this.prompt });
    }

    async terminate(): Promise<void> {
        if (this.state !== ProcessState.RUNNING) {
            return;
        }

        this._state = ProcessState.TERMINATED;
        this._exitCode = -1;
        this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
    }
}
