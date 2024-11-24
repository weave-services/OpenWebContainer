// src/iframe/types.ts
export interface IframeMessage {
    id: string;
    type: 'request' | 'response';
    payload: any;
}

export interface HostRequest {
    method?: string
    url?: string
    path?: string
    hostname?: string
    port?: number
    headers?: Record<string, string>
    body?: string
}

// src/iframe/bridge.ts
export class IframeBridge {
    private iframe: HTMLIFrameElement;
    private onRequest: (request: HostRequest) => Promise<Response>;
    private messageHandlers: Map<string, (response: any) => void>;
    private port: number;
    private requestId: number = 0;

    constructor(options: {
        port?: number;
        onRequest: (request: HostRequest) => Promise<Response>;
        styles?: Partial<CSSStyleDeclaration>;
    }) {
        this.messageHandlers = new Map();
        this.port = options.port || 3000;
        this.onRequest = options.onRequest;

        // Create and configure iframe
        this.iframe = document.createElement('iframe');
        this.setupIframe(options.styles);
        this.injectInterceptor();

        // Set up message handling
        this.setupMessageHandling();
    }

    private setupIframe(styles?: Partial<CSSStyleDeclaration>) {
        // Apply default styles
        Object.assign(this.iframe.style, {
            border: 'none',
            width: '100%',
            height: '100%',
            ...styles
        });

        // Set sandbox attributes for security
        this.iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');

        // Append to document
        document.body.appendChild(this.iframe);
    }

    private injectInterceptor() {
        // Create the interceptor script
        const interceptorScript = `
// Store original fetch and XHR
const originalFetch = window.fetch;
const originalXHR = window.XMLHttpRequest;

// Helper to check if URL is localhost
function isLocalhost(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1';
    } catch {
        // If URL parsing fails, treat as relative URL which should go through interception
        return true;
    }
}

// Override fetch
window.fetch = function(resource, init) {
    const url = resource instanceof Request ? resource.url : resource;

    // If not localhost, use original fetch
    if (!isLocalhost(url)) {
        return originalFetch(resource, init);
    }

    const request = resource instanceof Request ? resource : new Request(resource, init);
    const messageId = 'fetch_' + Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
        window.parent.postMessage({
            id: messageId,
            type: 'request',
            payload: {
                url,
                method: request.method,
                headers: Object.fromEntries(request.headers.entries()),
                body: request.body ? request.text() : undefined
            }
        }, '*');

        window.addEventListener('message', function handler(event) {
            if (event.data?.id === messageId && event.data?.type === 'response') {
                window.removeEventListener('message', handler);

                const { status, statusText, headers, body } = event.data.payload;
                resolve(new Response(body, {
                    status,
                    statusText,
                    headers: new Headers(headers)
                }));
            }
        });

        setTimeout(() => {
            reject(new Error('Request timeout'));
        }, 30000);
    });
};

// Override XHR
window.XMLHttpRequest = function() {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    let requestData;

    xhr.open = function(method, url, ...args) {
        requestData = { method, url };

        // If not localhost, use original XHR
        if (!isLocalhost(url)) {
            return originalOpen.call(xhr, method, url, ...args);
        }

        return originalOpen.call(xhr, method, url, ...args);
    };

    xhr.send = function(body) {
        // If not localhost, use original send
        if (!isLocalhost(requestData.url)) {
            return originalSend.call(xhr, body);
        }

        const messageId = 'xhr_' + Math.random().toString(36).slice(2);

        window.parent.postMessage({
            id: messageId,
            type: 'request',
            payload: {
                ...requestData,
                body,
                headers: Object.fromEntries(
                    Array.from(xhr.getAllResponseHeaders().split('\r\n'))
                        .filter(Boolean)
                        .map(line => line.split(': '))
                )
            }
        }, '*');

        window.addEventListener('message', function handler(event) {
            if (event.data?.id === messageId && event.data?.type === 'response') {
                window.removeEventListener('message', handler);

                const { status, statusText, headers, body } = event.data.payload;

                Object.defineProperty(xhr, 'status', { value: status });
                Object.defineProperty(xhr, 'statusText', { value: statusText });
                Object.defineProperty(xhr, 'responseText', { value: body });
                Object.defineProperty(xhr, 'response', { value: body });

                xhr.dispatchEvent(new Event('load'));
            }
        });
    };

    return xhr;
};

// Intercept form submissions
document.addEventListener('submit', function(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    // Only intercept localhost form submissions
    if (!isLocalhost(form.action)) {
        return;
    }

    event.preventDefault();

    const formData = new FormData(form);
    const messageId = 'form_' + Math.random().toString(36).slice(2);

    window.parent.postMessage({
        id: messageId,
        type: 'request',
        payload: {
            url: form.action,
            method: form.method,
            headers: {
                'Content-Type': form.enctype
            },
            body: new URLSearchParams(formData).toString()
        }
    }, '*');
});
        `;

        // Inject the script into iframe
        const doc = this.iframe.contentDocument;
        if (doc) {
            const script = doc.createElement('script');
            script.textContent = interceptorScript;
            doc.head.appendChild(script);
        }
    }

    private setupMessageHandling() {
        window.addEventListener('message', async (event) => {
            if (event.source !== this.iframe.contentWindow) return;

            const { id, type, payload } = event.data as IframeMessage;
            if (type !== 'request') return;

            try {
                // Route the request through the container
                const response = await this.handleRequest(payload);

                // Send response back to iframe
                this.iframe.contentWindow?.postMessage({
                    id,
                    type: 'response',
                    payload: response
                }, '*');
            } catch (error:any) {
                // Send error response
                this.iframe.contentWindow?.postMessage({
                    id,
                    type: 'response',
                    payload: {
                        status: 500,
                        statusText: 'Internal Server Error',
                        headers: { 'Content-Type': 'text/plain' },
                        body: error.message
                    }
                }, '*');
            }
        });
    }

    private async handleRequest(requestData: any): Promise<any> {
        const { url, method, headers, body } = requestData;

        // Route through container
        const response = await this.onRequest({
            url,
            method,
            headers,
            body,
        });
        

        // Convert response to transferable format
        return {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: await response.text()
        };
    }

    /**
     * Navigate the iframe to a URL
     */
    async navigate(path: string) {
        const url = `http://localhost:${this.port}${path}`;

        try {
            const response = await this.onRequest({
                method:'GET',
                url,
            }
            );

            const html = await response.text();

            // Write HTML to iframe
            const doc = this.iframe.contentDocument;
            if (doc) {
                doc.open();
                doc.write(html);
                doc.close();
            }
        } catch (error) {
            console.error('Navigation failed:', error);
        }
    }

    /**
     * Set HTML content directly
     */
    setContent(html: string) {
        const doc = this.iframe.contentDocument;
        if (doc) {
            doc.open();
            doc.write(html);
            doc.close();
        }
    }

    /**
     * Get the iframe element
     */
    getElement(): HTMLIFrameElement {
        return this.iframe;
    }

    /**
     * Clean up
     */
    dispose() {
        this.iframe.remove();
    }
}
