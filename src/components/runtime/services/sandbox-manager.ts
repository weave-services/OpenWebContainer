// sandbox-manager.ts

import { Logger } from './logger';
import { SandboxWindow } from '../types';

// Types and interfaces specific to sandbox management
interface SandboxMessage {
    type: SandboxMessageType;
    payload?: any;
}

type SandboxMessageType =
    | 'SANDBOX_READY'
    | 'SANDBOX_ERROR'
    | 'SANDBOX_UNHANDLED_REJECTION'
    | 'SANDBOX_CONSOLE'
    | 'SANDBOX_EXECUTION_RESULT';

interface SandboxError {
    message: string;
    stack?: string;
    line?: number;
    column?: number;
    source?: string;
}

interface SandboxConsoleMessage {
    method: 'log' | 'info' | 'warn' | 'error' | 'debug';
    args: any[];
}

interface SandboxOptions {
    timeout?: number;
    allowAsync?: boolean;
    contextIsolation?: boolean;
}

export class SandboxManager {
    private sandbox: HTMLIFrameElement | null = null;
    private sandboxInitialized: boolean = false;
    private logger: Logger;
    private messageHandlers: Map<string, Set<(message: SandboxMessage) => void>>;
    private defaultTimeout: number = 5000;
    private pendingExecutions: Map<string, {
        resolve: (value: any) => void;
        reject: (reason: any) => void;
        timeoutId: NodeJS.Timeout;
    }>;

    constructor(logger: Logger) {
        this.logger = logger;
        this.messageHandlers = new Map();
        this.pendingExecutions = new Map();
        this.setupMessageListener();
    }

    private setupMessageListener(): void {
        window.addEventListener('message', this.handleSandboxMessage.bind(this));
    }

    private handleSandboxMessage(event: MessageEvent<SandboxMessage>): void {
        if (event.source !== this.sandbox?.contentWindow) {
            return;
        }

        const { type, payload } = event.data;
        this.logger.log(`Received sandbox message: ${type}`, payload);

        // Handle specific message types
        switch (type) {
            case 'SANDBOX_READY':
                this.handleSandboxReady();
                break;
            case 'SANDBOX_ERROR':
                this.handleSandboxError(payload as SandboxError);
                break;
            case 'SANDBOX_UNHANDLED_REJECTION':
                this.handleUnhandledRejection(payload);
                break;
            case 'SANDBOX_CONSOLE':
                this.handleConsoleMessage(payload as SandboxConsoleMessage);
                break;
            case 'SANDBOX_EXECUTION_RESULT':
                this.handleExecutionResult(payload);
                break;
        }

        // Notify all registered handlers for this message type
        const handlers = this.messageHandlers.get(type);
        if (handlers) {
            handlers.forEach(handler => handler(event.data));
        }
    }

    private handleSandboxReady(): void {
        this.sandboxInitialized = true;
        this.logger.log('Sandbox initialization completed');
    }

    private handleSandboxError(error: SandboxError): void {
        this.logger.log('Sandbox error occurred', error);
        const formattedError = new Error(error.message);
        if (error.stack) formattedError.stack = error.stack;
        this.rejectPendingExecutions(formattedError);
    }

    private handleUnhandledRejection(reason: any): void {
        this.logger.log('Unhandled rejection in sandbox', reason);
        const error = reason instanceof Error ? reason : new Error(String(reason));
        this.rejectPendingExecutions(error);
    }

    private handleConsoleMessage(consoleMsg: SandboxConsoleMessage): void {
        const { method, args } = consoleMsg;
        // Forward console messages to the parent window
        console[method](...args);
    }

    private handleExecutionResult(result: { id: string; result?: any; error?: any }): void {
        const execution = this.pendingExecutions.get(result.id);
        if (!execution) return;

        const { resolve, reject, timeoutId } = execution;
        clearTimeout(timeoutId);
        this.pendingExecutions.delete(result.id);

        if (result.error) {
            reject(this.createErrorFromResult(result.error));
        } else {
            resolve(result.result);
        }
    }

    private createErrorFromResult(error: any): Error {
        if (error instanceof Error) return error;
        const err = new Error(error.message || String(error));
        if (error.stack) err.stack = error.stack;
        return err;
    }

    private rejectPendingExecutions(error: Error): void {
        for (const [id, { reject, timeoutId }] of this.pendingExecutions) {
            clearTimeout(timeoutId);
            reject(error);
            this.pendingExecutions.delete(id);
        }
    }

    async initialize(): Promise<void> {
        if (this.sandboxInitialized) {
            return;
        }

        this.logger.log('Starting sandbox initialization');

        return new Promise<void>((resolve, reject) => {
            try {
                this.sandbox = document.createElement('iframe');
                this.sandbox.style.display = 'none';
                this.sandbox.setAttribute('sandbox', 'allow-scripts allow-same-origin');

                const initTimeout = setTimeout(() => {
                    reject(new Error('Sandbox initialization timed out'));
                }, this.defaultTimeout);

                // Add one-time handler for initialization
                const readyHandler = (message: SandboxMessage) => {
                    if (message.type === 'SANDBOX_READY') {
                        clearTimeout(initTimeout);
                        this.removeMessageHandler('SANDBOX_READY', readyHandler);
                        resolve();
                    }
                };

                this.addMessageHandler('SANDBOX_READY', readyHandler);

                // Initialize the sandbox content
                const content = this.createSandboxContent();
                document.body.appendChild(this.sandbox);

                const doc = this.sandbox.contentDocument;
                if (!doc) {
                    throw new Error('Could not access sandbox document');
                }

                doc.open();
                doc.write(content);
                doc.close();

            } catch (error) {
                this.logger.log('Sandbox initialization failed', error);
                reject(error);
            }
        });
    }

    private createSandboxContent(): string {
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta http-equiv="Content-Security-Policy" 
                          content="default-src 'self' 'unsafe-eval' 'unsafe-inline'">
                </head>
                <body>
                    <script>
                        // Error handling setup
                        window.onerror = function(msg, url, line, col, error) {
                            window.parent.postMessage({
                                type: 'SANDBOX_ERROR',
                                payload: {
                                    message: msg,
                                    source: url,
                                    line: line,
                                    column: col,
                                    stack: error?.stack
                                }
                            }, '*');
                            return true;
                        };

                        // Promise rejection handling
                        window.onunhandledrejection = function(event) {
                            window.parent.postMessage({
                                type: 'SANDBOX_UNHANDLED_REJECTION',
                                payload: event.reason?.toString()
                            }, '*');
                        };

                        // Console method proxying
                        const originalConsole = { ...console };
                        Object.keys(originalConsole).forEach(method => {
                            console[method] = (...args) => {
                                window.parent.postMessage({
                                    type: 'SANDBOX_CONSOLE',
                                    payload: {
                                        method,
                                        args: args.map(arg => 
                                            arg instanceof Error ? {
                                                message: arg.message,
                                                stack: arg.stack
                                            } : arg
                                        )
                                    }
                                }, '*');
                                originalConsole[method](...args);
                            };
                        });

                        // Secure evaluation setup
                        window.secureEval = window.eval;
                        window.secureFunction = window.Function;

                        // Execute code in sandbox
                        window.executeCode = function(id, code, context) {
                            try {
                                const contextKeys = Object.keys(context);
                                const contextValues = Object.values(context);
                                
                                const wrappedCode = \`
                                    try {
                                        (function(\${contextKeys.join(',')}) {
                                            \${code}
                                        }).apply(window, contextValues);
                                    } catch (error) {
                                        throw error;
                                    }
                                \`;

                                const result = window.secureEval(wrappedCode);
                                
                                window.parent.postMessage({
                                    type: 'SANDBOX_EXECUTION_RESULT',
                                    payload: { id, result }
                                }, '*');
                            } catch (error) {
                                window.parent.postMessage({
                                    type: 'SANDBOX_EXECUTION_RESULT',
                                    payload: {
                                        id,
                                        error: {
                                            message: error.message,
                                            stack: error.stack
                                        }
                                    }
                                }, '*');
                            }
                        };

                        // Signal ready state
                        window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
                    </script>
                </body>
            </html>
        `;
    }

    async executeInSandbox(code: string, context: any = {}, options: SandboxOptions = {}): Promise<any> {
        if (!this.sandboxInitialized) {
            await this.initialize();
        }

        const sandboxWindow = this.sandbox?.contentWindow as SandboxWindow | null;
        if (!sandboxWindow) {
            throw new Error('Sandbox window not available');
        }

        const executionId = crypto.randomUUID();
        this.logger.log(`Executing code in sandbox [${executionId}]`, {
            codePreview: code.slice(0, 100) + '...',
            contextKeys: Object.keys(context)
        });

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingExecutions.delete(executionId);
                reject(new Error(`Sandbox execution timed out (${options.timeout || this.defaultTimeout}ms)`));
            }, options.timeout || this.defaultTimeout);

            this.pendingExecutions.set(executionId, { resolve, reject, timeoutId });

            try {
                sandboxWindow.postMessage({
                    type: 'EXECUTE_CODE',
                    payload: {
                        id: executionId,
                        code,
                        context
                    }
                }, '*');
            } catch (error) {
                clearTimeout(timeoutId);
                this.pendingExecutions.delete(executionId);
                reject(error);
            }
        });
    }

    addMessageHandler(type: SandboxMessageType, handler: (message: SandboxMessage) => void): void {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, new Set());
        }
        this.messageHandlers.get(type)!.add(handler);
    }

    removeMessageHandler(type: SandboxMessageType, handler: (message: SandboxMessage) => void): void {
        const handlers = this.messageHandlers.get(type);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    dispose(): void {
        // Clear all pending executions
        this.rejectPendingExecutions(new Error('Sandbox disposed'));

        // Remove all message handlers
        this.messageHandlers.clear();

        // Remove the sandbox iframe
        if (this.sandbox) {
            this.sandbox.remove();
            this.sandbox = null;
            this.sandboxInitialized = false;
        }

        this.logger.log('Sandbox disposed');
    }

    isInitialized(): boolean {
        return this.sandboxInitialized;
    }

    getExecutionCount(): number {
        return this.pendingExecutions.size;
    }
}