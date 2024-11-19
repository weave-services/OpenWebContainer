import { WorkerBridge } from "../worker/bridge";
import { ContainerManager } from "../container/";
import { BrowserEventEmitter,  } from "./events";
import { ProcessStats, ProcessEvent, ProcessEventMap } from "./types";

export class VirtualProcess extends BrowserEventEmitter {
    readonly pid: number;
    readonly command: string;
    readonly args: string[];

    private worker: WorkerBridge;
    private _exitCode: number | null = null;
    private _startTime: Date;
    private _endTime?: Date;
    private _isRunning: boolean = true;

    constructor(
        pid: number,
        command: string,
        args: string[],
        worker: WorkerBridge
    ) {
        super();
        this.pid = pid;
        this.command = command;
        this.args = args;
        this.worker = worker;
        this._startTime = new Date();

        // Set max listeners to avoid memory leaks
        this.setMaxListeners(100);
    }

    /**
     * Write input to the process
     */
    async write(input: string): Promise<void> {
        if (!this._isRunning) {
            throw new Error('Process is not running');
        }

        await this.worker.sendMessage({
            type: 'writeInput',
            payload: {
                pid: this.pid,
                input
            }
        });
    }

    /**
     * Kill the process
     */
    async kill(): Promise<void> {
        if (!this._isRunning) return;

        await this.worker.sendMessage({
            type: 'terminate',
            payload: {
                pid: this.pid
            }
        });

        this._isRunning = false;
        this._endTime = new Date();
        this._exitCode = -1;
        this.emit(ProcessEvent.EXIT, { exitCode: this._exitCode });
    }

    /**
     * Get process statistics
     */
    getStats(): ProcessStats {
        return {
            pid: this.pid,
            command: this.command,
            args: this.args,
            status: this._isRunning ? 'running' : 'exited',
            exitCode: this._exitCode,
            startTime: this._startTime,
            endTime: this._endTime,
            uptime: this._endTime ?
                this._endTime.getTime() - this._startTime.getTime() :
                Date.now() - this._startTime.getTime()
        };
    }

    /**
     * Type-safe event emitter methods
     */
    on<K extends keyof ProcessEventMap>(
        event: K,
        listener: (data: ProcessEventMap[K]) => void
    ): this {
        return super.on(event, listener);
    }

    once<K extends keyof ProcessEventMap>(
        event: K,
        listener: (data: ProcessEventMap[K]) => void
    ): this {
        return super.once(event, listener);
    }

    off<K extends keyof ProcessEventMap>(
        event: K,
        listener: (data: ProcessEventMap[K]) => void
    ): this {
        return super.off(event, listener);
    }

    emit<K extends keyof ProcessEventMap>(
        event: K,
        data: ProcessEventMap[K]
    ): boolean {
        return super.emit(event, data);
    }

    /**
     * Getters for process state
     */
    get isRunning(): boolean {
        return this._isRunning;
    }

    get exitCode(): number | null {
        return this._exitCode;
    }

    get startTime(): Date {
        return this._startTime;
    }

    get endTime(): Date | undefined {
        return this._endTime;
    }

    get uptime(): number {
        return this._endTime ?
            this._endTime.getTime() - this._startTime.getTime() :
            Date.now() - this._startTime.getTime();
    }
}