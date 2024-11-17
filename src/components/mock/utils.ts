export interface OutputChunk {
    content: string;
    type: 'error' | 'warning' | 'info' | 'success' | 'prompt';
}
export const OSC = {
    // Basic formatting
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',

    // Terminal control
    clearLine: '\x1b[2K',
    cursorUp: '\x1b[1A',
    cursorToColumn0: '\x1b[0G',

    // OSC 7 for current working directory
    setCwd: (dir: string) => `\x1b]7;file://${encodeURIComponent(dir)}\x07`,

    // OSC 133 for shell integration
    commandStart: '\x1b]133;A\x07',
    commandEnd: '\x1b]133;B\x07',
    prePrompt: '\x1b]133;C\x07',
    commandExecuted: (exitCode: number) => `\x1b]133;D;${exitCode}\x07`,

    // OSC 133 prompt markers
    promptStart: '\x1b]133;P;k=i\x07',
    continuationPromptStart: '\x1b]133;P;k=s\x07',
    rightPromptStart: '\x1b]133;P;k=r\x07',

    // OSC 133 command status
    commandContinuation: '\x1b]133;A;k=s\x07',
    commandComplete: '\x1b]133;C\x07',

    // OSC 1337 for terminal marks
    markStart: '\x1b]1337;SetMark\x07',

    // File annotations (iTerm2 specific)
    startFileAnnotation: (file: string, line?: number) =>
        `\x1b]1337;File=name=${btoa(file)}${line ? `;line=${line}` : ''}\x07`,
    endFileAnnotation: '\x1b]1337;EndFile\x07'
};


export const formatPath = (path: string, currentPath = "/"): string => {
    if (!path.startsWith("/")) {
        path = currentPath === "/" ? `/${path}` : `${currentPath}/${path}`;
    }
    const parts = path.split("/").filter(Boolean);
    const resolvedParts: string[] = [];
    for (const part of parts) {
        if (part === "..") {
            resolvedParts.pop();
        } else if (part !== ".") {
            resolvedParts.push(part);
        }
    }
    return `/${resolvedParts.join("/")}`;
};

export function formatTerminalOutput(output: string): string {
    // Split output into lines, trim trailing spaces, and recombine
    return output
        .split('\n')
        .map(line => line.trimEnd())  // Remove trailing spaces
        .join('\r\n');  // Use CRLF for terminal
}
/**
 * Creates a ReadableStream that emits values written to a WritableStream
 * @returns Tuple of [readable, writable] streams
 */
export function createStreamPair<T>(): [ReadableStream<T>, WritableStream<T>] {
    let controller: ReadableStreamDefaultController<T>;

    const readable = new ReadableStream<T>({
        start(c) {
            controller = c;
        }
    });

    const writable = new WritableStream<T>({
        write(chunk) {
            controller.enqueue(chunk);
        },
        close() {
            controller.close();
        },
        abort(reason) {
            controller.error(reason);
        }
    });

    return [readable, writable];
}

// For convenience, also create a text-specific version
export function createTextStreamPair(): [ReadableStream<string>, WritableStream<string>] {
    return createStreamPair<string>();
}

/**
 * Creates a ReadableStream from a text string
 * @param text The text to stream
 * @returns ReadableStream that emits the text
 */
export function createChunkReadableStream(
    text: string,
    type: OutputChunk['type'] = 'info',
): ReadableStream<OutputChunk> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue({
                content: text,
                type,
            });
            controller.close();
        }
    });
}

export async function pipeReaderToWritableText(
    reader: ReadableStreamDefaultReader<string>,
    writer: WritableStreamDefaultWriter<string>
): Promise<void> {
    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            await writer.write(value);
        }
    } catch (error) {
        console.error('Error while piping stream:', error);
        throw error;
    } finally {
        // Release the writer lock
        await writer.close();
        // Release the reader lock
        await reader.releaseLock();
    }
}


export const path = {

    join: (...parts: string[]) => {
        return parts.map(part => part.replace(/^\/+|\/+$/g, '')).filter(x => x).join('/');
    },

    dirname: (filePath: string) => {
        // Handle empty or invalid paths
        if (!filePath) return '';

        // Remove trailing slash if present
        filePath = filePath.replace(/\/$/, '');

        // Get everything up to the last slash
        const lastSlashIndex = filePath.lastIndexOf('/');
        return lastSlashIndex === -1 ? '' : filePath.substring(0, lastSlashIndex);
    },
    isAbsolute: (path: string) => {
        // Check if path starts with '/' or contains '://'
        return path.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(path) || /^[a-zA-Z]+:\/\//.test(path);
    },

    normalize: (path: string) => {
        // Remove multiple slashes and handle . and ..
        const parts = path.replace(/\/+/g, '/').split('/');
        const result = [];

        for (const part of parts) {
            if (part === '.' || part === '') continue;
            if (part === '..') {
                result.pop();
            } else {
                result.push(part);
            }
        }

        // Preserve leading slash if path was absolute
        let normalizedPath = result.join('/');
        if (path.startsWith('/')) {
            normalizedPath = '/' + normalizedPath;
        }

        return normalizedPath || '.';
    }
}