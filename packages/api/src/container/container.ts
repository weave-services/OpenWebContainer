import { WorkerBridge } from '../worker/bridge';
import { VirtualProcess } from '../process/process';
import { ContainerOptions, ContainerStats } from './types';
import { ProcessOptions } from '../process/types';
import { ProcessEvent } from '../process/types';

export class ContainerManager {
    private worker: WorkerBridge;
    private processes: Map<number, VirtualProcess>;
    private options: ContainerOptions;
    private ready: Promise<void>;
    private _isReady: boolean = false;
    private _disposed: boolean = false;

    constructor(options: ContainerOptions = {}) {
        this.options = {
            debug: false,
            maxProcesses: 10,
            memoryLimit: 512 * 1024 * 1024, // 512MB
            ...options
        };

        this.processes = new Map();
        this.worker = new WorkerBridge();
        this.ready = this.initialize();
    }

    waitForReady(): Promise<void> {
        return this.ready;
    }

    private async initialize(): Promise<void> {
        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            // Initialize worker with options
            await this.worker.initialize({
                debug: this.options.debug,
                memoryLimit: this.options.memoryLimit
            });

            // Set up worker message handlers
            this.worker.onMessage(this.handleWorkerMessage.bind(this));

            this._isReady = true;
        } catch (error) {
            this._disposed = true;
            throw error;
        }
    }

    private handleWorkerMessage(message: any): void {
        switch (message.type) {
            case 'processOutput':
                const process = this.processes.get(message.payload.pid);
                if (process) {
                    process.emit(ProcessEvent.OUTPUT, {
                        output: message.payload.output,
                        isError: message.payload.isError
                    });
                }
                break;

            case 'processExit':
                const exitingProcess = this.processes.get(message.payload.pid);
                if (exitingProcess) {
                    exitingProcess.emit(ProcessEvent.EXIT, {
                        exitCode: message.payload.exitCode
                    });
                    this.processes.delete(message.payload.pid);
                }
                break;

            case 'processError':
                const errorProcess = this.processes.get(message.payload.pid);
                if (errorProcess) {
                    errorProcess.emit(ProcessEvent.ERROR, {
                        error: new Error(message.payload.error)
                    });
                }
                break;

            case 'containerStats':
                // Handle container stats updates
                break;

            case 'containerError':
                // Handle container-level errors
                if (this.options.debug) {
                    console.error('Container error:', message.payload.error);
                }
                break;
        }
    }

    /**
     * Spawn a new process in the container
     */
    async spawn(
        command: string,
        args: string[] = [],
        options: ProcessOptions = {}
    ): Promise<VirtualProcess> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        if (this.processes.size >= this.options.maxProcesses!) {
            throw new Error(`Maximum process limit (${this.options.maxProcesses}) reached`);
        }

        try {
            const response = await this.worker.sendMessage({
                type: 'spawn',
                payload: {
                    command,
                    args,
                    options: {
                        cwd: options.cwd || '/',
                        env: options.env || {},
                    }
                }
            });

            if (response.type !== 'spawned') {
                throw new Error('Invalid worker response');
            }

            const process = new VirtualProcess(
                response.payload.pid,
                command,
                args,
                this.worker
            )

            this.processes.set(process.pid, process);
            return process;

        } catch (error:any) {
            throw new Error(`Failed to spawn process: ${error.message}`);
        }
    }

    /**
     * Get a running process by PID
     */
    getProcess(pid: number): VirtualProcess | undefined {
        return this.processes.get(pid);
    }

    /**
     * List all running processes
     */
    listProcesses(): VirtualProcess[] {
        return Array.from(this.processes.values());
    }

    /**
     * Get container statistics
     */
    async getStats(): Promise<ContainerStats> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        const response = await this.worker.sendMessage({
            type: 'getStats'
        });

        return response.payload;
    }

    /**
     * Kill all processes and clean up resources
     */
    async dispose(): Promise<void> {
        if (this._disposed) return;

        // Mark as disposed immediately to prevent new operations
        this._disposed = true;

        try {
            // Wait for container to be ready before disposing
            await this.ready;

            // Kill all processes
            const killPromises = Array.from(this.processes.values()).map(
                process => process.kill()
            );
            await Promise.all(killPromises);

            // Clear process map
            this.processes.clear();

            // Dispose worker
            await this.worker.dispose();

        } catch (error) {
            // Log error but don't throw, as we're disposing
            if (this.options.debug) {
                console.error('Error during container disposal:', error);
            }
        }
    }

    /**
     * Write a file to the container's filesystem
     */
    async writeFile(path: string, content: string): Promise<void> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        await this.worker.sendMessage({
            type: 'writeFile',
            payload: { path, content }
        });
    }

    /**
     * Read a file from the container's filesystem
     */
    async readFile(path: string): Promise<string> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        const response = await this.worker.sendMessage({
            type: 'readFile',
            payload: { path }
        });

        return response.payload.content;
    }
    async deleteFile(path: string, recursive?: boolean): Promise<void> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            await this.worker.sendMessage({
                type: 'deleteFile',
                payload: { path, recursive }
            });
        } catch (error:any) {
            throw new Error(`Failed to delete file: ${error.message}`);
        }
    }

    async listFiles(path?: string): Promise<string[]> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            const result = await this.worker.sendMessage({
                type: 'listFiles',
                payload: { path }
            });
            return result.files;
        } catch (error:any) {
            throw new Error(`Failed to list files: ${error.message}`);
        }
    }

    async createDirectory(path: string): Promise<void> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            await this.worker.sendMessage({
                type: 'createDirectory',
                payload: { path }
            });
        } catch (error:any) {
            throw new Error(`Failed to create directory: ${error.message}`);
        }
    }

    async listDirectory(path: string): Promise<string[]> {
        await this.ready;

        if (this._disposed) {
            throw new Error('Container has been disposed');
        }

        try {
            const result = await this.worker.sendMessage({
                type: 'listDirectory',
                payload: { path }
            });
            return result.entries;
        } catch (error:any) {
            throw new Error(`Failed to list directory: ${error.message}`);
        }
    }

    /**
     * Check if the container is ready
     */
    get isReady(): boolean {
        return this._isReady;
    }

    /**
     * Check if the container has been disposed
     */
    get isDisposed(): boolean {
        return this._disposed;
    }

    /**
     * Get the current process count
     */
    get processCount(): number {
        return this.processes.size;
    }

    /**
     * Get container options
     */
    get containerOptions(): Readonly<ContainerOptions> {
        return { ...this.options };
    }
}