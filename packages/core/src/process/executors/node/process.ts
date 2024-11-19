import { ServerType } from '../../../network/types';
import { IFileSystem } from '../../../filesystem';
import { Process, ProcessEvent, ProcessState, ProcessType } from '../../base';
import { getQuickJS, QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import { NetworkManager } from '../../../network/manager';


interface PendingHttpRequest {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

export class NodeProcess extends Process {
    private fileSystem: IFileSystem;
    private activeServers: Set<string> = new Set();
    private networkManager: NetworkManager;
    private pendingHttpRequests: Map<string, PendingHttpRequest> = new Map();
    private HTTP_TIMEOUT = 30000; // 30 seconds timeout for HTTP requests
    private context: QuickJSContext|undefined;

    constructor(
        pid: number,
        executablePath: string,
        args: string[],
        fileSystem: IFileSystem,
        networkManager: NetworkManager,
        parantPid?: number,
        cwd?: string
    ) {
        super(pid, ProcessType.JAVASCRIPT, executablePath, args, parantPid,cwd);
        this.fileSystem = fileSystem;
        this.networkManager = networkManager;
    }
    

    async execute(): Promise<void> {
        try {
            const QuickJS = await getQuickJS();
            const runtime = QuickJS.newRuntime();
            // Set up module loader
            runtime.setModuleLoader((moduleName, ctx) => {
                try {
                    const resolvedPath = this.fileSystem.resolveModulePath(moduleName, this.cwd);
                    const content = this.fileSystem.readFile(resolvedPath);

                    if (content === undefined) {
                        return { error: new Error(`Module not found: ${moduleName}`) };
                    }
                    return { value: content };
                } catch (error: any) {
                    return { error };
                }
            }, (baseModuleName, requestedName) => {
                try {
                    // Get base directory from baseModuleName or use cwd
                    let basePath = baseModuleName ?
                        baseModuleName.substring(0, baseModuleName.lastIndexOf('/')) :
                        this.cwd;

                    basePath=this.fileSystem.normalizePath(basePath||this.cwd||"/");

                    const resolvedPath = this.fileSystem.resolveModulePath(requestedName, basePath);
                    return { value: resolvedPath };
                } catch (error: any) {
                    return { error };
                }
            });

            const context = runtime.newContext();
            this.context = context;
            // setting up network interceptor
            this.setupNetworkInterception(context); 

            // setting up http handler
            this.setupHttpHandling(context);

            // Set up console.log and other console methods
            const consoleObj = context.newObject();

            // Console.log
            const logFn = context.newFunction("log", (...args) => {
                const output = args.map(arg => JSON.stringify(context.dump(arg),null,2)).join(" ") + "\n";
                this.emit(ProcessEvent.MESSAGE, { stdout: output });
            });
            context.setProp(consoleObj, "log", logFn);

            // Console.error
            const errorFn = context.newFunction("error", (...args) => {
                const output = args.map(arg => JSON.stringify(context.dump(arg), null, 2)).join(" ") + "\n";
                this.emit(ProcessEvent.MESSAGE, { stderr: output });
            });
            context.setProp(consoleObj, "error", errorFn);

            context.setProp(context.global, "console", consoleObj);

            // Clean up function handles
            logFn.dispose();
            errorFn.dispose();
            consoleObj.dispose();

            // Set up process.argv
            const processObj = context.newObject();
            const argvArray = context.newArray();

            const fullArgs = ['node', this.executablePath, ...this.args];
            for (let i = 0; i < fullArgs.length; i++) {
                const argHandle = context.newString(fullArgs[i]);
                context.setProp(argvArray, i, argHandle);
                argHandle.dispose();
            }

            context.setProp(processObj, 'argv', argvArray);
            context.setProp(context.global, 'process', processObj);

            argvArray.dispose();
            processObj.dispose();

            try {
                // Get the file content
                let content = this.fileSystem.readFile(this.executablePath);
                if (!content) {
                    throw new Error(`File not found: ${this.executablePath}`);
                }
                let firstLine = content.split('\n')[0];
                // Remove shebang if present
                if (firstLine.startsWith('#!')) {
                    content = content.split('\n').slice(1).join('\n');
                }

                // Execute the code
                const result = context.evalCode(content, this.executablePath, { type: 'module' });

                // Handle any pending promises
                while (runtime.hasPendingJob()) {
                    const jobResult = runtime.executePendingJobs(10);
                    if (jobResult.error) {
                        throw context.dump(jobResult.error);
                    }
                }

                if (result.error) {
                    throw context.dump(result.error);
                }

                result.value.dispose();
                this._exitCode = 0;
                this._state = ProcessState.COMPLETED;
            } catch (error) {
                this._exitCode = 1;
                this._state = ProcessState.FAILED;
                this.emit(ProcessEvent.MESSAGE, { stderr: `${error}\n` });
            } finally {
                context.dispose();
                runtime.dispose();
                this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
            }
        } catch (error: any) {
            this._state = ProcessState.FAILED;
            this._exitCode = 1;
            this.emit(ProcessEvent.ERROR, { pid: this.pid, error });
            this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
        }
    }

    async handleHttpRequest(request: Request): Promise<Response> {
        const requestId = Math.random().toString(36).substring(2);

        try {
            if(this.context === undefined) {
                throw new Error('Context not initialized');
            }
            // Convert headers to a plain object
            const headers: Record<string, string> = {};
            request.headers.forEach((value, key) => {
                headers[key.toLowerCase()] = value;
            });

            // Get the body if present
            let body: string | undefined;
            if (request.body) {
                body = await request.text();
            }

            // Create a promise that will resolve with the response
            const responsePromise = new Promise<Response>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    const pending = this.pendingHttpRequests.get(requestId);
                    if (pending) {
                        pending.reject(new Error('Request timeout'));
                        this.pendingHttpRequests.delete(requestId);
                    }
                }, this.HTTP_TIMEOUT);

                this.pendingHttpRequests.set(requestId, {
                    resolve,
                    reject,
                    timeout
                });
            });

            // Call the request handler in QuickJS
            const result = this.context.evalCode(`
                globalThis.__handleHttpRequest(
                    ${JSON.stringify(requestId)},
                    ${JSON.stringify(request.method)},
                    ${JSON.stringify(request.url)},
                    ${JSON.stringify(headers)},
                    ${body ? JSON.stringify(body) : 'undefined'}
                );
            `);

            // Check for immediate errors
            if (result.error) {
                const error = this.context.dump(result.error);
                result.error.dispose();
                throw new Error(typeof error === 'string' ? error : 'Error handling request');
            }
            result.value.dispose();

            // Wait for the response
            return await responsePromise;

        } catch (error) {
            // Clean up pending request
            const pending = this.pendingHttpRequests.get(requestId);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingHttpRequests.delete(requestId);
            }

            // Return error response
            return new Response(
                error instanceof Error ? error.message : 'Internal Server Error',
                { status: 500 }
            );
        }
    }

    async terminate(): Promise<void> {
        if (this._state !== ProcessState.RUNNING) {
            return;
        }

        // this.running = false;
        this._state = ProcessState.TERMINATED;
        this._exitCode = -1;
        this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
    }



    //setup network interceptor
    private setupNetworkInterception(context:QuickJSContext): void {
        // Intercept Node's net module
        context.evalCode(`
            // Store original requires
            const originalRequire = require;
            
            // Mock net module
            const netModule = {
                Server: function() {
                    const eventHandlers = new Map();
                    
                    const server = {
                        listening: false,
                        
                        listen(port, host, backlog) {
                            const options = {
                                port: typeof port === 'object' ? port.port : port,
                                host: typeof port === 'object' ? port.host : host,
                                backlog: typeof port === 'object' ? port.backlog : backlog
                            };

                            const serverId = globalThis.__registerServer('tcp', options.port, {
                                host: options.host,
                                backlog: options.backlog
                            });

                            this.listening = true;
                            if (eventHandlers.has('listening')) {
                                eventHandlers.get('listening').forEach(handler => handler());
                            }

                            return this;
                        },

                        on(event, handler) {
                            if (!eventHandlers.has(event)) {
                                eventHandlers.set(event, new Set());
                            }
                            eventHandlers.get(event).add(handler);
                            return this;
                        },

                        once(event, handler) {
                            const wrapper = (...args) => {
                                handler(...args);
                                this.removeListener(event, wrapper);
                            };
                            return this.on(event, wrapper);
                        },

                        removeListener(event, handler) {
                            const handlers = eventHandlers.get(event);
                            if (handlers) {
                                handlers.delete(handler);
                            }
                            return this;
                        },

                        close(callback) {
                            this.listening = false;
                            if (callback) callback();
                            return this;
                        }
                    };

                    return server;
                }
            };

            // Mock http module
            const httpModule = {
                Server: function() {
                    const server = new netModule.Server();
                    
                    // Add http-specific methods
                    server.setTimeout = function() { return this; };
                    
                    return server;
                },
                
                createServer: function(handler) {
                    const server = new this.Server();
                    if (handler) {
                        server.on('request', handler);
                    }
                    return server;
                }
            };

            // Override require for network modules
            globalThis.require = function(module) {
                switch(module) {
                    case 'net':
                        return netModule;
                    case 'http':
                        return httpModule;
                    default:
                        return originalRequire(module);
                }
            };
        `);
        // Register helper functions
        const registerServer = context.newFunction(
            "__registerServer",
            (typeHandle: QuickJSHandle, portHandle: QuickJSHandle, optionsHandle: QuickJSHandle) => {
                try {
                    // Convert the arguments from QuickJS handles to native types
                    const type = context.getString(typeHandle) as ServerType;
                    const port = context.getNumber(portHandle);
                    const options = optionsHandle ? context.dump(optionsHandle) : {};

                    const serverId = this.networkManager.registerServer(
                        this.pid,
                        port,
                        type,
                        options
                    );
                    this.activeServers.add(serverId);
                    return context.newString(serverId);
                } catch (error) {
                    throw context.newError(error instanceof Error ? error.message : 'Server registration failed');
                }
            }
        );

        context.setProp(context.global, "__registerServer", registerServer);
        registerServer.dispose();
    }

    private setupHttpHandling(context: QuickJSContext): void {
        // Add response handler function to runtime
        const handleHttpResponse = context.newFunction(
            "__handleHttpResponse",
            (
                requestIdHandle: QuickJSHandle,
                statusHandle: QuickJSHandle,
                headersHandle: QuickJSHandle,
                bodyHandle: QuickJSHandle
            ) => {
                try {
                    const requestId = context.getString(requestIdHandle);
                    const pending = this.pendingHttpRequests.get(requestId);

                    if (!pending) {
                        console.warn(`No pending request found for ID: ${requestId}`);
                        return;
                    }

                    // Clear timeout
                    clearTimeout(pending.timeout);

                    // Convert response data from QuickJS
                    const status = context.getNumber(statusHandle);
                    const headers = context.dump(headersHandle) as Record<string, string>;
                    const body = bodyHandle ? context.getString(bodyHandle) : '';

                    // Create and send response
                    const response = new Response(body, {
                        status,
                        headers
                    });

                    pending.resolve(response);
                    this.pendingHttpRequests.delete(requestId);
                } catch (error) {
                    console.error('Error handling HTTP response:', error);
                }
            }
        );

        context.setProp(context.global, "__handleHttpResponse", handleHttpResponse);
        handleHttpResponse.dispose();

        // Inject request handling code into the runtime
        context.evalCode(`
            // Create a map to store server request handlers
            globalThis.__httpRequestHandlers = new Map();

            // Function to register a handler for a port
            globalThis.__registerHttpHandler = function(port, handler) {
                __httpRequestHandlers.set(port, handler);
            };

            // Function to handle incoming HTTP requests
            globalThis.__handleHttpRequest = function(requestId, method, url, headers, body) {
                const parsedUrl = new URL(url, 'http://localhost');
                const port = parseInt(parsedUrl.port || '80');
                
                const handler = __httpRequestHandlers.get(port);
                if (!handler) {
                    __handleHttpResponse(
                        requestId,
                        404,
                        {'Content-Type': 'text/plain'},
                        'No handler for port ' + port
                    );
                    return;
                }

                // Create req object
                const req = {
                    method,
                    url: parsedUrl.pathname + parsedUrl.search,
                    headers: headers,
                    body: body,
                    rawBody: body,
                    
                    // Common Express/Node.js properties
                    originalUrl: parsedUrl.pathname + parsedUrl.search,
                    query: Object.fromEntries(parsedUrl.searchParams),
                    params: {},
                    path: parsedUrl.pathname,
                    
                    get(header) {
                        return headers[header.toLowerCase()];
                    }
                };

                // Create res object
                const res = {
                    _headers: {},
                    _status: 200,
                    _body: null,
                    
                    status(code) {
                        this._status = code;
                        return this;
                    },
                    
                    set(header, value) {
                        this._headers[header.toLowerCase()] = value;
                        return this;
                    },
                    
                    get(header) {
                        return this._headers[header.toLowerCase()];
                    },
                    
                    json(data) {
                        this._headers['content-type'] = 'application/json';
                        this._body = JSON.stringify(data);
                        this.end();
                    },
                    
                    send(data) {
                        if (typeof data === 'string') {
                            this._headers['content-type'] = 'text/plain';
                            this._body = data;
                        } else if (Buffer.isBuffer(data)) {
                            this._headers['content-type'] = 'application/octet-stream';
                            this._body = data.toString('utf-8');
                        } else {
                            this._headers['content-type'] = 'application/json';
                            this._body = JSON.stringify(data);
                        }
                        this.end();
                    },
                    
                    end(data) {
                        if (data !== undefined) {
                            this._body = data;
                        }
                        __handleHttpResponse(
                            requestId,
                            this._status,
                            this._headers,
                            this._body
                        );
                    }
                };

                // Call the handler
                try {
                    handler(req, res);
                } catch (error) {
                    __handleHttpResponse(
                        requestId,
                        500,
                        {'Content-Type': 'text/plain'},
                        error.message
                    );
                }
            };
        `);
    }

}