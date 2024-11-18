import { Shell } from "../shell/shell";
import { IFileSystem, ProcessEvent, ProcessState, ProcessType } from "../interfaces";
import { Process } from "./base";

export class ShellProcess extends Process {
    private shell: Shell;
    private prompt: string;
    private currentLine: string = '';
    private running: boolean = true;
    private filteredArgs: string[];

    constructor(
        pid: number,
        executablePath: string,
        args: string[],
        fileSystem: IFileSystem
    ) {
        super(pid, ProcessType.SHELL, executablePath, args);

        const oscMode = args.includes('--osc');
        this.filteredArgs = args.filter(arg => arg !== '--osc');

        this.shell = new Shell(fileSystem, { oscMode });
        this.prompt = oscMode ? '\x1b[1;32m$\x1b[0m ' : '$ ';
    }

    private async executeCommand(commandString: string): Promise<void> {
        const args = commandString.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        const processedArgs = args.map(arg => arg.replace(/^["'](.+)["']$/, '$1'));

        if (processedArgs.length === 0) {
            this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' + this.prompt });
            return;
        }

        const [command, ...commandArgs] = processedArgs;
        try {
            const result = await this.shell.execute(command, commandArgs);

            // First emit the newline for the command
            this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' });

            // Then emit any stdout/stderr
            if (result.stdout) {
                // Ensure each line starts with \r\n
                const lines = result.stdout.split('\n');
                lines.forEach((line, index) => {
                    if (index > 0) {
                        this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' });
                    }
                    if (line) {
                        this.emit(ProcessEvent.MESSAGE, { stdout: line });
                    }
                });
            }

            if (result.stderr) {
                const lines = result.stderr.split('\n');
                lines.forEach((line, index) => {
                    if (index > 0 || result.stdout) {
                        this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' });
                    }
                    if (line) {
                        this.emit(ProcessEvent.MESSAGE, { stderr: line });
                    }
                });
            }

            // Finally emit the prompt on a new line
            if (result.stdout || result.stderr) {
                this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' + this.prompt });
            } else {
                this.emit(ProcessEvent.MESSAGE, { stdout: this.prompt });
            }

        } catch (error: any) {
            this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' });
            this.emit(ProcessEvent.MESSAGE, { stderr: error.message });
            this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' + this.prompt });
        }
    }

    async start(): Promise<void> {
        try {
            this._state = ProcessState.RUNNING;
            this.emit(ProcessEvent.START, { pid: this.pid });

            if (this.filteredArgs.length > 0) {
                const result = await this.shell.execute(this.filteredArgs[0], this.filteredArgs.slice(1));

                if (result.stdout) {
                    this.emit(ProcessEvent.MESSAGE, { stdout: result.stdout + '\r\n' });
                }
                if (result.stderr) {
                    this.emit(ProcessEvent.MESSAGE, { stderr: result.stderr + '\r\n' });
                }

                this._exitCode = result.exitCode;
                this._state = this._exitCode === 0 ? ProcessState.COMPLETED : ProcessState.FAILED;
                this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
                return;
            }

            // Initial prompt
            this.emit(ProcessEvent.MESSAGE, { stdout: this.prompt });

            while (this.running) {
                const input = await this.readInput();

                switch (input) {
                    case '\x1b[A': // Up arrow
                        const prevCmd = this.shell.getPreviousCommand();
                        if (prevCmd) {
                            this.updateInputLine(prevCmd);
                        }
                        break;

                    case '\x1b[B': // Down arrow
                        const nextCmd = this.shell.getNextCommand();
                        this.updateInputLine(nextCmd);
                        break;

                    case '\r': // Enter
                        if (this.currentLine.trim()) {
                            await this.executeCommand(this.currentLine);
                            this.currentLine = '';
                        } else {
                            this.emit(ProcessEvent.MESSAGE, { stdout: '\r\n' + this.prompt });
                        }
                        break;

                    case '\b': // Backspace
                        if (this.currentLine.length > 0) {
                            this.currentLine = this.currentLine.slice(0, -1);
                            this.emit(ProcessEvent.MESSAGE, { stdout: '\b \b' });
                        }
                        break;

                    default:
                        if (input.length === 1 && input >= ' ') {
                            this.currentLine += input;
                            this.emit(ProcessEvent.MESSAGE, { stdout: input });
                        }
                        break;
                }
            }
        } catch (error) {
            this._state = ProcessState.FAILED;
            this._exitCode = 1;
            this.emit(ProcessEvent.ERROR, { pid: this.pid, error });
            this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
            throw error;
        }
    }
    

    private updateInputLine(newLine: string): void {
        // Clear current line
        this.emit(ProcessEvent.MESSAGE, { stdout: '\r\x1b[K' });
        // Write prompt and new line
        this.emit(ProcessEvent.MESSAGE, { stdout: this.prompt + (newLine || '') });
        this.currentLine = newLine;
    }

    async terminate(): Promise<void> {
        if (this.state !== ProcessState.RUNNING) {
            return;
        }

        this.running = false;
        this._state = ProcessState.TERMINATED;
        this._exitCode = -1;
        this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
    }
}