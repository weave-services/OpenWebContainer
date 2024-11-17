import { BaseCommand, OptionDefinition, CommandOptionsDefinition } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { OSC } from "./utils";
import { Session } from "./session";

// Import all supported commands
import { LsCommand } from "./ls";
import { CdCommand } from "./cd";
import { PwdCommand } from "./pwd";
import { MkdirCommand } from "./mkdir";
import { TouchCommand } from "./touch";
import { CatCommand } from "./cat";
import { RmCommand } from "./rm";
import { EchoCommand } from "./echo";

import { NpmCommand } from "./npm";

interface JshOptionsDefinition extends CommandOptionsDefinition {
    noprofile: OptionDefinition<boolean>;
    norc: OptionDefinition<boolean>;
}

type CommandMap = { [key: string]: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => BaseCommand };

interface CommandHistory {
    entries: string[];
    maxSize: number;
    position: number;
    current: string;
}

export class JshCommand extends BaseCommand<JshOptionsDefinition> {
    private commands: CommandMap;
    private prompt: string;
    private continuationPrompt: string;
    private running: boolean = true;
    private history: CommandHistory;
    private currentLine: string = '';
    private cursorPos: number = 0;
    private lastKey: string = '';

    protected get commandName(): string {
        return 'jsh';
    }

    protected get optionsDefinition(): JshOptionsDefinition {
        return {
            noprofile: {
                type: 'boolean',
                value: false,
                description: 'Do not read startup file',
                longFlag: 'noprofile'
            },
            norc: {
                type: 'boolean',
                value: false,
                description: 'Do not read initialization file',
                longFlag: 'norc'
            }
        };
    }

    constructor(session: Session, inputStream: ReadableStreamDefaultReader<string>) {
        super(session, inputStream);

        // Register available commands
        this.commands = {
            ls: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new LsCommand(session, inputStream),
            cd: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new CdCommand(session, inputStream),
            pwd: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new PwdCommand(session, inputStream),
            mkdir: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new MkdirCommand(session, inputStream),
            touch: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new TouchCommand(session, inputStream),
            cat: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new CatCommand(session, inputStream),
            rm: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new RmCommand(session, inputStream),
            echo: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new EchoCommand(session, inputStream),
            exit: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new JshExitCommand(session, inputStream),
            npm: (session: Session, inputStream: ReadableStreamDefaultReader<string>) => new NpmCommand(session, inputStream)
        };

        this.prompt = `${OSC.green}jsh${OSC.reset}:${OSC.blue}%d${OSC.reset}$ `;
        this.continuationPrompt = '> ';

        // Initialize command history
        this.history = {
            entries: [],
            maxSize: 1000,
            position: -1,
            current: ''
        };
    }

    private formatPrompt(): string {
        return this.prompt.replace('%d', this.session.getCurrentDirectory());
    }

    private async readCommand(): Promise<string> {
        this.currentLine = '';
        this.cursorPos = 0;
        let inQuote = false;
        let quoteChar = '';
        let escapeNext = false;

        // Print initial prompt
        await this.output.emit(this.formatPrompt(), 'prompt');

        while (true) {
            const { value: key, done } = await this.output.read();
            if (done) break;
            if (!key) continue
            // Handle escape sequences
            if (this.lastKey === '\x1b' && key === '[') {
                this.lastKey = key;
                continue;
            }

            if (this.lastKey === '[') {
                switch (key) {
                    case 'A': // Up arrow
                        await this.handleHistoryNavigation('up');
                        break;
                    case 'B': // Down arrow
                        await this.handleHistoryNavigation('down');
                        break;
                    case 'C': // Right arrow
                        await this.handleCursorMove('right');
                        break;
                    case 'D': // Left arrow
                        await this.handleCursorMove('left');
                        break;
                }
                this.lastKey = '';
                continue;
            }

            this.lastKey = key;

            if (key === '\x1b') {
                continue;
            }

            // Handle regular input
            if (key.length === 1) {
                const charCode = key.charCodeAt(0);

                if (charCode === 13) { // Enter key
                    await this.output.emit('\r\n');
                    if (this.currentLine.trim() !== '') {
                        this.addToHistory(this.currentLine);
                    }
                    break;
                }

                if (charCode === 127) { // Backspace
                    if (this.cursorPos > 0) {
                        await this.handleBackspace();
                    }
                    continue;
                }

                // Regular character input
                await this.handleCharacterInput(key);

                if (key === '\\' && !escapeNext) {
                    escapeNext = true;
                    continue;
                }

                if (!escapeNext && (key === '"' || key === "'")) {
                    if (!inQuote) {
                        inQuote = true;
                        quoteChar = key;
                    } else if (key === quoteChar) {
                        inQuote = false;
                    }
                }

                escapeNext = false;
            }
        }

        return this.currentLine.trim();
    }

    private async handleHistoryNavigation(direction: 'up' | 'down'): Promise<void> {
        if (this.history.entries.length === 0) return;

        // Save current line if we're just starting to navigate history
        if (this.history.position === -1) {
            this.history.current = this.currentLine;
        }

        if (direction === 'up' && this.history.position < this.history.entries.length - 1) {
            this.history.position++;
        } else if (direction === 'down' && this.history.position >= 0) {
            this.history.position--;
        } else {
            return;
        }

        // Clear current line
        await this.clearLine();

        // Get historical or saved current line
        const newLine = this.history.position >= 0
            ? this.history.entries[this.history.entries.length - 1 - this.history.position]
            : this.history.current;

        // Update current line and cursor position
        this.currentLine = newLine;
        this.cursorPos = newLine.length;

        // Redraw prompt and line
        await this.output.emit(this.formatPrompt() + newLine, 'prompt');
    }

    private async handleCursorMove(direction: 'left' | 'right'): Promise<void> {
        if (direction === 'left' && this.cursorPos > 0) {
            await this.output.emit('\x1b[D');
            this.cursorPos--;
        } else if (direction === 'right' && this.cursorPos < this.currentLine.length) {
            await this.output.emit('\x1b[C');
            this.cursorPos++;
        }
    }

    private async handleBackspace(): Promise<void> {
        if (this.cursorPos > 0) {
            const before = this.currentLine.slice(0, this.cursorPos - 1);
            const after = this.currentLine.slice(this.cursorPos);
            this.currentLine = before + after;
            this.cursorPos--;

            // Move cursor back, write space, move cursor back again
            await this.output.emit('\b \b');

            // If we're not at the end of the line, redraw the rest
            if (this.cursorPos < this.currentLine.length) {
                await this.output.emit(after + ' ');
                // Move cursor back to position
                await this.output.emit(`\x1b[${after.length + 1}D`);
            }
        }
    }

    private async handleCharacterInput(char: string): Promise<void> {
        const before = this.currentLine.slice(0, this.cursorPos);
        const after = this.currentLine.slice(this.cursorPos);
        this.currentLine = before + char + after;

        // Write the new character and everything after it
        await this.output.emit(char + after);

        // Move cursor back to new position if needed
        if (after.length > 0) {
            await this.output.emit(`\x1b[${after.length}D`);
        }

        this.cursorPos++;
    }

    private async clearLine(): Promise<void> {
        // Move cursor to start of prompt
        await this.output.emit('\r');
        // Clear from cursor to end of line
        await this.output.emit('\x1b[K');
    }

    private addToHistory(command: string): void {
        if (command.trim() &&
            (this.history.entries.length === 0 ||
                this.history.entries[this.history.entries.length - 1] !== command)) {

            this.history.entries.push(command);
            if (this.history.entries.length > this.history.maxSize) {
                this.history.entries.shift();
            }
        }
        this.history.position = -1;
        this.history.current = '';
    }

    private parseCommand(commandLine: string): { command: string; args: string[] } {
        const tokens: string[] = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < commandLine.length; i++) {
            const char = commandLine[i];

            if (char === '"' || char === "'") {
                if (!inQuote) {
                    inQuote = true;
                    quoteChar = char;
                } else if (char === quoteChar) {
                    inQuote = false;
                    if (current) tokens.push(current);
                    current = '';
                } else {
                    current += char;
                }
            } else if (char === ' ' && !inQuote) {
                if (current) tokens.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        if (current) tokens.push(current);

        return {
            command: tokens[0] || '',
            args: tokens.slice(1)
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        try {
            const { options } = this.parseOptions(args);

            // Initialize shell environment
            if (!options.noprofile) {
                await this.loadProfile();
            }
            if (!options.norc) {
                await this.loadRc();
            }

            // Main shell loop
            while (this.running) {
                try {
                    const commandLine = await this.readCommand();
                    if (!commandLine) continue;

                    const { command, args } = this.parseCommand(commandLine);
                    await this.executeCommand(command, args);
                    await this.output.emit('\r\n', 'info');

                } catch (error: any) {
                    this.output.emit(error.message, 'error');
                }
            }

        } catch (error: any) {
            this.output.emit(error.message, 'error');
        }

        await this.finish();
        return this.output;
    }

    private async executeCommand(command: string, args: string[]): Promise<void> {
        const CommandClass = this.commands[command];
        if (!CommandClass) {
            this.output.emit(`jsh: command not found: ${command}`, 'error');
            return;
        }

        try {
            const commandInstance = CommandClass(this.session, this.inputReader);
            const reader = commandInstance.process.output.getReader();
            let executionPrms = commandInstance.execute(args);

            // Read and forward all chunks from the command's output
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    // Forward the chunk to the shell's output
                    await this.output.emit(value.content, value.type);
                }
            } finally {
                reader.releaseLock();
            }
            await executionPrms;

            if (command === 'exit') {
                this.running = false;
            }
        } catch (error: any) {
            this.output.emit(`jsh: ${error.message}`, 'error');
        }
    }

    private async loadProfile(): Promise<void> {
        // Load system-wide profile
        // This would typically load from /etc/profile
    }

    private async loadRc(): Promise<void> {
        // Load user's rc file
        // This would typically load from ~/.jshrc
    }

    public async stop(): Promise<void> {
        this.running = false;
    }
}

// Simple exit command implementation
class JshExitCommand extends BaseCommand {
    protected get commandName(): string {
        return 'exit';
    }

    protected get optionsDefinition(): CommandOptionsDefinition {
        return {};
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        // Process exit code if provided
        const exitCode = args.length > 0 ? parseInt(args[0], 10) : 0;
        if (isNaN(exitCode)) {
            this.output.emit(`exit: numeric argument required`, 'error');
        }
        await this.finish();
        return this.output;
    }
}