// commands/base.ts
import { Process } from '../../process';
import { IFileSystem } from '../../filesystem';
import { ShellCommandResult } from '../types';

export interface CommandOptions {
    cwd: string;
    fileSystem: IFileSystem;
    env?: Map<string, string>;
    process: Process;
}

export interface CommandHelp {
    name: string;
    description: string;
    usage: string;
    examples: string[];
}

export abstract class ShellCommand {
    protected cwd: string;
    protected fileSystem: IFileSystem;
    protected env: Map<string, string>;
    protected process: Process;

    constructor(options: CommandOptions) {
        this.cwd = options.cwd;
        this.fileSystem = options.fileSystem;
        this.env = options.env || new Map();
        this.process = options.process;
    }

    abstract get help(): CommandHelp;

    abstract execute(args: string[]): Promise<ShellCommandResult>;

    protected success(stdout: string = ''): ShellCommandResult {
        return {
            stdout: stdout ? stdout + '\n' : '',
            stderr: '',
            exitCode: 0
        };
    }

    protected error(message: string, code: number = 1): ShellCommandResult {
        return {
            stdout: '',
            stderr: message + '\n',
            exitCode: code
        };
    }

    protected resolvePath(path: string): string {
        if (path.startsWith('/')) {
            return path;
        }
        return `${this.cwd}/${path}`.replace(/\/+/g, '/');
    }

    protected showHelp(): ShellCommandResult {
        const { name, description, usage, examples } = this.help;
        let output = `${name} - ${description}\n\n`;
        output += `Usage: ${usage}\n\n`;
        if (examples.length > 0) {
            output += 'Examples:\n';
            examples.forEach(example => {
                output += `  ${example}\n`;
            });
        }
        return this.success(output);
    }
}