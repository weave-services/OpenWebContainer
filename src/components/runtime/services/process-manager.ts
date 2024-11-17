// process-manager.ts

import { EventEmitter } from 'events';
import { Logger } from './logger';

interface ProcessEnv {
    [key: string]: string | undefined;
}

interface ProcessVersions {
    node: string;
    v8: string;
    uv: string;
    zlib: string;
    brotli: string;
    ares: string;
    modules: string;
    nghttp2: string;
    napi: string;
    llhttp: string;
    openssl: string;
    [key: string]: string;
}

interface ProcessMetrics {
    startTime: number;
    uptime: number;
    memoryUsage: {
        heapTotal: number;
        heapUsed: number;
        external: number;
        rss: number;
    };
    cpuUsage: {
        user: number;
        system: number;
    };
}

type SignalHandler = (signal: string) => void;

export class ProcessManager extends EventEmitter {
    private _env: ProcessEnv = {};
    private args: string[] = [];
    private logger: Logger;
    private startTime: number = Date.now();
    private exitCode: number | null = null;
    private signalHandlers: Map<string, Set<SignalHandler>> = new Map();
    private _pid: number = Math.floor(Math.random() * 32768);
    private _platform: string = this.detectPlatform();
    private _arch: string = this.detectArch();
    private _versions: ProcessVersions = {
        node: '16.0.0',
        v8: '9.4.146.24-node.21',
        uv: '1.41.0',
        zlib: '1.2.11',
        brotli: '1.0.9',
        ares: '1.17.1',
        modules: '93',
        nghttp2: '1.42.0',
        napi: '8',
        llhttp: '3.1.0',
        openssl: '1.1.1k',
        unicode: '13.0'
    };
    private _title: string = 'browser-node';
    private _execPath: string = '/usr/local/bin/node';
    private _argv0: string = 'node';
    private _mainModule: string | null = null;
    private _debugPort: number = 9229;
    private _connected: boolean = true;
    private _stdin: any = null;
    private _stdout: any = null;
    private _stderr: any = null;
    private _cwd: string = '/';

    private nextTickQueue: Array<{ callback: Function; args: any[] }> = [];
    private nextTickProcessing: boolean = false;

    constructor(logger: Logger) {
        super();
        this.logger = logger;

        this.startTime = Date.now();
        this.exitCode = null;
        this.signalHandlers = new Map();
        this._pid = Math.floor(Math.random() * 32768); // Random PID
        this.nextTickQueue = [];
        this.nextTickProcessing = false;

        // Initialize process properties
        this.initializeProcessProperties();
        this.setupStandardStreams();
        this.setupSignalHandlers();
    }

    private initializeProcessProperties(): void {
        this._platform = this.detectPlatform();
        this._arch = this.detectArch();
        this._title = 'browser-node';
        this._execPath = '/usr/local/bin/node';
        this._argv0 = 'node';
        this._mainModule = null;
        this._debugPort = 9229;
        this._connected = true;
        this._cwd = '/';

        // Initialize environment variables
        this._env = {
            NODE_ENV: 'production',
            NODE_PATH: '/node_modules',
            PATH: '/usr/local/bin:/usr/bin:/bin',
            LANG: 'en_US.UTF-8',
            HOME: '/home',
            TMPDIR: '/tmp',
            PWD: this._cwd,
            SHELL: '/bin/sh',
            ...this.getDefaultEnv()
        };

        // Initialize versions
        this._versions = {
            node: '16.0.0',
            v8: '9.4.146.24-node.21',
            uv: '1.41.0',
            zlib: '1.2.11',
            brotli: '1.0.9',
            ares: '1.17.1',
            modules: '93',
            nghttp2: '1.42.0',
            napi: '8',
            llhttp: '3.1.0',
            openssl: '1.1.1k',
            unicode: '13.0'
        };

        // Initialize argv
        this.args = [this._execPath, 'script.js'];
    }

    private setupStandardStreams(): void {
        // Create basic stream implementations
        this._stdout = {
            write: (data: string | Uint8Array): boolean => {
                console.log(data.toString());
                return true;
            },
            isTTY: true,
            columns: 80,
            rows: 24,
            writeable: true
        };

        this._stderr = {
            write: (data: string | Uint8Array): boolean => {
                console.error(data.toString());
                return true;
            },
            isTTY: true,
            columns: 80,
            rows: 24,
            writeable: true
        };

        this._stdin = {
            read: (): null => null,
            isTTY: true,
            readable: true,
            resume: () => { },
            pause: () => { },
            pipe: () => { },
            unpipe: () => { }
        };
    }

    private setupSignalHandlers(): void {
        // List of supported signals
        const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'SIGUSR1', 'SIGUSR2'];

        signals.forEach(signal => {
            this.signalHandlers.set(signal, new Set());
        });

        // Handle window events that might correspond to signals
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.emit('SIGTERM');
            });

            window.addEventListener('unload', () => {
                this.emit('SIGTERM');
            });
        }
    }

    private detectPlatform(): string {
        if (typeof navigator !== 'undefined') {
            const userAgent = navigator.userAgent.toLowerCase();
            if (userAgent.includes('win')) return 'win32';
            if (userAgent.includes('mac')) return 'darwin';
            if (userAgent.includes('linux')) return 'linux';
        }
        return 'linux'; // Default to linux
    }

    private detectArch(): string {
        if (typeof navigator !== 'undefined') {
            const platform = navigator.platform.toLowerCase();
            if (platform.includes('64')) return 'x64';
            if (platform.includes('86')) return 'x86';
            if (platform.includes('arm')) return 'arm';
        }
        return 'x64'; // Default to x64
    }

    private getDefaultEnv(): ProcessEnv {
        return {
            // NPM related
            npm_config_registry: 'https://registry.npmjs.org/',
            npm_config_node_version: this._versions.node,
            npm_config_user_agent: `npm/${this._versions.node} node/${this._versions.node}`,

            // System paths
            TEMP: '/tmp',
            TMP: '/tmp',

            // User info
            USER: 'browseruser',
            USERNAME: 'browseruser',
            LOGNAME: 'browseruser',

            // System info
            HOSTNAME: 'browser-environment',
            TERM: 'xterm-256color'
        };
    }

    // Public API methods
    public get pid(): number {
        return this._pid;
    }

    public get platform(): string {
        return this._platform;
    }

    public get arch(): string {
        return this._arch;
    }

    public get execPath(): string {
        return this._execPath;
    }

    public get argv(): string[] {
        return [...this.args];
    }

    public set argv(value: string[]) {
        this.args = [...value];
    }

    public get env(): ProcessEnv {
        return { ...this._env };
    }
    public get versions(): ProcessVersions {
        return { ...this._versions };
    }
    get version(): string {
        return this._versions.node;
    }

    public cwd(): string {
        return this._cwd;
    }

    public chdir(directory: string): void {
        // Validate directory
        if (typeof directory !== 'string') {
            throw new TypeError('directory must be a string');
        }

        this._cwd = directory;
        this._env.PWD = directory;
    }

    public nextTick(callback: Function, ...args: any[]): void {
        this.nextTickQueue.push({ callback, args });

        if (!this.nextTickProcessing) {
            this.nextTickProcessing = true;
            Promise.resolve().then(() => this.processNextTick());
        }
    }

    private processNextTick(): void {
        while (this.nextTickQueue.length > 0) {
            const { callback, args } = this.nextTickQueue.shift()!;
            try {
                callback.apply(null, args);
            } catch (error) {
                this.emit('uncaughtException', error);
            }
        }
        this.nextTickProcessing = false;
    }

    public hrtime(time?: [number, number]): [number, number] {
        const hrTime = performance.now() * 1e-3;
        const seconds = Math.floor(hrTime);
        const nanoseconds = Math.floor((hrTime % 1) * 1e9);

        if (time) {
            const [prevSeconds, prevNanoseconds] = time;
            const diffSeconds = seconds - prevSeconds;
            const diffNanoseconds = nanoseconds - prevNanoseconds;

            return [
                diffSeconds,
                diffNanoseconds < 0
                    ? 1e9 + diffNanoseconds
                    : diffNanoseconds
            ];
        }

        return [seconds, nanoseconds];
    }

    public memoryUsage(): ProcessMetrics['memoryUsage'] {
        // Use performance.memory if available, otherwise provide estimates
        const memory = (performance as any).memory || {
            totalJSHeapSize: 16 * 1024 * 1024,
            usedJSHeapSize: 8 * 1024 * 1024,
            jsHeapSizeLimit: 32 * 1024 * 1024
        };

        return {
            heapTotal: memory.totalJSHeapSize,
            heapUsed: memory.usedJSHeapSize,
            external: 0,
            rss: memory.jsHeapSizeLimit
        };
    }

    public cpuUsage(previousValue?: { user: number; system: number }): ProcessMetrics['cpuUsage'] {
        const usage = {
            user: 0,
            system: 0
        };

        if (previousValue) {
            usage.user = Math.max(0, usage.user - previousValue.user);
            usage.system = Math.max(0, usage.system - previousValue.system);
        }

        return usage;
    }

    public uptime(): number {
        return (Date.now() - this.startTime) / 1000;
    }

    public kill(pid: number, signal: string | number = 'SIGTERM'): boolean {
        if (pid === this._pid) {
            this.emit(signal.toString());
            return true;
        }
        return false;
    }

    public exit(code: number = 0): void {
        this.exitCode = code;
        this.emit('exit', code);
        this._connected = false;
    }

    public on(event: string, listener: (...args: any[]) => void): this {
        super.on(event, listener);
        return this;
    }

    public once(event: string, listener: (...args: any[]) => void): this {
        super.once(event, listener);
        return this;
    }

    public removeListener(event: string, listener: (...args: any[]) => void): this {
        super.removeListener(event, listener);
        return this;
    }

    public removeAllListeners(event?: string): this {
        super.removeAllListeners(event);
        return this;
    }

    public getStdout() {
        return this._stdout;
    }

    public getStderr() {
        return this._stderr;
    }

    public getStdin() {
        return this._stdin;
    }

    public setEnvironmentVariable(key: string, value: string | undefined): void {
        if (value === undefined) {
            delete this._env[key];
        } else {
            this._env[key] = value;
        }
    }

    public getEnvironmentVariable(key: string): string | undefined {
        return this._env[key];
    }

    public getAllEnvironmentVariables(): ProcessEnv {
        return { ...this._env };
    }

    // Debug and testing methods
    public getMetrics(): ProcessMetrics {
        return {
            startTime: this.startTime,
            uptime: this.uptime(),
            memoryUsage: this.memoryUsage(),
            cpuUsage: this.cpuUsage()
        };
    }

    public isConnected(): boolean {
        return this._connected;
    }

    public getDebugPort(): number {
        return this._debugPort;
    }

    public setDebugPort(port: number): void {
        this._debugPort = port;
    }
}