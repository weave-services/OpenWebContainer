import { IShell, IFileSystem, ShellCommandResult, CommandParsedResult } from '../interfaces';

class Shell implements IShell {
    private fileSystem: IFileSystem;
    private currentDirectory: string;
    private env: Map<string, string>;

    constructor(fileSystem: IFileSystem) {
        this.fileSystem = fileSystem;
        this.currentDirectory = '/';
        this.env = new Map([
            ['PATH', '/bin:/usr/bin'],
            ['HOME', '/home'],
            ['PWD', this.currentDirectory],
        ]);
    }

    getWorkingDirectory(): string {
        return this.currentDirectory;
    }

    setWorkingDirectory(path: string): void {
        const resolvedPath = this.resolvePath(path);
        if (!this.fileSystem.isDirectory(resolvedPath)) {
            throw new Error(`Directory not found: ${path}`);
        }
        this.currentDirectory = resolvedPath;
        this.env.set('PWD', resolvedPath);
    }

    private resolvePath(path: string): string {
        if (path.startsWith('/')) {
            return path;
        }
        return `${this.currentDirectory}/${path}`.replace(/\/+/g, '/');
    }

    private parseCommand(args: string[]): CommandParsedResult {
        const result: CommandParsedResult = {
            command: '',
            args: [],
            redirects: []
        };

        let i = 0;
        while (i < args.length) {
            const arg = args[i];

            if (arg === '>' || arg === '>>') {
                if (i + 1 >= args.length) {
                    throw new Error(`Syntax error: missing file for redirection ${arg}`);
                }
                result.redirects.push({
                    type: arg as ('>' | '>>'),
                    file: args[i + 1]
                });
                i += 2;
            } else {
                if (!result.command) {
                    result.command = arg;
                } else {
                    result.args.push(arg);
                }
                i++;
            }
        }

        return result;
    }

    private handleRedirection(output: string, redirects: CommandParsedResult['redirects']): void {
        for (const redirect of redirects) {
            const filePath = this.resolvePath(redirect.file);

            try {
                if (redirect.type === '>>') {
                    // Append to file
                    const existingContent = this.fileSystem.readFile(filePath) || '';
                    this.fileSystem.writeFile(filePath, existingContent + output);
                } else {
                    // Overwrite file
                    this.fileSystem.writeFile(filePath, output);
                }
            } catch (error: any) {
                throw new Error(`Failed to redirect to ${redirect.file}: ${error.message}`);
            }
        }
    }

    async execute(command: string, args: string[]): Promise<ShellCommandResult> {
        try {
            // Handle empty command
            if (!command) {
                return this.success();
            }

            // Parse command and redirections
            const parsedCommand = this.parseCommand([command, ...args]);

            // Execute the actual command
            const result = await this.executeBuiltin(
                parsedCommand.command,
                parsedCommand.args
            );

            // Handle redirections if command was successful
            if (result.exitCode === 0 && parsedCommand.redirects.length > 0) {
                try {
                    this.handleRedirection(result.stdout, parsedCommand.redirects);
                    // Clear stdout since it was redirected
                    result.stdout = '';
                } catch (error: any) {
                    return {
                        stdout: '',
                        stderr: error.message,
                        exitCode: 1
                    };
                }
            }

            return result;
        } catch (error: any) {
            return {
                stdout: '',
                stderr: error.message,
                exitCode: 1
            };
        }
    }

    private success(stdout: string = ''): ShellCommandResult {
        return { stdout, stderr: '', exitCode: 0 };
    }

    private failure(stderr: string): ShellCommandResult {
        return { stdout: '', stderr, exitCode: 1 };
    }

    private async executeBuiltin(command: string, args: string[]): Promise<ShellCommandResult> {
        switch (command) {
            case 'ls':
                return this.ls(args);
            case 'mkdir':
                return this.mkdir(args);
            case 'rm':
                return this.rm(args);
            case 'rmdir':
                return this.rmdir(args);
            case 'touch':
                return this.touch(args);
            case 'pwd':
                return this.pwd();
            case 'cd':
                return this.cd(args);
            case 'echo':
                return this.echo(args);
            case 'cat':
                return this.cat(args);
            case 'cp':
                return this.cp(args);
            case 'mv':
                return this.mv(args);
            // case 'env':
            //     return this.env_(args);
            default:
                return {
                    stdout: '',
                    stderr: `Command not found: ${command}`,
                    exitCode: 127
                };
        }
    }

    // Built-in command implementations
    private async ls(args: string[]): Promise<ShellCommandResult> {
        try {
            const path = args[0] || this.currentDirectory;
            const resolvedPath = this.resolvePath(path);
            const entries = this.fileSystem.listDirectory(resolvedPath);
            return this.success(entries.join('\n'));
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async cat(args: string[]): Promise<ShellCommandResult> {
        if (args.length === 0) {
            return this.failure('No file specified');
        }
        try {
            const content = this.fileSystem.readFile(this.resolvePath(args[0]));
            if (content === undefined) {
                return this.failure(`File not found: ${args[0]}`);
            }
            return this.success(content);
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async mkdir(args: string[]): Promise<ShellCommandResult> {
        if (args.length === 0) {
            return this.failure('No directory specified');
        }
        try {
            this.fileSystem.createDirectory(this.resolvePath(args[0]));
            return this.success();
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async rm(args: string[]): Promise<ShellCommandResult> {
        if (args.length === 0) {
            return this.failure('No file specified');
        }
        try {
            const recursive = args.includes('-r') || args.includes('-rf');
            const files = args.filter(arg => !arg.startsWith('-'));

            for (const file of files) {
                this.fileSystem.deleteFile(this.resolvePath(file), recursive);
            }
            return this.success();
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async rmdir(args: string[]): Promise<ShellCommandResult> {
        if (args.length === 0) {
            return this.failure('No directory specified');
        }
        try {
            this.fileSystem.deleteDirectory(this.resolvePath(args[0]));
            return this.success();
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async touch(args: string[]): Promise<ShellCommandResult> {
        if (args.length === 0) {
            return this.failure('No file specified');
        }
        try {
            this.fileSystem.writeFile(this.resolvePath(args[0]), '');
            return this.success();
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async pwd(): Promise<ShellCommandResult> {
        return this.success(this.currentDirectory);
    }

    private async cd(args: string[]): Promise<ShellCommandResult> {
        try {
            const path = args[0] || '/';
            const newPath = this.resolvePath(path);
            if (!this.fileSystem.isDirectory(newPath)) {
                return this.failure(`Directory not found: ${path}`);
            }
            this.currentDirectory = newPath;
            this.env.set('PWD', newPath);
            return this.success();
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async echo(args: string[]): Promise<ShellCommandResult> {
        return this.success(args.join(' ') + '\n');
    }

    private async cp(args: string[]): Promise<ShellCommandResult> {
        if (args.length < 2) {
            return this.failure('Source and destination required');
        }
        try {
            const [src, dest] = args;
            const content = this.fileSystem.readFile(this.resolvePath(src));
            if (content === undefined) {
                return this.failure(`Source file not found: ${src}`);
            }
            this.fileSystem.writeFile(this.resolvePath(dest), content);
            return this.success();
        } catch (error: any) {
            return this.failure(error.message);
        }
    }

    private async mv(args: string[]): Promise<ShellCommandResult> {
        if (args.length < 2) {
            return this.failure('Source and destination required');
        }
        try {
            const [src, dest] = args;
            const content = this.fileSystem.readFile(this.resolvePath(src));
            if (content === undefined) {
                return this.failure(`Source file not found: ${src}`);
            }
            this.fileSystem.writeFile(this.resolvePath(dest), content);
            this.fileSystem.deleteFile(this.resolvePath(src));
            return this.success();
        } catch (error: any) {
            return this.failure(error.message);
        }
    }
}

export { Shell };