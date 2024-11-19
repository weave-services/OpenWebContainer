import { ProcessEvent } from "../../process";
import { ShellCommandResult } from "../types";
import { CommandHelp, ShellCommand } from "./base";


interface WgetOptions {
    outputFilename?: string;
    quiet?: boolean;
    noCheck?: boolean;
    continue?: boolean;
    headers: Record<string, string>;
    timeout?: number;
    retries?: number;
    debug?: boolean;
    noCheckCertificate?: boolean;
}

export class WgetCommand extends ShellCommand {
    get help(): CommandHelp {
        return {
            name: 'wget',
            description: 'Download files from the web',
            usage: 'wget [options] URL\n' +
                'Options:\n' +
                '  -O <file>  Save to specific file\n' +
                '  -q         Quiet mode\n' +
                '  --header   Add custom header',
            examples: [
                'wget https://example.com/file.txt',
                'wget -O custom.txt https://example.com/file.txt',
                'wget --header "Authorization: Bearer token" https://api.com/data'
            ]
        };
    }

    async execute(args: string[]): Promise<ShellCommandResult> {
        if (args.length === 0) {
            return {
                stdout: '',
                stderr: 'wget: missing URL\nUsage: wget [options] URL\n',
                exitCode: 1
            };
        }

        // Parse options
        const options: WgetOptions = { headers: {} };
        const urls: string[] = [];

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            switch (arg) {
                case '-O':
                    options.outputFilename = args[++i];
                    break;
                case '-q':
                    options.quiet = true;
                    break;
                case '--no-check-certificate':
                    options.noCheck = true;
                    options.noCheckCertificate = true;
                    break;
                case '-c':
                    options.continue = true;
                    break;
                case '--debug':
                    options.debug = true;
                    break;
                case '--header':
                case '-H':
                    const headerStr = args[++i];
                    const [key, ...valueParts] = headerStr.split(':');
                    const value = valueParts.join(':').trim();
                    options.headers[key.trim()] = value;
                    break;
                case '--timeout':
                    options.timeout = parseInt(args[++i]) * 1000; // Convert to milliseconds
                    break;
                case '-t':
                    options.retries = parseInt(args[++i]);
                    break;
                default:
                    if (!arg.startsWith('-')) {
                        urls.push(arg);
                    } else {
                        return {
                            stdout: '',
                            stderr: `wget: unknown option ${arg}\n`,
                            exitCode: 1
                        };
                    }
            }
        }

        let stdout = '';
        let stderr = '';
        let exitCode = 0;

        for (const url of urls) {
            try {
                const result = await this.downloadFile(url, options);
                stdout += result.stdout;
                stderr += result.stderr;
                if (result.exitCode !== 0) exitCode = result.exitCode;
            } catch (error: any) {
                stderr += `wget: ${error.message}\n`;
                exitCode = 1;
            }
        }

        return { stdout, stderr, exitCode };
    }
    private async downloadFile(url: string, options: WgetOptions): Promise<ShellCommandResult> {
        const debugLog: string[] = [];
        const debug = (msg: string) => {
            if (options.debug) {
                const timestamp = new Date().toISOString();
                const logMessage = `[DEBUG ${timestamp}] ${msg}`;
                debugLog.push(logMessage);
                this.log(logMessage);
            }
        };

        try {
            debug('Starting download process');
            debug(`URL: ${url}`);
            debug(`Options: ${JSON.stringify(options, null, 2)}`);

            let response: Response | null = null;
            let proxyUsed: string | null = null;

            // Try direct fetch first
            try {
                debug('Attempting direct fetch...');
                const fetchOptions = {
                    headers: {
                        'User-Agent': 'wget/1.21.3',
                        ...options.headers
                    }
                };
                debug(`Fetch options: ${JSON.stringify(fetchOptions, null, 2)}`);

                response = await fetch(url, fetchOptions);
                debug(`Direct fetch response status: ${response.status}`);

                if (response.ok) {
                    debug('Direct fetch successful');
                } else {
                    debug(`Direct fetch failed with status ${response.status}`);
                    response = null;
                }
            } catch (error: any) {
                debug(`Direct fetch failed: ${error.message}`);
                debug('Falling back to CORS proxies');
                response = null;
            }

            // If direct fetch failed, try proxies
            if (!response || !response.ok) {
                const corsProxies = [
                    'https://corsproxy.io/?',
                    'https://api.allorigins.win/raw?url=',
                    'https://cors-anywhere.herokuapp.com/'
                ];

                for (const proxy of corsProxies) {
                    const proxyUrl = `${proxy}${encodeURIComponent(url)}`;
                    debug(`Attempting proxy: ${proxy}`);
                    debug(`Full proxy URL: ${proxyUrl}`);

                    try {
                        response = await fetch(proxyUrl, {
                            headers: {
                                'User-Agent': 'wget/1.21.3',
                                ...options.headers
                            }
                        });

                        debug(`Proxy response status: ${response.status}`);
                        if (response.ok) {
                            proxyUsed = proxy;
                            debug(`Successfully connected using proxy: ${proxy}`);
                            break;
                        } else {
                            debug(`Proxy ${proxy} returned status ${response.status}`);
                        }
                    } catch (e: any) {
                        debug(`Proxy ${proxy} failed with error: ${e.message}`);
                        continue;
                    }
                }
            }

            if (!response || !response.ok) {
                debug('All fetch attempts failed');
                throw new Error(`Failed to fetch (HTTP ${response?.status || 'unknown'})`);
            }

            // Get filename
            let filename = options.outputFilename;
            const contentDisposition = response.headers.get('content-disposition');
            debug(`Content-Disposition: ${contentDisposition}`);

            if (!filename) {
                if (contentDisposition) {
                    const matches = /filename=["']?([^"']+)["']?/.exec(contentDisposition);
                    if (matches?.[1]) {
                        filename = matches[1];
                        debug(`Filename from Content-Disposition: ${filename}`);
                    }
                }
                if (!filename) {
                    filename = new URL(url).pathname.split('/').pop() || 'index.html';
                    debug(`Filename from URL: ${filename}`);
                }
            }

            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            debug(`Expected content length: ${total} bytes`);

            let received = 0;
            debug('Starting chunked download...');

            // Use an array to store chunks
            const chunks: Uint8Array[] = [];
            const reader = response.body?.getReader();

            if (!reader) {
                debug('Failed to get response body reader');
                throw new Error('Unable to read response');
            }

            const startTime = Date.now();
            let lastProgressUpdate = startTime;

            // Read chunks
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    debug('Download complete');
                    break;
                }

                // Store the chunk
                chunks.push(value);
                received += value.length;

                // Update progress every 100ms
                const now = Date.now();
                if (!options.quiet && now - lastProgressUpdate > 100) {
                    const percent = total ? Math.round((received / total) * 100) : 0;
                    const speed = (received / (now - startTime)) * 1000;
                    this.log(`\rProgress: ${percent}% of ${this.formatSize(total)} at ${this.formatSpeed(speed)}`, false);
                    lastProgressUpdate = now;
                }

                if (options.debug && received % (1024 * 1024) === 0) {
                    debug(`Downloaded ${this.formatSize(received)} so far`);
                }
            }

            // Combine all chunks into a single Uint8Array
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const combinedArray = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                combinedArray.set(chunk, offset);
                offset += chunk.length;
            }

            // Convert to base64 for storage
            // const base64Content = this.uint8ArrayToBase64(combinedArray);

            // Save the complete file
            const fullPath = this.resolvePath(filename);
            this.fileSystem.writeBuffer(fullPath, combinedArray as Buffer);

            const duration = (Date.now() - startTime) / 1000;
            const finalSpeed = received / duration;

            if (!options.quiet) {
                this.log('\n');  // New line after progress
                this.log(`Saved to: '${filename}'`);
                this.log(`100% [${this.formatSize(received)}] ${this.formatSpeed(finalSpeed)}`);
                this.log(`Total time: ${duration.toFixed(2)}s`);
                if (proxyUsed) {
                    this.log(`Note: Used CORS proxy due to browser restrictions`);
                }
            }

            debug(`Download completed in ${duration.toFixed(2)} seconds`);
            debug(`Average speed: ${this.formatSpeed(finalSpeed)}`);

            return this.success();

        } catch (error: any) {
            debug(`Fatal error: ${error.message}`);
            if (error.stack) debug(`Error stack: ${error.stack}`);

            if (options.debug) {
                return this.error([
                    `Download failed: ${error.message}`,
                    '',
                    '=== Debug Log ===',
                    ...debugLog
                ].join('\n'));
            }

            return this.error(`Download failed: ${error.message}`);
        }
    }

    private uint8ArrayToBase64(array: Uint8Array): string {
        const chunkSize = 32 * 1024; // 32KB chunks
        let base64 = '';

        for (let i = 0; i < array.length; i += chunkSize) {
            const chunk = array.slice(i, i + chunkSize);
            base64 += btoa(
                Array.from(chunk)
                    .map(byte => String.fromCharCode(byte))
                    .join('')
            );
        }

        return base64;
    }

    private formatSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unit = 0;
        while (size >= 1024 && unit < units.length - 1) {
            size /= 1024;
            unit++;
        }
        return `${size.toFixed(1)}${units[unit]}`;
    }

    private formatSpeed(bytesPerSecond: number): string {
        return `${this.formatSize(bytesPerSecond)}/s`;
    }

    private log(message: string, newline: boolean = true) {
        this.process.emit(ProcessEvent.MESSAGE, { stdout: message + (newline ? '\n' : '') });
    }

}