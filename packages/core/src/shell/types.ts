/**
 * Shell command parsing result
 */
export interface CommandParsedResult {
    command: string;
    args: string[];
    redirects: {
        type: '>>' | '>';
        file: string;
    }[];
}

/**
 * Result of a shell command execution
 */
export interface ShellCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 * export interface for shell operations
 */
export interface IShell {
    execute(command: string, args: string[]): Promise<ShellCommandResult>;
    getWorkingDirectory(): string;
    setWorkingDirectory(path: string): void;
}
