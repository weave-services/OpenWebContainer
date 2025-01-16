export interface ProcessOptions {
    cwd?: string;
    env?: Record<string, string>;
}

export interface ProcessStats {
    pid: number;
    status: 'running' | 'exited';
    exitCode: number | null;
    startTime: Date;
    endTime?: Date;
    uptime: number;
    command: string;
    args: string[];
}

export interface ProcessEventMap {
    'output': { output: string; isError: boolean };
    'exit': { exitCode: number | null };
    'error': { error: Error };
}

export interface ProcessOptions {
    cwd?: string;
    env?: Record<string, string>;
}
export enum ProcessEvent {
    OUTPUT = 'output',
    EXIT = 'exit',
    ERROR = 'error',
    SPAWN_CHILD = 'spawn_child',
}
