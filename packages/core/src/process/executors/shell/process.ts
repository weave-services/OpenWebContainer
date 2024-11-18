import { Process } from '../../base/process';
import { Shell } from '../../../shell';
import { ProcessEvent, ProcessState, ProcessType } from '../../base';
import { IFileSystem } from '../../../filesystem';
import { ShellCommandResult } from '../../../shell';

interface CommandHistoryEntry {
    command: string;
    timestamp: Date;
}

export class ShellProcess extends Process {
    private shell: Shell;
    private prompt: string;
    private currentLine: string = '';
    private running: boolean = true;
    private filteredArgs: string[];
    private commandHistory: CommandHistoryEntry[] = [];
    private historyIndex: number = -1;

    // Add readline state
    private cursorPosition: number = 0;
    private lineBuffer: string[] = [];

    private fileSystem: IFileSystem;

    constructor(
        pid: number,
        executablePath: string,
        args: string[],
        fileSystem: IFileSystem,
        parentPid?: number,
        cwd?: string,
        env?: Map<string, string>
    ) {
        super(pid, ProcessType.SHELL, executablePath, args, parentPid,cwd,env);
        this.fileSystem = fileSystem;
        const oscMode = args.includes('--osc');
        this.filteredArgs = args.filter(arg => arg !== '--osc');

        this.shell = new Shell(fileSystem, { oscMode });
        this.prompt = oscMode ? '\x1b[1;32m$\x1b[0m ' : '$ ';
    }

    protected async execute(): Promise<void> {
        try {
            // Handle initial command if provided in args
            if (this.filteredArgs.length > 0) {
                const result = await this.executeCommand(this.filteredArgs.join(' '));
                if (result.stdout) {
                    this.emitOutput(result.stdout + '\n');
                }
                if (result.stderr) {
                    this.emitError(result.stderr + '\n');
                }
                this._exitCode = result.exitCode;
                return;
            }

            // Initial prompt
            this.emitOutput(this.prompt);

            // Interactive shell loop
            while (this.running && this.state === ProcessState.RUNNING) {
                const input = await this.readInput();
                await this.handleInput(input);
            }
        } catch (error: any) {
            this.emitError(`Shell error: ${error.message}\n`);
            throw error;
        }
    }

    protected async onTerminate(): Promise<void> {
        this.running = false;
        this.emitOutput('\nShell terminated.\n');
    }

    private async handleInput(input: string): Promise<void> {
        switch (input) {
            case '\r': // Enter
                await this.handleEnterKey();
                break;

            case '\x7F': // Backspace
            case '\b':
                this.handleBackspace();
                break;

            case '\x1b[A': // Up arrow
                this.handleUpArrow();
                break;

            case '\x1b[B': // Down arrow
                this.handleDownArrow();
                break;

            case '\x1b[C': // Right arrow
                this.handleRightArrow();
                break;

            case '\x1b[D': // Left arrow
                this.handleLeftArrow();
                break;

            case '\x03': // Ctrl+C
                this.handleCtrlC();
                break;

            case '\x04': // Ctrl+D
                this.handleCtrlD();
                break;

            default:
                if (input.length === 1 && input >= ' ') {
                    this.handleCharacterInput(input);
                }
                break;
        }
    }

    private async handleEnterKey(): Promise<void> {
        this.emitOutput('\n');

        const commandLine = this.currentLine.trim();
        if (commandLine) {
            // Add to history
            this.commandHistory.push({
                command: commandLine,
                timestamp: new Date()
            });
            this.historyIndex = this.commandHistory.length;

            // Execute command
            const result = await this.executeCommand(commandLine);

            // Handle output
            if (result.stdout) {
                this.emitOutput(result.stdout);
                if (!result.stdout.endsWith('\n')) {
                    this.emitOutput('\n');
                }
            }
            if (result.stderr) {
                this.emitError(result.stderr);
                if (!result.stderr.endsWith('\n')) {
                    this.emitOutput('\n');
                }
            }
        }

        // Reset current line and show new prompt
        this.currentLine = '';
        this.cursorPosition = 0;
        this.emitOutput(this.prompt);
    }

    private handleBackspace(): void {
        if (this.cursorPosition > 0) {
            const before = this.currentLine.slice(0, this.cursorPosition - 1);
            const after = this.currentLine.slice(this.cursorPosition);
            this.currentLine = before + after;
            this.cursorPosition--;

            // Update display
            this.emitOutput('\b \b'); // Move back, clear character, move back
            if (after) {
                // Redraw rest of the line
                this.emitOutput(after + '\x1b[K'); // Clear to end of line
                // Move cursor back to position
                this.emitOutput(`\x1b[${after.length}D`);
            }
        }
    }

    private handleUpArrow(): void {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.updateInputLine(this.commandHistory[this.historyIndex].command);
        }
    }

    private handleDownArrow(): void {
        if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            this.updateInputLine(this.commandHistory[this.historyIndex].command);
        } else {
            this.historyIndex = this.commandHistory.length;
            this.updateInputLine('');
        }
    }

    private handleLeftArrow(): void {
        if (this.cursorPosition > 0) {
            this.cursorPosition--;
            this.emitOutput('\x1b[D');
        }
    }

    private handleRightArrow(): void {
        if (this.cursorPosition < this.currentLine.length) {
            this.cursorPosition++;
            this.emitOutput('\x1b[C');
        }
    }

    private handleCtrlC(): void {
        this.currentLine = '';
        this.cursorPosition = 0;
        this.emitOutput('^C\n' + this.prompt);
    }

    private handleCtrlD(): void {
        if (this.currentLine.length === 0) {
            this.emitOutput('exit\n');
            this.running = false;
            this._exitCode = 0;
        }
    }

    private handleCharacterInput(char: string): void {
        // Insert character at cursor position
        const before = this.currentLine.slice(0, this.cursorPosition);
        const after = this.currentLine.slice(this.cursorPosition);
        this.currentLine = before + char + after;
        this.cursorPosition++;

        // Update display
        this.emitOutput(char);
        if (after) {
            // Redraw rest of the line
            this.emitOutput(after);
            // Move cursor back to position
            this.emitOutput(`\x1b[${after.length}D`);
        }
    }

    private updateInputLine(newLine: string): void {
        // Clear current line
        this.emitOutput('\r\x1b[K');
        // Write prompt and new line
        this.emitOutput(this.prompt + newLine);
        this.currentLine = newLine;
        this.cursorPosition = newLine.length;
    }

    private async executeCommand(commandLine: string): Promise<ShellCommandResult> {
        const args = commandLine.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        const processedArgs = args.map(arg => arg.replace(/^["'](.+)["']$/, '$1'));


        if (processedArgs.length === 0) {
            return { stdout: '', stderr: '', exitCode: 0 };
        }

        const [command, ...cmdArgs] = processedArgs;

        // Handle built-in commands
        switch (command) {
            case 'exit':
                this.running = false;
                this._exitCode = 0;
                return { stdout: '', stderr: '', exitCode: 0 };

            case 'history':
                const historyOutput = this.commandHistory
                    .map((entry, index) =>
                        `${index + 1}: [${entry.timestamp.toISOString()}] ${entry.command}`)
                    .join('\n');
                return { stdout: historyOutput, stderr: '', exitCode: 0 };

            default:
                // Try to execute as a program
                try {
                    if(this.shell.hasCommand(command)) {
                        return await this.shell.execute(command, cmdArgs);
                    }
                    else{
                        // check if the command is in env PATH
                        let PATH= this.env.get('PATH');
                        if (PATH) {
                            const paths = PATH.split(':');
                            for (const path of paths) {
                                const executablePath = this.fileSystem.resolvePath(command,path);
                                if (this.fileSystem.fileExists(executablePath)) {
                                    return await this.spawnChild(executablePath, cmdArgs);
                                }
                            }
                        }
                        // check for shebang
                        let content = this.fileSystem.readFile(command);
                        if (content) {
                            const shebang = content.match(/^#!(.*)/);
                            if (shebang) {
                                const interpreterName = shebang[1];
                                let name = interpreterName.split(" ")[0]
                                if (name=='/usr/bin/env'){
                                    let tokens = interpreterName.split(" ")
                                    if (tokens.length==1)
                                        throw "executor not specified"
                                    let newCommand=tokens[1]
                                    return await this.spawnChild(newCommand, [command, ...cmdArgs]);
                                }
                            }
                        }
                    }

                    if (command.endsWith('.js') || command === 'node') {
                        const result = await this.spawnChild(command, cmdArgs);
                        return result;
                    }
                    // Execute through shell
                    return await this.shell.execute(command, cmdArgs);
                } catch (error: any) {
                    return {
                        stdout: '',
                        stderr: error.message,
                        exitCode: 1
                    };
                }
        }
    }
}