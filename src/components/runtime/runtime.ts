// runtime.ts

import {
    InMemory,
    MountConfiguration,
    Backend
} from '@zenfs/core';
import { IndexedDB, WebStorage } from '@zenfs/dom';
import { Logger } from './services/logger';
import { SandboxManager } from './services/sandbox-manager';
import { ModuleManager } from './services/module-manager';
import { ProcessManager } from './services/process-manager';
import { FileSystemManager } from './services/fs-manager';
import { pathUtils } from './utils/path-utils';
import { FileSystemSnapshot, FSSnapshot } from './services/fs-snapshot';
import pako from 'pako';
import { NpmTarballLoader } from './utils/npm-loader';
import { PnpmTarballLoader } from './utils/pnpm-loader';

export interface RuntimeOptions {
    enableFileSystem?: boolean;
    enableNetworking?: boolean;
    debug?: boolean;
    debugSandbox?: boolean;
    initialFiles?: { [key: string]: string };
    mounts?: {
        [path: string]: MountConfiguration<Backend>;
    };
}

export class BrowserNodeRuntime {
    private static readonly SNAPSHOT_KEY = 'browser-node-fs-snapshot';

    private snapshotManager: FileSystemSnapshot;
    private logger: Logger;
    private sandboxManager: SandboxManager;
    private moduleManager: ModuleManager;
    private processManager: ProcessManager;
    private fsManager: FileSystemManager;
    private options: Required<RuntimeOptions>;
    private initialized: boolean = false;

    constructor(options: RuntimeOptions = {}) {
        // Initialize options with defaults
        this.options = {
            enableFileSystem: true,
            enableNetworking: true,
            debug: false,
            debugSandbox: false,
            initialFiles: {},
            mounts: {},
            ...options
        };
        // Initialize core services
        this.logger = new Logger(this.options.debug, this.options.debugSandbox);
        this.logger.log('Initializing BrowserNodeRuntime');

        // Initialize managers
        this.sandboxManager = new SandboxManager(this.logger);
        this.processManager = new ProcessManager(this.logger);
        this.fsManager = new FileSystemManager(this.logger);

        // Initialize ModuleManager with dependencies
        this.moduleManager = new ModuleManager(
            this.logger,
            this.sandboxManager,
            {
                process: this.processManager,
                require: this.require.bind(this)
            }
        );

        this.snapshotManager = new FileSystemSnapshot(this.fsManager, this.logger);
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        this.logger.log('Starting runtime initialization');

        try {
            // Set up default mounts
            const defaultMounts: { [path: string]: MountConfiguration<Backend> } = {
                '/': InMemory,
                '/tmp': InMemory,
                '/home': InMemory,
                ...this.options.mounts
            };

            // Initialize file system
            await this.fsManager.initialize(defaultMounts);
            this.logger.log('File system initialized');

            // Set up initial files if provided
            if (Object.keys(this.options.initialFiles).length > 0) {
                await this.setupInitialFiles();
            }

            // Initialize sandbox
            await this.sandboxManager.initialize();
            this.logger.log('Sandbox initialized');

            const snapshot = await this.loadStoredSnapshot();
            if (snapshot) {
                await this.snapshotManager.loadSnapshot(snapshot);
                this.initialized = true;
                return;
            }
            // Install npm
            await this.ensureNpmInstalled();

            // Create and store snapshot
            const newSnapshot = await this.snapshotManager.createSnapshot();
            await this.storeSnapshot(newSnapshot);

            this.initialized = true;
            this.logger.log('Runtime initialization completed');
        } catch (error) {
            this.logger.log('Runtime initialization failed', error);
            throw new Error(`Runtime initialization failed: ${error}`);
        }
    }

    private async setupInitialFiles(): Promise<void> {
        for (const [path, content] of Object.entries(this.options.initialFiles)) {
            const dir = pathUtils.dirname(path);
            try {
                await this.fsManager.mkdir(dir, { recursive: true });
                await this.fsManager.writeFile(path, content);
                this.logger.log(`Created initial file: ${path}`);
            } catch (error) {
                this.logger.log(`Failed to create initial file: ${path}`, error);
                throw error;
            }
        }
    }

    public async require(modulePath: string, parentPath?: string): Promise<any> {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            return await this.moduleManager.require(modulePath, parentPath);
        } catch (error) {
            this.logger.log(`Failed to require module: ${modulePath}`, error);
            throw error;
        }
    }

    public async runScript(scriptPath: string, args: string[] = []): Promise<any> {
        if (!this.initialized) {
            await this.initialize();
        }

        this.logger.log(`Running script: ${scriptPath}`, { args });

        // Save original process state
        const originalArgv = this.processManager.argv;
        const originalPwd = this.processManager.cwd();

        try {
            // Update process state for this script
            this.processManager.argv = ['node', scriptPath, ...args];
            this.processManager.chdir(pathUtils.dirname(scriptPath));

            // Check if script exists
            if (!await this.fsManager.exists(scriptPath)) {
                throw new Error(`Script not found: ${scriptPath}`);
            }

            // Read script content
            const scriptContent = (await this.fsManager.readFile(scriptPath, { encoding: 'utf8' })).toString();

            // Create module context
            const moduleContext = {
                exports: {},
                require: (path: string) => this.require(path, scriptPath),
                module: { exports: {} },
                __filename: scriptPath,
                __dirname: pathUtils.dirname(scriptPath),
                // Use processManager directly
                process: this.processManager,
                Buffer: {
                    from: (data: any) => new Uint8Array(data),
                    alloc: (size: number) => new Uint8Array(size),
                    isBuffer: (obj: any) => obj instanceof Uint8Array,
                },
                console: console,
                setTimeout,
                clearTimeout,
                setInterval,
                clearInterval,
                setImmediate: (fn: Function) => setTimeout(fn, 0),
                clearImmediate: (id: number) => clearTimeout(id),
            };

            // Execute the script
            const result = await this.sandboxManager.executeInSandbox(
                this.wrapScript(scriptContent),
                moduleContext
            );

            return result;

        } catch (error) {
            this.logger.log(`Script execution failed: ${scriptPath}`, error);
            throw error;
        } finally {
            // Restore original process state
            this.processManager.argv = originalArgv;
            this.processManager.chdir(originalPwd);
        }
    }

    private wrapScript(scriptContent: string): string {
        return `
            (function(exports, require, module, __filename, __dirname, process, Buffer, console) {
                ${scriptContent}
                return module.exports;
            })
        `;
    }

    public async runNpm(args: string[] = []): Promise<any> {
        const NPM_CLI_PATH = '/usr/local/lib/npm-cli.js';

        if (!await this.fsManager.exists(NPM_CLI_PATH)) {
            await this.setupNpm();
        }

        return this.runScript(NPM_CLI_PATH, args);
    }

    private async setupNpm(): Promise<void> {
        const NPM_CLI_PATH = '/usr/local/lib/npm-cli.js';
        const NPM_CLI_URL = 'https://unpkg.com/npm/bin/npm-cli.js';

        try {
            // Create necessary directories
            await this.fsManager.mkdir('/usr/local/lib', { recursive: true });
            await this.fsManager.mkdir('/usr/local/etc', { recursive: true });
            await this.fsManager.mkdir('/tmp/npm-cache', { recursive: true });

            // Fetch npm-cli.js
            const response = await fetch(NPM_CLI_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch npm-cli.js: ${response.status}`);
            }

            const npmCliContent = await response.text();
            await this.fsManager.writeFile(NPM_CLI_PATH, npmCliContent);

            // Create basic npmrc file
            const npmrcContent = `
                registry=https://registry.npmjs.org/
                cache=/tmp/npm-cache
                prefix=/usr/local
                strict-ssl=false
            `.trim().split('\n').map(line => line.trim()).join('\n');

            await this.fsManager.writeFile('/usr/local/etc/npmrc', npmrcContent);

            this.logger.log('npm setup completed');
        } catch (error) {
            this.logger.log('npm setup failed', error);
            throw error;
        }
    }

    // Public API methods for accessing managers
    public getFS(): FileSystemManager {
        return this.fsManager;
    }

    public getProcess(): ProcessManager {
        return this.processManager;
    }

    public getLogger(): Logger {
        return this.logger;
    }

    public isInitialized(): boolean {
        return this.initialized;
    }

    public getLogs(): string[] {
        return this.logger.getLogs();
    }

    public clearLogs(): void {
        this.logger.clearLogs();
    }

    // Cleanup
    public async dispose(): Promise<void> {
        this.logger.log('Disposing runtime');

        try {
            // Cleanup all managers
            this.sandboxManager.dispose();
            await this.fsManager.cleanup();

            this.initialized = false;
            this.logger.log('Runtime disposed successfully');
        } catch (error) {
            this.logger.log('Error during runtime disposal', error);
            throw error;
        }
    }

    // File System Snapshots
    private async loadStoredSnapshot(): Promise<FSSnapshot | null> {
        try {
            const stored = localStorage.getItem(BrowserNodeRuntime.SNAPSHOT_KEY);
            if (!stored) return null;

            const blob = await fetch(stored).then(r => r.blob());
            const arrayBuffer = await blob.arrayBuffer();
            const compressed = new Uint8Array(arrayBuffer);
            const decompressed = pako.ungzip(compressed, { to: 'string' });
            return JSON.parse(decompressed);
        } catch (error) {
            this.logger.log('Failed to load snapshot', error);
            return null;
        }
    }

    private async storeSnapshot(snapshot: FSSnapshot): Promise<void> {
        const blob = await this.snapshotManager.saveSnapshotToFile(snapshot);
        const url = URL.createObjectURL(blob);
        localStorage.setItem(BrowserNodeRuntime.SNAPSHOT_KEY, url);
    }

    private async ensureNpmInstalled(): Promise<void> {
        const NPM_PATH = '/usr/local/bin/npm';
        if (!await this.fsManager.exists(NPM_PATH)) {
            const loader = new PnpmTarballLoader(this.fsManager, this.logger);
            await loader.loadFromTarball();
        }
    }

    // Add method to manually create and download a snapshot
    public async createAndDownloadSnapshot(filename: string = 'fs-snapshot.gz'): Promise<void> {
        const snapshot = await this.snapshotManager.createSnapshot();
        this.snapshotManager.downloadSnapshot(snapshot, filename);
    }

    // Add method to load a snapshot from a file
    public async loadSnapshotFromFile(file: File): Promise<void> {
        await this.snapshotManager.loadSnapshotFromBlob(file);
        this.initialized = true;
    }
}

export default BrowserNodeRuntime;