// module-manager.ts

import { Logger } from './logger';
import { Module, Process } from '../types';
import { SandboxManager } from './sandbox-manager';
import { pathUtils } from '../utils/path-utils';
import { TarUtility } from '../utils/tar-utility';
import { fs } from '@zenfs/core';

interface ModuleCache {
    [key: string]: Module;
}

interface BuiltinModule {
    name: string;
    exports: any;
    isBuiltin: true;
}

interface ModuleInitializeOptions {
    process: Process;
    require?: (path: string, parent?: string) => Promise<any>;
}

export class ModuleManager {
    private modules: Map<string, Module>;
    private builtinModules: Map<string, BuiltinModule>;
    private logger: Logger;
    private sandboxManager: SandboxManager;
    private process: Process;
    private moduleCache: ModuleCache;
    private moduleInitializing: Set<string>;
    private modulePaths: string[];

    constructor(
        logger: Logger,
        sandboxManager: SandboxManager,
        options: ModuleInitializeOptions
    ) {
        this.logger = logger;
        this.sandboxManager = sandboxManager;
        this.process = options.process;
        this.modules = new Map();
        this.builtinModules = new Map();
        this.moduleCache = {};
        this.moduleInitializing = new Set();
        this.modulePaths = [
            '/node_modules',
            '/usr/local/lib/node_modules',
            '/usr/lib/node_modules'
        ];

        this.setupBuiltinModules();
    }

    private setupBuiltinModules(): void {
        // Path module implementation
        const pathModule: BuiltinModule = {
            name: 'path',
            isBuiltin: true,
            exports: {
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

                dirname: pathUtils.dirname,
                normalize: pathUtils.normalize,
                join: pathUtils.join,
                resolve: pathUtils.resolve,

                extname(path: string): string {
                    const basename = this.basename(path);
                    const dotIndex = basename.lastIndexOf('.');
                    return dotIndex > 0 ? basename.slice(dotIndex) : '';
                },

                parse(path: string): any {
                    const root = path.startsWith('/') ? '/' : '';
                    const basename = this.basename(path);
                    const ext = this.extname(basename);
                    const name = basename.slice(0, -ext.length);
                    const dir = this.dirname(path);

                    return { root, dir, base: basename, ext, name };
                },

                isAbsolute(path: string): boolean {
                    return path.startsWith('/');
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
                }
            }
        };

        // Events module implementation
        const eventsModule: BuiltinModule = {
            name: 'events',
            isBuiltin: true,
            exports: {
                EventEmitter: class EventEmitter {
                    private handlers: Map<string, Function[]>;

                    constructor() {
                        this.handlers = new Map();
                    }

                    on(event: string, handler: Function): this {
                        if (!this.handlers.has(event)) {
                            this.handlers.set(event, []);
                        }
                        this.handlers.get(event)!.push(handler);
                        return this;
                    }

                    once(event: string, handler: Function): this {
                        const wrapper = (...args: any[]) => {
                            this.removeListener(event, wrapper);
                            handler.apply(this, args);
                        };
                        this.on(event, wrapper);
                        return this;
                    }

                    emit(event: string, ...args: any[]): boolean {
                        const handlers = this.handlers.get(event);
                        if (!handlers) return false;
                        handlers.forEach(handler => handler.apply(this, args));
                        return true;
                    }

                    removeListener(event: string, handler: Function): this {
                        const handlers = this.handlers.get(event);
                        if (handlers) {
                            const index = handlers.indexOf(handler);
                            if (index !== -1) {
                                handlers.splice(index, 1);
                            }
                        }
                        return this;
                    }

                    removeAllListeners(event?: string): this {
                        if (event) {
                            this.handlers.delete(event);
                        } else {
                            this.handlers.clear();
                        }
                        return this;
                    }

                    listeners(event: string): Function[] {
                        return [...(this.handlers.get(event) || [])];
                    }
                }
            }
        };

        // Buffer module implementation (simplified)
        const bufferModule: BuiltinModule = {
            name: 'buffer',
            isBuiltin: true,
            exports: {
                Buffer: {
                    from(data: string | Array<number> | ArrayBuffer, encoding?: string): Uint8Array {
                        if (typeof data === 'string') {
                            const encoder = new TextEncoder();
                            return encoder.encode(data);
                        }
                        return new Uint8Array(data);
                    },

                    alloc(size: number, fill?: number): Uint8Array {
                        const buffer = new Uint8Array(size);
                        if (typeof fill === 'number') {
                            buffer.fill(fill);
                        }
                        return buffer;
                    },

                    isBuffer(obj: any): boolean {
                        return obj instanceof Uint8Array;
                    }
                }
            }
        };

        // Util module implementation (simplified)
        const utilModule: BuiltinModule = {
            name: 'util',
            isBuiltin: true,
            exports: {
                promisify<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => Promise<any> {
                    return function (this: any, ...args: Parameters<T>): Promise<any> {
                        const boundFn = fn.bind(this);
                        return new Promise((resolve, reject) => {
                            boundFn(...args, (err: Error, result: any) => {
                                if (err) reject(err);
                                else resolve(result);
                            });
                        });
                    };
                },

                inherits(ctor: any, superCtor: any): void {
                    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
                },

                inspect(obj: any, options?: any): string {
                    return JSON.stringify(obj, null, 2);
                }
            }
        };

        // Stream module (simplified)
        const streamModule: BuiltinModule = {
            name: 'stream',
            isBuiltin: true,
            exports: {
                Readable: class Readable extends eventsModule.exports.EventEmitter {
                    constructor(options: any = {}) {
                        super();
                        this.readable = true;
                    }
                },
                Writable: class Writable extends eventsModule.exports.EventEmitter {
                    constructor(options: any = {}) {
                        super();
                        this.writable = true;
                    }
                }
            }
        };
        const tarModule: BuiltinModule = {
            name: 'tar',
            isBuiltin: true,
            exports: {
                async c(options: { file?: string; gzip?: boolean }, paths: string[]): Promise<Uint8Array | void> {
                    const files: { [path: string]: string | Uint8Array } = {};

                    // Read all specified files
                    for (const path of paths) {
                        try {
                            const content = await fs.promises.readFile(path);
                            files[path] = content;
                        } catch (error) {
                            this.logger?.log(`Error reading file ${path}`, error);
                            throw error;
                        }
                    }

                    const archive = await TarUtility.create(files);

                    if (options.file) {
                        await fs.promises.writeFile(options.file, archive);
                    } else {
                        return archive;
                    }
                },

                async x(options: { file?: string; C?: string }): Promise<void> {
                    let archive: Uint8Array;

                    if (options.file) {
                        archive = await fs.promises.readFile(options.file);
                    } else {
                        throw new Error('No input file specified');
                    }

                    const files = await TarUtility.extract(archive);
                    const targetDir = options.C || '.';

                    for (const [path, content] of Object.entries(files)) {
                        const fullPath = pathUtils.join(targetDir, path);
                        const dir = pathUtils.dirname(fullPath);

                        try {
                            await fs.promises.mkdir(dir, { recursive: true });
                            await fs.promises.writeFile(fullPath, content);
                        } catch (error) {
                            this.logger?.log(`Error writing file ${fullPath}`, error);
                            throw error;
                        }
                    }
                },

                async t(options: { file?: string }): Promise<void> {
                    if (!options.file) {
                        throw new Error('No input file specified');
                    }

                    const archive = await fs.promises.readFile(options.file);
                    const contents = TarUtility.list(archive);

                    for (const entry of contents) {
                        console.log(entry.name);
                    }
                },

                create: TarUtility.create.bind(TarUtility),
                extract: TarUtility.extract.bind(TarUtility),
                list: TarUtility.list.bind(TarUtility),
                validate: TarUtility.validate.bind(TarUtility),
                addFile: TarUtility.addFile.bind(TarUtility),
                removeFile: TarUtility.removeFile.bind(TarUtility)
            }
        };

        // Register all builtin modules
        [pathModule, eventsModule, bufferModule, utilModule, streamModule, tarModule].forEach(module => {
            this.builtinModules.set(module.name, module);
        });
    }

    private async readModuleFile(path: string): Promise<string> {
        try {
            return await fs.promises.readFile(path, 'utf8');
        } catch (error) {
            throw new Error(`Cannot read module file: ${path}\n${error}`);
        }
    }

    private async resolveModulePath(request: string, parent?: string): Promise<string> {
        // Handle builtin modules
        if (this.builtinModules.has(request)) {
            return request;
        }

        const isRelative = request.startsWith('./') || request.startsWith('../');
        const isAbsolute = request.startsWith('/');

        if (isRelative && parent) {
            const parentDir = pathUtils.dirname(parent);
            const resolvedPath = pathUtils.resolve(parentDir, request);
            return this.resolveFileExtension(resolvedPath);
        }

        if (isAbsolute) {
            return this.resolveFileExtension(request);
        }

        // Node modules resolution
        const paths = parent ?
            [pathUtils.resolve(pathUtils.dirname(parent), 'node_modules')] :
            [];

        paths.push(...this.modulePaths);

        for (const basePath of paths) {
            const modulePath = pathUtils.join(basePath, request);
            try {
                return await this.resolveNodeModule(modulePath);
            } catch (error) {
                continue;
            }
        }

        throw new Error(`Cannot find module '${request}' from '${parent}'`);
    }

    private async resolveFileExtension(path: string): Promise<string> {
        // Try exact path first
        if (await this.fileExists(path)) {
            return path;
        }

        // Try adding extensions
        const extensions = ['.js', '.json'];
        for (const ext of extensions) {
            const pathWithExt = path + ext;
            if (await this.fileExists(pathWithExt)) {
                return pathWithExt;
            }
        }

        // Try as a directory (index.js)
        const indexPath = pathUtils.join(path, 'index.js');
        if (await this.fileExists(indexPath)) {
            return indexPath;
        }

        throw new Error(`Module not found: ${path}`);
    }

    private async resolveNodeModule(basePath: string): Promise<string> {
        try {
            // Check for package.json
            const pkgPath = pathUtils.join(basePath, 'package.json');
            if (await this.fileExists(pkgPath)) {
                const pkgContent = await this.readModuleFile(pkgPath);
                const pkg = JSON.parse(pkgContent);
                if (pkg.main) {
                    const mainPath = pathUtils.join(basePath, pkg.main);
                    return this.resolveFileExtension(mainPath);
                }
            }

            // Try index.js
            return this.resolveFileExtension(pathUtils.join(basePath, 'index.js'));
        } catch (error) {
            throw new Error(`Cannot resolve module in ${basePath}`);
        }
    }

    private async fileExists(path: string): Promise<boolean> {
        try {
            await fs.promises.access(path);
            return true;
        } catch {
            return false;
        }
    }

    public async require(modulePath: string, parent?: string): Promise<any> {
        const resolvedPath = await this.resolveModulePath(modulePath, parent);

        // Return cached module if available
        if (this.modules.has(resolvedPath)) {
            return this.modules.get(resolvedPath)!.exports;
        }

        // Return builtin module if applicable
        if (this.builtinModules.has(resolvedPath)) {
            return this.builtinModules.get(resolvedPath)!.exports;
        }

        // Detect circular dependencies
        if (this.moduleInitializing.has(resolvedPath)) {
            throw new Error(`Circular dependency detected: ${resolvedPath}`);
        }

        this.moduleInitializing.add(resolvedPath);

        try {
            const moduleContent = await this.readModuleFile(resolvedPath);

            // Create module object
            const module: Module = {
                exports: {},
                id: resolvedPath,
                filename: resolvedPath,
                loaded: false,
                paths: this.modulePaths,
                require: (path: string) => this.require(path, resolvedPath)
            };

            // Store in cache before executing to handle circular dependencies
            this.modules.set(resolvedPath, module);

            // Execute module code
            await this.executeModule(module, moduleContent);

            module.loaded = true;
            return module.exports;

        } finally {
            this.moduleInitializing.delete(resolvedPath);
        }
    }

    private async executeModule(module: Module, content: string): Promise<void> {
        const wrappedContent = `
            (function(exports, require, module, __filename, __dirname, process) {
                ${content}
            })
        `;

        const dirname = pathUtils.dirname(module.filename);

        try {
            await this.sandboxManager.executeInSandbox(
                wrappedContent,
                {
                    exports: module.exports,
                    require: module.require,
                    module,
                    __filename: module.filename,
                    __dirname: dirname,
                    process: this.process
                }
            );
        } catch (error) {
            this.logger.log(`Error executing module ${module.filename}`, error);
            throw error;
        }
    }

    public clearCache(): void {
        this.modules.clear();
        this.moduleInitializing.clear();
    }

    public getLoadedModules(): string[] {
        return Array.from(this.modules.keys());
    }

    public isBuiltinModule(name: string): boolean {
        return this.builtinModules.has(name);
    }

    public getBuiltinModuleNames(): string[] {
        return Array.from(this.builtinModules.keys());
    }
}