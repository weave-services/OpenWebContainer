import { getQuickJS, JSModuleLoadResult, QuickJSContext } from "quickjs-emscripten";
import { Process, ShellProcess, JavaScriptProcess } from "./process";
import { VirtualFileSystem } from "./filesystem/virtual-fs";
import { IFileSystem } from "./interfaces";
import { ProcessManager } from "./process/manager";

/**
 * Main OpenWebContainer class
 */
export class OpenWebContainer {
    private fileSystem: IFileSystem;
    private processManager: ProcessManager;

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

        this.processManager.addProcess(process);
        process.start().catch((error:any) => {
            console.error(`Process ${process.pid} failed:`, error);
        });

        return process;
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
