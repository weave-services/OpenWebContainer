/**
 * Process states
 */
export enum ProcessState {
    CREATED = 'created',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    TERMINATED = 'terminated'
}

/**
 * Process types
 */
export enum ProcessType {
    JAVASCRIPT = 'javascript',
    SHELL = 'shell'
}

/**
 * Process events that can be emitted
 */
export enum ProcessEvent {
    START = 'start',
    EXIT = 'exit',
    ERROR = 'error',
    MESSAGE = 'message'
}

/**
 * Process event listener type
 */
export type ProcessEventListener = (data: any) => void;

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
 * export interface for file system operations
 */
export interface IFileSystem {
    writeFile(path: string, content: string): void;
    readFile(path: string): string | undefined;
    deleteFile(path: string, recursive?: boolean): void;
    listFiles(): string[];
    resolveModulePath(specifier: string, basePath?: string): string;
    createDirectory(path: string): void;
    deleteDirectory(path: string): void;
    listDirectory(path: string): string[];
    isDirectory(path: string): boolean;
}

/**
 * export interface for JavaScript runtime operations
 */
export interface IJavaScriptRuntime {
    evaluate(code: string, filename?: string, options?: { type?: "module" | "script" }): Promise<any>;
    dispose(): void;
}

/**
 * export interface for shell operations
 */
export interface IShell {
    execute(command: string, args: string[]): Promise<ShellCommandResult>;
    getWorkingDirectory(): string;
    setWorkingDirectory(path: string): void;
}