import {
    fs,
    configure,
    InMemory,
    MountConfiguration,
    Backend
} from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';

// Path utilities
const pathUtils = {
    dirname(path: string): string {
        if (path === '/') return '/';
        const parts = path.split('/');
        parts.pop();
        return parts.join('/') || '/';
    },

    resolve(...paths: string[]): string {
        const segments: string[] = [];

        paths.forEach(path => {
            if (path.startsWith('/')) {
                segments.length = 0;
            }

            const parts = path.split('/').filter(p => p && p !== '.');

            parts.forEach(part => {
                if (part === '..') {
                    segments.pop();
                } else {
                    segments.push(part);
                }
            });
        });

        return '/' + segments.join('/');
    },

    normalize(path: string): string {
        return pathUtils.resolve(path);
    },

    join(...paths: string[]): string {
        return paths.join('/').replace(/\/+/g, '/');
    }
};

// Add this interface to define the sandbox window type
interface SandboxWindow extends Window {
    Function: FunctionConstructor;
    secureFunction?: FunctionConstructor;
    secureEval?: (code: string) => any;
}

// Interfaces
interface RuntimeOptions {
    enableFileSystem?: boolean;
    enableNetworking?: boolean;
    debug?: boolean;
    debugSandbox?: boolean; // New option for sandbox-specific debugging
    initialFiles?: { [key: string]: string };
    mounts?: {
        [path: string]: MountConfiguration<Backend>;
    };
}

interface Process {
    env: { [key: string]: string | undefined };
    argv: string[];
    pid: number;
    platform: string;
    version: string;
    nextTick(callback: (...args: any[]) => void): void;
}

interface Module {
    exports: any;
    require: (path: string) => any;
    id: string;
    filename: string;
    loaded: boolean;
    paths: string[];
}

class BrowserNodeRuntime {
    private process: Process;
    private modules: Map<string, Module>;
    private options: Required<RuntimeOptions>;
    private sandbox: HTMLIFrameElement | null = null;
    private sandboxInitialized: boolean = false;
    private debugLog: string[] = [];
    private builtinModules: Map<string, any>;


    constructor(options: RuntimeOptions = {}) {
        this.options = {
            enableFileSystem: true,
            enableNetworking: true,
            debug: false,
            debugSandbox: false,
            initialFiles: {},
            mounts: {},
            ...options
        };

        this.process = this._initializeProcess();
        this.modules = new Map();
        this.builtinModules = new Map();
        this._setupBuiltinModules();
    }
    private logDebug(message: string, data?: any) {
        if (this.options.debug || this.options.debugSandbox) {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] ${message}`;
            this.debugLog.push(logMessage);

            console.group('🏃 Runtime Debug');
            console.log(logMessage);
            if (data) {
                console.log('Data:', data);
            }
            console.groupEnd();
        }
    }
    private _setupBuiltinModules(): void {
        // Implement core path module functionality
        const path = {
            sep: '/',
            delimiter: ':',

            basename(path: string, ext?: string): string {
                if (typeof path !== 'string') return '';
                const parts = path.split('/').filter(Boolean);
                let basename = parts[parts.length - 1] || '';
                if (ext && basename.endsWith(ext)) {
                    basename = basename.slice(0, -ext.length);
                }
                return basename;
            },

            dirname(path: string): string {
                if (typeof path !== 'string') return '.';
                const parts = path.split('/').filter(Boolean);
                parts.pop();
                return parts.length ? '/' + parts.join('/') : '/';
            },

            extname(path: string): string {
                if (typeof path !== 'string') return '';
                const basename = this.basename(path);
                const dotIndex = basename.lastIndexOf('.');
                return dotIndex > 0 ? basename.slice(dotIndex) : '';
            },

            format(pathObject: any): string {
                if (!pathObject) return '';
                const { root = '', dir = '', base = '', name = '', ext = '' } = pathObject;

                if (base) return (dir ? `${dir}/${base}` : base);
                return (dir ? `${dir}/${name}${ext}` : `${name}${ext}`);
            },

            isAbsolute(path: string): boolean {
                return path.startsWith('/');
            },

            join(...paths: string[]): string {
                return paths.join('/').replace(/\/+/g, '/');
            },

            normalize(path: string): string {
                if (typeof path !== 'string') return '.';
                const parts = path.split('/').filter(Boolean);
                const normalized = [];

                for (const part of parts) {
                    if (part === '.') continue;
                    if (part === '..') {
                        normalized.pop();
                    } else {
                        normalized.push(part);
                    }
                }

                return '/' + normalized.join('/');
            },

            parse(path: string): any {
                const root = path.startsWith('/') ? '/' : '';
                const basename = this.basename(path);
                const ext = this.extname(basename);
                const name = basename.slice(0, -ext.length);
                const dir = this.dirname(path);

                return { root, dir, base: basename, ext, name };
            },

            relative(from: string, to: string): string {
                const fromParts = from.split('/').filter(Boolean);
                const toParts = to.split('/').filter(Boolean);

                while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
                    fromParts.shift();
                    toParts.shift();
                }

                const upCount = fromParts.length;
                const relativeParts = Array(upCount).fill('..').concat(toParts);

                return relativeParts.join('/');
            },

            resolve(...paths: string[]): string {
                let resolvedPath = '';

                for (let i = paths.length - 1; i >= 0; i--) {
                    const path = paths[i];
                    if (!path) continue;

                    resolvedPath = path + '/' + resolvedPath;
                    if (path.startsWith('/')) break;
                }

                return this.normalize(resolvedPath);
            }
        };

        this.builtinModules.set('path', path);
    }

    private _initializeProcess(): Process {
        return {
            env: {
                // Basic Node/npm environment
                NODE_ENV: 'production',
                NODE_PATH: '/node_modules',
                NODE_VERSION: '16.0.0',

                // npm specific configs
                npm_config_registry: 'https://registry.npmjs.org/',
                npm_config_cache: '/tmp/npm-cache',
                npm_config_prefix: '/usr/local',
                npm_config_globalconfig: '/usr/local/etc/npmrc',
                npm_config_userconfig: '/home/.npmrc',
                npm_config_metrics_registry: 'https://registry.npmjs.org/',
                npm_config_node_gyp: '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js',
                npm_config_global: 'false',
                npm_config_local_prefix: '/',
                npm_config_user_agent: 'npm/8.19.4 node/v16.20.2',

                // Path configuration
                PATH: '/usr/local/bin:/usr/bin:/bin:/node_modules/.bin',
                PWD: '/',
                HOME: '/home',
                TEMP: '/tmp',
                TMP: '/tmp',
                TMPDIR: '/tmp',

                // User info
                USER: 'browser',
                USERNAME: 'browser',
                LOGNAME: 'browser',

                // Shell configuration
                SHELL: '/bin/sh',

                // System info
                LANG: 'en_US.UTF-8',
                TERM: 'xterm-256color',

                // Package management
                npm_package_json: '/package.json',
                npm_config_init_module: '/home/.npm-init.js',
            },
            argv: ['node', 'script.js'],
            pid: Math.floor(Math.random() * 10000),
            platform: 'linux',
            version: '16.0.0',
            nextTick(callback: (...args: any[]) => void): void {
                Promise.resolve().then(callback);
            }
        };
    }

    public async initialize(): Promise<void> {
        const defaultMounts: { [path: string]: MountConfiguration<Backend> } = {
            '/': InMemory,
            '/tmp': InMemory,
            '/home': IndexedDB,
            ...this.options.mounts
        };

        await configure({
            mounts: defaultMounts,
            addDevices: true
        });

        await this._setupInitialFiles();

        if (this.options.debug) {
            console.log('Runtime initialized with mounts:', defaultMounts);
        }
    }

    private async _setupInitialFiles(): Promise<void> {
        try {
            // Create standard directories
            await fs.promises.mkdir('/usr/local/lib', { recursive: true });
            await fs.promises.mkdir('/usr/local/bin', { recursive: true });
            await fs.promises.mkdir('/node_modules', { recursive: true });
            await fs.promises.mkdir('/tmp', { recursive: true });
            await fs.promises.mkdir('/home', { recursive: true });

            // Write initial files
            for (const [path, content] of Object.entries(this.options.initialFiles)) {
                const dir = pathUtils.dirname(path);
                if (dir) {
                    await fs.promises.mkdir(dir, { recursive: true });
                }
                await fs.promises.writeFile(path, content);
            }
        } catch (error) {
            throw new Error(`Error setting up initial files: ${(error as Error).message}`);
        }
    }

    private async initializeSandbox(): Promise<void> {
        if (this.sandboxInitialized) {
            return;
        }

        this.logDebug('Starting sandbox initialization');

        this.sandbox = document.createElement('iframe');
        this.sandbox.style.display = 'none';
        this.sandbox.setAttribute('sandbox', 'allow-scripts allow-same-origin');

        // Add debug hooks to track sandbox state
        const debugScript = `
            window.onerror = function(msg, url, line, col, error) {
                window.parent.postMessage({
                    type: 'SANDBOX_ERROR',
                    payload: { msg, url, line, col, error: error?.toString() }
                }, '*');
                return false;
            };
            
            window.addEventListener('unhandledrejection', function(event) {
                window.parent.postMessage({
                    type: 'SANDBOX_UNHANDLED_REJECTION',
                    payload: event.reason?.toString()
                }, '*');
            });

            // Override console methods to relay them to parent
            const originalConsole = { ...console };
            Object.keys(originalConsole).forEach(method => {
                console[method] = (...args) => {
                    window.parent.postMessage({
                        type: 'SANDBOX_CONSOLE',
                        payload: {
                            method,
                            args: args.map(arg => 
                                arg instanceof Error ? arg.toString() : arg
                            )
                        }
                    }, '*');
                    originalConsole[method](...args);
                };
            });
        `;

        const secureContent = `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta http-equiv="Content-Security-Policy" 
                          content="default-src 'self' 'unsafe-eval' 'unsafe-inline'">
                </head>
                <body>
                    <script>${debugScript}</script>
                    <script>
                        window.secureEval = window.eval;
                        window.secureFunction = window.Function;
                        window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
                    </script>
                </body>
            </html>
        `;

        // Set up message listener for sandbox communications
        window.addEventListener('message', (event) => {
            if (event.source === this.sandbox?.contentWindow) {
                switch (event.data.type) {
                    case 'SANDBOX_READY':
                        this.logDebug('Sandbox reported ready state');
                        break;
                    case 'SANDBOX_ERROR':
                        this.logDebug('Sandbox error occurred', event.data.payload);
                        break;
                    case 'SANDBOX_UNHANDLED_REJECTION':
                        this.logDebug('Sandbox unhandled rejection', event.data.payload);
                        break;
                    case 'SANDBOX_CONSOLE':
                        const { method, args } = event.data.payload;
                        this.logDebug(`Sandbox console.${method}`, args);
                        break;
                }
            }
        });

        const iframeLoaded = new Promise<void>((resolve, reject) => {
            if (!this.sandbox) {
                reject(new Error('Sandbox creation failed'));
                return;
            }

            this.sandbox.onload = () => {
                try {
                    const doc = this.sandbox?.contentDocument;
                    if (doc) {
                        this.logDebug('Writing secure content to sandbox');
                        doc.open();
                        doc.write(secureContent);
                        doc.close();
                    }
                    resolve();
                } catch (error) {
                    this.logDebug('Error during sandbox content initialization', error);
                    reject(error);
                }
            };

            this.sandbox.onerror = (error) => {
                this.logDebug('Sandbox failed to load', error);
                reject(new Error('Sandbox failed to load'));
            };
        });

        document.body.appendChild(this.sandbox);
        this.logDebug('Sandbox iframe appended to document');

        try {
            await iframeLoaded;
            this.sandboxInitialized = true;
            this.logDebug('Sandbox initialization completed successfully');
        } catch (error) {
            this.logDebug('Sandbox initialization failed', error);
            throw new Error(`Failed to initialize sandbox: ${(error as Error).message}`);
        }
    }
    // Add method to retrieve debug logs
    public getDebugLogs(): string[] {
        return [...this.debugLog];
    }

    // Add method to clear debug logs
    public clearDebugLogs(): void {
        this.debugLog = [];
    }

    private _resolveModulePath(requestPath: string, parentPath?: string): string {
        // Check if it's a built-in module first
        if (this.builtinModules.has(requestPath)) {
            return requestPath;
        }

        if (requestPath.startsWith('/')) {
            return pathUtils.normalize(requestPath);
        }

        if (requestPath.startsWith('./') || requestPath.startsWith('../')) {
            const basePath = parentPath ? pathUtils.dirname(parentPath) : '/';
            return pathUtils.resolve(basePath, requestPath);
        }

        return pathUtils.resolve('/node_modules', requestPath);
    }

    public async require(modulePath: string, parentPath?: string): Promise<any> {
        // Check if it's a built-in module first
        if (this.builtinModules.has(modulePath)) {
            return this.builtinModules.get(modulePath);
        }
        const resolvedPath = this._resolveModulePath(modulePath, parentPath);
        const normalizedPath = pathUtils.normalize(resolvedPath);

        if (this.modules.has(normalizedPath)) {
            return this.modules.get(normalizedPath)!.exports;
        }

        if (this.options.debug) {
            this.logDebug(`Loading module: ${normalizedPath}`);
        }

        if (!fs.existsSync(normalizedPath)) {
            const jsPath = `${normalizedPath}.js`;
            if (fs.existsSync(jsPath)) {
                return this.require(jsPath, parentPath);
            }
            throw new Error(`Cannot find module '${modulePath}'`);
        }

        let moduleContent = fs.readFileSync(normalizedPath, 'utf8');
        moduleContent = this.cleanupScriptContent(moduleContent);

        const moduleObject: Module = {
            exports: {},
            require: (path: string) => this.require(path, normalizedPath),
            id: normalizedPath,
            filename: normalizedPath,
            loaded: false,
            paths: ['/node_modules']
        };

        try {
            this.logDebug(`Preparing to execute module: ${normalizedPath}`);

            const wrappedContent = `
            (function(module, exports, require, process, __filename, __dirname) {
                ${moduleContent}
                return module.exports;
            })
        `;

            // Create the context object with all necessary module variables
            const context = {
                module: moduleObject,
                exports: moduleObject.exports,
                require: moduleObject.require,
                process: this.process,
                __filename: normalizedPath,
                __dirname: pathUtils.dirname(normalizedPath)
            };

            // Execute the module code in the sandbox
            await this._executeInSandbox(wrappedContent, context);

            moduleObject.loaded = true;
            this.modules.set(normalizedPath, moduleObject);

            this.logDebug(`Successfully loaded module: ${normalizedPath}`);
            return moduleObject.exports;

        } catch (error) {
            this.logDebug(`Error executing module: ${normalizedPath}`, error);
            const errorMessage = `
            Error executing module ${normalizedPath}:
            ${(error as Error).message}
            Module content (first 500 chars):
            ${moduleContent.slice(0, 500)}...
        `;
            throw new Error(errorMessage);
        }
    }
    private async _executeInSandbox(code: string, context: any = {}): Promise<any> {
        if (!this.sandboxInitialized) {
            await this.initializeSandbox();
        }

        this.logDebug('Executing code in sandbox', {
            codePreview: code.slice(0, 100) + '...',
            contextKeys: Object.keys(context)
        });

        const sandboxWindow = this.sandbox?.contentWindow as SandboxWindow | null;
        if (!sandboxWindow) {
            throw new Error('Sandbox window not available');
        }

        try {
            const result = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error('Sandbox execution timed out (5000ms)'));
                }, 5000);

                try {
                    const SecureFunction = sandboxWindow.secureFunction || sandboxWindow.Function;

                    // Create a serializable process object
                    const serializableProcess = {
                        ...context.process,
                        // Replace nextTick with a string representation
                        nextTick: 'function nextTick(callback) { Promise.resolve().then(callback); }'
                    };

                    // Replace the process in context with our serializable version
                    const serializableContext = {
                        ...context,
                        process: serializableProcess
                    };

                    // Setup code that reconstructs the process object with proper nextTick
                    const setupCode = `
                        // Set up global context
                        if (typeof global === 'undefined') {
                            window.global = window;
                        }

                        // Reconstruct process object with proper nextTick
                        if (typeof process === 'object') {
                            process.nextTick = function(callback) {
                                Promise.resolve().then(callback);
                            };
                        }

                        // Set up global process
                        global.process = process;

                        // Main code
                        ${code}
                    `;

                    const fn = new SecureFunction(
                        ...Object.keys(serializableContext),
                        setupCode
                    );

                    const result = fn.call(sandboxWindow, ...Object.values(serializableContext));
                    clearTimeout(timeoutId);
                    resolve(result);
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });

            this.logDebug('Sandbox execution completed successfully', { result });
            return result;
        } catch (error) {
            this.logDebug('Sandbox execution failed', error);
            throw error;
        }
    }

    public async runScript(scriptPath: string, args: string[] = []): Promise<any> {
        if (!await this.exists(scriptPath)) {
            throw new Error(`Script not found: ${scriptPath}`);
        }

        // Save original argv and pwd
        const originalArgv = [...this.process.argv];
        const originalPwd = this.process.env.PWD;

        try {
            // Update process.argv with script and its arguments
            this.process.argv = ['node', scriptPath, ...args];
            this.process.env.PWD = pathUtils.dirname(scriptPath);

            this.logDebug('Running script:', {
                path: scriptPath,
                args: args,
                pwd: this.process.env.PWD,
                argv: this.process.argv
            });

            // Set up built-in modules that scripts might need
            this._setupCommonBuiltins();

            // Create a wrapper that returns a promise which resolves when the script completes
            const wrapperContent = `
                new Promise((resolve, reject) => {
                    try {
                        // Load the module
                        const scriptPath = '${scriptPath}';
                        console.log('Loading module from:', scriptPath);
                        
                        const moduleExports = require(scriptPath);
                        
                        // Track if the script has completed
                        let hasCompleted = false;
                        
                        // Create completion handler
                        const completeExecution = (result) => {
                            if (!hasCompleted) {
                                hasCompleted = true;
                                module.exports = result;
                                resolve(result);
                            }
                        };

                        // Create error handler
                        const handleError = (error) => {
                            if (!hasCompleted) {
                                hasCompleted = true;
                                reject(error);
                            }
                        };

                        // Set up process completion handlers
                        process.on('exit', (code) => {
                            if (code === 0) {
                                completeExecution(module.exports);
                            } else {
                                handleError(new Error(\`Process exited with code \${code}\`));
                            }
                        });

                        // Handle different module export patterns
                        let result = moduleExports;
                        

                        // Handle both Promise and non-Promise returns
                        if (result && typeof result.then === 'function') {
                            result
                                .then(completeExecution)
                                .catch(handleError);
                        } else {
                            // For synchronous results, wait a tick to allow any async operations to start
                            process.nextTick(() => {
                                if (!hasCompleted) {
                                    completeExecution(result);
                                }
                            });
                        }
                        
                    } catch (error) {
                        handleError(error);
                    }
                })
            `;

            const context = {
                module: { exports: {} },
                exports: {},
                require: (path: string) => this.require(path, scriptPath),
                process: {
                    ...this.process,
                    title: 'node',
                    stdout: {
                        columns: 80,
                        write: (data: string) => console.log(data),
                        isTTY: true
                    },
                    stderr: {
                        write: (data: string) => console.error(data),
                        isTTY: true
                    },
                    stdin: {
                        isTTY: true
                    },
                    nextTick: (fn: Function) => Promise.resolve().then(() => fn()),
                    exit: (code: number) => {
                        console.log(`Process exit called with code: ${code}`);
                        process.emit('exit', code);
                    },
                    platform: 'linux',
                    arch: 'x64',
                    version: 'v16.0.0',
                    versions: {
                        node: '16.0.0',
                        v8: '9.0.0'
                    },
                    cwd: () => this.process.env.PWD,
                    chdir: (dir: string) => {
                        this.process.env.PWD = dir;
                    },
                    // Event emitter implementation
                    _events: new Map(),
                    on: function (event: string, handler: Function) {
                        if (!this._events.has(event)) {
                            this._events.set(event, []);
                        }
                        this._events.get(event).push(handler);
                        console.log(`Process event handler registered: ${event}`);
                    },
                    off: function (event: string, handler: Function) {
                        const handlers = this._events.get(event) || [];
                        const index = handlers.indexOf(handler);
                        if (index !== -1) {
                            handlers.splice(index, 1);
                        }
                        console.log(`Process event handler removed: ${event}`);
                    },
                    emit: function (event: string, ...args: any[]) {
                        const handlers = this._events.get(event) || [];
                        handlers.forEach((handler: any) => handler(...args));
                        console.log(`Process event emitted: ${event}, handlers: ${handlers.length}`);
                    },
                    removeListener: function (event: string, handler: Function) {
                        this.off(event, handler);
                    }
                },
                __filename: scriptPath,
                __dirname: pathUtils.dirname(scriptPath),
                global: {},
                console: console,
                setTimeout,
                clearTimeout,
                setInterval,
                clearInterval,
                setImmediate: (fn: Function) => setTimeout(fn, 0),
                clearImmediate: (id: number) => clearTimeout(id),
                Buffer: {
                    from: (data: any) => new Uint8Array(data),
                }
            };

            return await this._executeInSandbox(wrapperContent, context);

        } catch (error) {
            const formattedError = error instanceof Error ? {
                message: error.message,
                stack: error.stack,
                name: error.name
            } : error;

            this.logDebug(`Error running script: ${scriptPath}`, formattedError);
            throw new Error(`Error running script ${scriptPath}: ${error}`);
        } finally {
            // Restore original argv and pwd
            this.process.argv = originalArgv;
            this.process.env.PWD = originalPwd;
        }
    }

    private _setupCommonBuiltins(): void {
        // Add commonly needed built-in modules if they don't exist
        if (!this.builtinModules.has('semver')) {
            this.builtinModules.set('semver', {
                functions: {
                    satisfies: (version: string, range: string) => {
                        // Basic semver implementation
                        return true; // Simplified for now
                    }
                }
            });
        }

        if (!this.builtinModules.has('events')) {
            this.builtinModules.set('events', {
                EventEmitter: class EventEmitter {
                    private handlers: Map<string, Function[]> = new Map();

                    on(event: string, handler: Function) {
                        if (!this.handlers.has(event)) {
                            this.handlers.set(event, []);
                        }
                        this.handlers.get(event)?.push(handler);
                    }

                    emit(event: string, ...args: any[]) {
                        this.handlers.get(event)?.forEach(handler => handler(...args));
                    }

                    removeListener(event: string, handler: Function) {
                        const handlers = this.handlers.get(event) || [];
                        const index = handlers.indexOf(handler);
                        if (index !== -1) {
                            handlers.splice(index, 1);
                        }
                    }
                }
            });
        }

        // Add other common built-in modules as needed
    }
    /**
     * Cleans up script content by removing shebang and normalizing line endings
     */
    private cleanupScriptContent(content: string): string {
        // Remove shebang line if present
        content = content.replace(/^#!.*\n/, '');

        // Normalize line endings
        content = content.replace(/\r\n/g, '\n');

        return content;
    }

    /**
     * Runs NPM with given arguments
     * @param args NPM command arguments
     * @returns Promise that resolves when the command completes
     */
    public async runNpm(args: string[] = []): Promise<any> {
        const NPM_CLI_PATH = '/usr/local/lib/npm-cli.js';

        // Check if npm-cli.js exists
        if (!await this.exists(NPM_CLI_PATH)) {
            // Try to fetch and set up npm-cli.js
            try {
                await this.setupNpm();
            } catch (error) {
                throw new Error(`Failed to setup npm: ${(error as Error).message}`);
            }
        }

        // Run npm-cli.js with provided arguments
        return this.runScript(NPM_CLI_PATH, args);
    }

    /**
     * Sets up npm by fetching npm-cli.js and creating necessary files
     */
    private async setupNpm(): Promise<void> {
        const NPM_CLI_PATH = '/usr/local/lib/npm-cli.js';
        const NPM_CLI_URL = 'https://unpkg.com/npm/bin/npm-cli.js';

        try {
            // Create necessary directories
            await fs.promises.mkdir('/usr/local/lib', { recursive: true });
            await fs.promises.mkdir('/usr/local/etc', { recursive: true });
            await fs.promises.mkdir('/tmp/npm-cache', { recursive: true });

            // Fetch npm-cli.js
            const response = await fetch(NPM_CLI_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch npm-cli.js: ${response.status}`);
            }

            let npmCliContent = await response.text();

            // Clean up the npm-cli.js content
            npmCliContent = this.cleanupScriptContent(npmCliContent);

            // Write cleaned npm-cli.js
            await this.writeFile(NPM_CLI_PATH, npmCliContent);

            // Create basic npmrc file
            const npmrcContent = `
                registry=https://registry.npmjs.org/
                cache=/tmp/npm-cache
                prefix=/usr/local
                strict-ssl=false
            `.trim().split('\n').map(line => line.trim()).join('\n');

            await this.writeFile('/usr/local/etc/npmrc', npmrcContent);

            if (this.options.debug) {
                console.log('npm setup completed');
            }
        } catch (error) {
            throw new Error(`npm setup failed: ${(error as Error).message}`);
        }
    }

    public getFs(): typeof fs {
        return fs;
    }

    public get promises(): typeof fs.promises {
        return fs.promises;
    }

    public getProcess(): Process {
        return this.process;
    }

    public async writeFile(path: string, content: string): Promise<void> {
        await fs.promises.writeFile(path, content);
    }

    public async readFile(path: string): Promise<string> {
        return fs.promises.readFile(path, 'utf8');
    }

    public async exists(path: string): Promise<boolean> {
        try {
            await fs.promises.access(path);
            return true;
        } catch {
            return false;
        }
    }

    public dispose(): void {
        if (this.sandbox) {
            this.sandbox.remove();
            this.sandbox = null;
            this.sandboxInitialized = false;
        }
        this.modules.clear();
    }
}

export default BrowserNodeRuntime;