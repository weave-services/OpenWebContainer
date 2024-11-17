import { OutputChunk, OSC, createTextStreamPair } from './utils';

export class StreamOutputController {
    private readable: ReadableStream<OutputChunk>;
    private writable: WritableStream<OutputChunk>;
    private transformer: TransformStream<OutputChunk, OutputChunk>;
    private chunks: OutputChunk[] = [];
    private writer: WritableStreamDefaultWriter<OutputChunk>;
    private inputWrite: WritableStream<string>;
    private inputReader: ReadableStreamDefaultReader<string>;
    private currentBuffer: string = '';

    constructor() {
        const [inputRead, inputWrite] = createTextStreamPair();
        this.inputWrite = inputWrite;
        this.inputReader = inputRead.getReader();

        // Create transform stream for processing chunks
        this.transformer = new TransformStream({
            transform: async (chunk: OutputChunk, controller) => {
                this.chunks.push(chunk);
                controller.enqueue(chunk);
            }
        });

        // Set up readable/writable pair
        const { readable, writable } = this.transformer;
        this.readable = readable;
        this.writable = writable;
        this.writer = this.writable.getWriter();
    }

    get output() {
        return this.readable;
    }

    get input() {
        return this.inputWrite;
    }

    getInputReader() {
        return this.inputReader;
    }

    async emit(content: string, type: OutputChunk['type'] = 'info'): Promise<void> {
        const chunk: OutputChunk = { content, type };
        await this.writer.write(chunk);
    }

    async close(): Promise<void> {
        try {
            await this.writer.close();
        } catch (error) {
            console.error('Error closing writer:', error);
        }
    }

    async readLine(): Promise<string> {
        let line = '';

        try {
            while (true) {
                const { value, done } = await this.inputReader.read();
                if (done) break;

                // Process each character in the input
                for (const char of value) {
                    const code = char.charCodeAt(0);

                    if (code === 13) { // Carriage return
                        // Clear the current line but don't add to result yet
                        this.currentBuffer = '';
                        continue;
                    }

                    if (code === 10) { // Line feed (\n)
                        // Return the completed line
                        const result = this.currentBuffer;
                        this.currentBuffer = '';
                        return result;
                    }

                    if (code === 127) { // Backspace
                        // Remove the last character from the buffer
                        this.currentBuffer = this.currentBuffer.slice(0, -1);
                        continue;
                    }

                    // Add normal characters to the buffer
                    this.currentBuffer += char;
                }
            }
        } catch (error) {
            console.error('Error reading line:', error);
            throw error;
        }

        // If we get here, the stream is closed
        // Return whatever is in the buffer
        const result = this.currentBuffer;
        this.currentBuffer = '';
        return result;
    }
    async read(): Promise<{ value?: string, done: boolean }> {
        let { value, done } = await this.inputReader.read();
        return { value: value, done };
    }

    getAllChunks(): OutputChunk[] {
        return this.chunks;
    }

    getReader(): ReadableStreamDefaultReader<OutputChunk> {
        return this.readable.getReader();
    }
}