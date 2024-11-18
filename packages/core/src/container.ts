import { getQuickJS, JSModuleLoadResult, QuickJSContext } from "quickjs-emscripten";
import { Process, ShellProcess, JavaScriptProcess } from "./process";
import { VirtualFileSystem } from "./filesystem/virtual-fs";
import { IFileSystem, ProcessEvent } from "./interfaces";
import { ProcessManager } from "./process/manager";


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
    private outputCallbacks: ((output: string) => void)[] = [];
    private currentProcess: Process | null = null;

    constructor() {
        this.fileSystem = new VirtualFileSystem();
        this.processManager = new ProcessManager();
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
    async spawn(executablePath: string, args: string[] = []): Promise<Process> {
        const pid = this.processManager.getNextPid();
        let process: Process;

        if (executablePath === 'sh') {
            // Create a shell process
            process = new ShellProcess(pid, executablePath, args, this.fileSystem);
        } else if (executablePath.endsWith('.js')) {
            // Create a JavaScript process
            const QuickJS = await getQuickJS();
            const runtime = QuickJS.newRuntime();
            const context = runtime.newContext();

            // Set up module loader
            runtime.setModuleLoader((moduleName: string, context: QuickJSContext): JSModuleLoadResult => {
                try {
                    // Get the current module's base path from the context if available
                    let baseModule: string | undefined;
                    const currentModule = context.getProp(context.global, 'import.meta');
                    if (currentModule) {
                        try {
                            const importMeta = context.getProp(currentModule, 'url');
                            baseModule = context.getString(importMeta);
                            importMeta.dispose();
                        } finally {
                            currentModule.dispose();
                        }
                    }

                    // Resolve the module path
                    const resolvedPath = this.fileSystem.resolveModulePath(moduleName, baseModule);

                    // Load the module content
                    const content = this.fileSystem.readFile(resolvedPath);
                    if (content === undefined) {
                        return {
                            error: new Error(`Module not found: ${moduleName}`),
                        };
                    }

                    // Return successful module load result
                    return {
                        value: content,
                    };
                    

                } catch (error: any) {
                    // Return error result
                    return {
                        error: new Error(`Failed to load module ${moduleName}: ${error.message}`),
                    };
                }
            }, (baseModuleName: string, requestedName: string, context: QuickJSContext): string => {
                try {
                    return this.fileSystem.resolveModulePath(requestedName, baseModuleName);
                } catch (error: any) {
                    throw new Error(`Failed to resolve module ${requestedName} from ${baseModuleName}: ${error.message}`);
                }
            });

            process = new JavaScriptProcess(pid, executablePath, args, runtime, context);
        } else {
            throw new Error(`Unsupported executable type: ${executablePath}`);
        }

        // Set up process event handlers
        this.setupProcessEventHandlers(process);

        // Add process to manager
        this.processManager.addProcess(process);
        this.currentProcess = process;

        // Start the process
        process.start().catch((error) => {
            console.error(`Process ${process.pid} failed:`, error);
        });

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

        process.addEventListener(ProcessEvent.EXIT, (data: ProcessEventData) => {
            if (data.exitCode) {
                this.notifyOutput(`Process exited with code: ${data.exitCode}\n`);
            }
            if (this.currentProcess === process) {
                this.currentProcess = null;
            }
        });
    }

    /**
     * Send input to the current process
     */
    async sendInput(input: string): Promise<void> {
        if (!this.currentProcess) {
            throw new Error('No active process to receive input');
        }

        try {
            this.currentProcess.writeInput(input);
        } catch (error: any) {
            console.error('Failed to send input:', error);
            throw error;
        }
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
     * Cleanup
     */
    async dispose(): Promise<void> {
        await this.processManager.killAll();
    }
}
