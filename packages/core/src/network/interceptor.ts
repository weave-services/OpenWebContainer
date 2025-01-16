export class NetworkInterceptor {
    private worker: Worker;
    private iframeElement: HTMLIFrameElement;
    private serverPort: number;
    private responseHandlers: Map<string, (response: any) => void>;
    private requestId: number = 0;

    constructor(iframeElement: HTMLIFrameElement, worker: Worker, serverPort: number = 3000) {
        this.worker = worker;
        this.iframeElement = iframeElement;
        this.serverPort = serverPort;
        this.responseHandlers = new Map();

        // Set up message handlers
        this.setupWorkerMessageHandler();
        this.setupIframeMessageHandler();
    }

    private setupWorkerMessageHandler() {
        this.worker.onmessage = (event) => {
            const { id, response } = event.data;
            const handler = this.responseHandlers.get(id);
            if (handler) {
                handler(response);
                this.responseHandlers.delete(id);
            }
        };
    }

    private setupIframeMessageHandler() {
        window.addEventListener('message', (event) => {
            if (event.source === this.iframeElement.contentWindow) {
                const { id, request } = event.data;
                if (request) {
                    this.handleRequest(id, request);
                }
            }
        });
    }

    private async handleRequest(id: string, request: any) {
        const internalRequestId = (this.requestId++).toString();

        // Create a promise that will resolve when we get a response
        const responsePromise = new Promise((resolve) => {
            this.responseHandlers.set(internalRequestId, resolve);
        });

        // Forward the request to the worker
        this.worker.postMessage({
            type: 'request',
            id: internalRequestId,
            request: {
                ...request,
                port: this.serverPort
            }
        });

        // Wait for response and send it back to iframe
        const response = await responsePromise;
        this.iframeElement.contentWindow?.postMessage({
            id,
            response
        }, '*');
    }
}

// Web Worker code to handle requests
export const workerCode = `
    self.onmessage = async function(e) {
        const { type, id, request } = e.data;
        
        if (type === 'request') {
            try {
                // Forward request to container's express server
                const response = await handleContainerRequest(request);
                self.postMessage({ id, response });
            } catch (error) {
                self.postMessage({ 
                    id, 
                    response: {
                        status: 500,
                        statusText: 'Internal Server Error',
                        body: error.message
                    }
                });
            }
        }
    };

    async function handleContainerRequest(request) {
        // This would be implemented in your container to actually
        // make the request to the express server
        // For now we'll just return a mock response
        return {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'application/json'
            },
            body: { message: 'Response from container' }
        };
    }
`;

// Iframe script to intercept and route requests
export const iframeScript = `
    // Inject this into the iframe to intercept requests
    const originalFetch = window.fetch;
    let requestId = 0;

    window.fetch = function(url, options = {}) {
        const id = (requestId++).toString();
        
        return new Promise((resolve, reject) => {
            // Send request to parent
            window.parent.postMessage({
                id,
                request: {
                    url,
                    method: options.method || 'GET',
                    headers: options.headers || {},
                    body: options.body
                }
            }, '*');

            // Wait for response
            const handler = function(event) {
                if (event.data && event.data.id === id) {
                    window.removeEventListener('message', handler);
                    const response = event.data.response;
                    
                    resolve(new Response(JSON.stringify(response.body), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    }));
                }
            };

            window.addEventListener('message', handler);
        });
    };
`;
