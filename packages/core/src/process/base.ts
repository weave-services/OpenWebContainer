import { ProcessEvent, ProcessState, ProcessType } from "../interfaces";

/**
 * Base Process class
 */
export abstract class Process {
    readonly pid: number;
    readonly type: ProcessType;
    protected _state: ProcessState;
    protected _exitCode: number | null;
    readonly executablePath: string;
    readonly args: string[];

    private eventListeners: Map<ProcessEvent, Set<(data: any) => void>>;
    private inputBuffer: string[] = [];
    private inputCallbacks: ((input: string) => void)[] = [];

    constructor(
        pid: number,
        type: ProcessType,
        executablePath: string,
        args: string[] = []
    ) {
        this.pid = pid;
        this.type = type;
        this._state = ProcessState.CREATED;
        this._exitCode = null;
        this.executablePath = executablePath;
        this.args = args;
        this.eventListeners = new Map();

        Object.values(ProcessEvent).forEach((event) => {
            this.eventListeners.set(event, new Set());
        });
    }

    get state(): ProcessState {
        return this._state;
    }

    get exitCode(): number | null {
        return this._exitCode;
    }

    protected emit(event: ProcessEvent, data: any): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }
    }

    addEventListener(event: ProcessEvent, listener: (data: any) => void): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.add(listener);
        }
    }

    removeEventListener(event: ProcessEvent, listener: (data: any) => void): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(listener);
        }
    }

    /**
     * Write input to the process
     */
    writeInput(input: string): void {
        if (this._state !== ProcessState.RUNNING) {
            throw new Error('Cannot write input to non-running process');
        }

        this.inputBuffer.push(input);
        this.processNextInput();
    }

    /**
     * Read input asynchronously
     */
    protected async readInput(): Promise<string> {
        // If there's input in the buffer, return it immediately
        if (this.inputBuffer.length > 0) {
            return this.inputBuffer.shift()!;
        }

        // Otherwise, wait for input
        return new Promise((resolve) => {
            this.inputCallbacks.push(resolve);
        });
    }

    private processNextInput(): void {
        if (this.inputCallbacks.length > 0 && this.inputBuffer.length > 0) {
            const callback = this.inputCallbacks.shift()!;
            const input = this.inputBuffer.shift()!;
            callback(input);
        }
    }

    abstract start(): Promise<void>;
    abstract terminate(): Promise<void>;
}