import { ChildProcessPayload, ChildProcessResult, Process, ProcessEvent, ProcessExecutor, ProcessInfo, ProcessRegistry, ProcessTree, SpawnChildEventData } from "./process";
import { VirtualFileSystem } from "./filesystem/virtual-fs";
import { ProcessManager } from "./process/manager";
import { NodeProcessExecutor } from "./process/executors/node";
import { ShellProcessExecutor } from "./process/executors/shell";
import { IFileSystem } from "./filesystem";


interface ProcessEventData {
    stdout?: string;
    stderr?: string;
    error?: Error;
    pid?: number;
    exitCode?: number;
}

/**
 * Main OpenWebContainer class
 */
export class OpenWebContainer {
    private fileSystem: IFileSystem;
    private processManager: ProcessManager;
    private processRegistry: ProcessRegistry;
    private outputCallbacks: ((output: string) => void)[] = [];

    constructor() {
        this.fileSystem = new VirtualFileSystem();
        this.processManager = new ProcessManager();
        this.processRegistry = new ProcessRegistry();
        

        // Register default process executors
        this.processRegistry.registerExecutor(
            'javascript',
            new NodeProcessExecutor(this.fileSystem)
        );
        this.processRegistry.registerExecutor(
            'shell',
            new ShellProcessExecutor(this.fileSystem)
        );
    }

    /**
     * File system operations
     */
    writeFile(path: string, content: string): void {
        this.fileSystem.writeFile(path, content);
    }

    readFile(path: string): string | undefined {
        return this.fileSystem.readFile(path);
    }

    deleteFile(path: string): void {
        this.fileSystem.deleteFile(path);
    }

    listFiles(): string[] {
        return this.fileSystem.listFiles();
    }

    createDirectory(path: string): void {
        this.fileSystem.createDirectory(path);
    }

    deleteDirectory(path: string): void {
        this.fileSystem.deleteDirectory(path);
    }

    listDirectory(path: string): string[] {
        return this.fileSystem.listDirectory(path);
    }

    /**
     * Process operations
     */
    async spawn(executablePath: string, args: string[] = [], parentPid?: number): Promise<Process> {
        const executor = this.processRegistry.findExecutor(executablePath);
        if (!executor) {
            throw new Error(`No executor found for: ${executablePath}`);
        }

        const pid = this.processManager.getNextPid();
        const process = await executor.execute({
            executable: executablePath,
            args,
            cwd: '/',
            env: {}
        }, pid, parentPid);

        // Set up general process handlers
        this.setupProcessEventHandlers(process);

        // Set up child process spawning for all processes
        this.setupChildProcessSpawning(process);

        // Add process to manager and start it
        this.processManager.addProcess(process);
        process.start().catch(console.error);
        
        return process;
    }
    
    private setupProcessEventHandlers(process: Process): void {
        process.addEventListener(ProcessEvent.MESSAGE, (data: ProcessEventData) => {
            if (data.stdout) {
                this.notifyOutput(data.stdout);
            }
            if (data.stderr) {
                this.notifyOutput(data.stderr);
            }
        });

        process.addEventListener(ProcessEvent.ERROR, (data: ProcessEventData) => {
            if (data.error) {
                this.notifyOutput(`Error: ${data.error.message}\n`);
            }
        });

        process.addEventListener(ProcessEvent.EXIT, (data) => {
            if (data.exitCode) {
                this.notifyOutput(`Process exited with code: ${data.exitCode}\n`);
            }
        });
        
    }
    registerProcessExecutor(type: string, executor: ProcessExecutor): void {
        this.processRegistry.registerExecutor(type, executor);
    }
    
    /**
     * Register an output callback
     */
    onOutput(callback: (output: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter(cb => cb !== callback);
        };
    }

    private notifyOutput(output: string): void {
        this.outputCallbacks.forEach(callback => callback(output));
    }

    getProcess(pid: number): Process | undefined {
        return this.processManager.getProcess(pid);
    }

    listProcesses(): Process[] {
        return this.processManager.listProcesses();
    }

    /**
     * Get information about a process
     */
    getProcessInfo(process: Process): ProcessInfo {
        const stats = process.getStats();
        return {
            pid: stats.pid,
            ppid: stats.ppid,
            type: stats.type,
            state: stats.state,
            executablePath: stats.executablePath,
            args: stats.args,
            startTime: stats.startTime,
            endTime: stats.endTime,
            uptime: process.uptime ?? undefined
        };
    }
    // Add method to get child processes
    getChildProcesses(parentPid: number): Process[] {
        return this.processManager.listProcesses()
            .filter(process => process.parentPid === parentPid);
    }

    /**
     * Get process tree for a given process
     */
    getProcessTree(pid: number): ProcessTree {
        const process = this.processManager.getProcess(pid);
        if (!process) {
            throw new Error(`Process ${pid} not found`);
        }

        return {
            info: this.getProcessInfo(process),
            children: this.getChildProcesses(pid)
                .map(child => this.getProcessTree(child.pid))
        };
    }

    /**
     * Get full process tree starting from init process
     */
    getFullProcessTree(): ProcessTree[] {
        // Get all top-level processes (those without parent)
        const topLevelProcesses = this.processManager.listProcesses()
            .filter(process => !process.parentPid);

        return topLevelProcesses.map(process => this.getProcessTree(process.pid));
    }

    /**
     * Print process tree (useful for debugging)
     */
    printProcessTree(tree: ProcessTree, indent: string = ''): string {
        const { info } = tree;
        let output = `${indent}${info.pid} ${info.executablePath} (${info.state})`;

        if (info.uptime !== undefined) {
            output += ` - uptime: ${info.uptime}ms`;
        }
        output += '\n';

        for (const child of tree.children) {
            output += this.printProcessTree(child, indent + '  ');
        }

        return output;
    }
    /**
     * Terminate a process and all its children
     */
    async terminateProcessTree(pid: number): Promise<void> {
        const children = this.getChildProcesses(pid);

        // First terminate all children
        await Promise.all(
            children.map(child => this.terminateProcessTree(child.pid))
        );

        // Then terminate the process itself
        const process = this.processManager.getProcess(pid);
        if (process) {
            await process.terminate();
            this.processManager.removeProcess(pid);
        }
    }

    private setupChildProcessSpawning(process: Process): void {
        process.addEventListener(ProcessEvent.SPAWN_CHILD, (data: SpawnChildEventData) => {
            this.spawnChildProcess(process.pid, data.payload, data.callback);
        });
    }
    
    private async spawnChildProcess(
        parentPid: number,
        payload: ChildProcessPayload,
        callback: (result: ChildProcessResult) => void
    ): Promise<void> {
        try {
            const parentProcess = this.processManager.getProcess(parentPid);
            if (!parentProcess) {
                throw new Error(`Parent process ${parentPid} not found`);
            }

            // Create output buffers
            let stdout = '';
            let stderr = '';

            // Spawn the child process
            const childProcess = await this.spawn(
                payload.executable,
                payload.args,
                parentPid  // Pass parent PID
            );

            // Set up event handlers for the child process
            childProcess.addEventListener(ProcessEvent.MESSAGE, (data: ProcessEventData) => {
                if (data.stdout) {
                    stdout += data.stdout;
                    // Forward to parent process
                    parentProcess.emit(ProcessEvent.MESSAGE, { stdout: data.stdout });
                }
                if (data.stderr) {
                    stderr += data.stderr;
                    // Forward to parent process
                    parentProcess.emit(ProcessEvent.MESSAGE, { stderr: data.stderr });
                }
            });

            childProcess.addEventListener(ProcessEvent.ERROR, (data: ProcessEventData) => {
                if (data.error) {
                    stderr += `${data.error.message}\n`;
                    parentProcess.emit(ProcessEvent.MESSAGE, { stderr: data.error.message + '\n' });
                }
            });

            childProcess.addEventListener(ProcessEvent.EXIT, (data) => {
                callback({
                    stdout,
                    stderr,
                    exitCode: data.exitCode ?? 1
                });

                // Clean up the process
                this.processManager.removeProcess(childProcess.pid);
            });

        } catch (error: any) {
            callback({
                stdout: '',
                stderr: error.message,
                exitCode: 1
            });
        }
    }


    /**
     * Cleanup
     */
    async dispose(): Promise<void> {
        await this.processManager.killAll();
    }
}
