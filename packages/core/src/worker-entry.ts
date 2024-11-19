import { OpenWebContainer } from './container';
import { Process, ProcessEvent } from './process';

let container: OpenWebContainer;
const processOutputs = new Map<number, string[]>();
const MAX_OUTPUT_BUFFER = 1000; // Maximum lines to keep in buffer

self.onmessage = async function (e) {
    const { type, id, data } = e.data;

    switch (type) {
        case 'spawn':
            try {
                const parentPid:number = data.parentPid;
                const process = await container.spawn(data.command, data.args, parentPid, {
                    env: data.env,
                    cwd: data.cwd
                });

                // Set up process event handlers
                setupProcessHandlers(process);

                self.postMessage({
                    type: 'processStarted',
                    id,
                    data: { pid: process.pid }
                });
            } catch (error:any) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
            break;

        case 'writeProcessInput':
            try {
                const { pid, input } = data;
                const process = container.getProcess(pid);
                if (process) {
                    process.writeInput(input);
                    self.postMessage({ type: 'inputWritten', id });
                } else {
                    throw new Error(`Process ${pid} not found`);
                }
            } catch (error:any) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
            break;

        case 'terminateProcess':
            try {
                const { pid } = data;
                const process = container.getProcess(pid);
                if (process) {
                    await process.terminate();
                    processOutputs.delete(pid);
                    self.postMessage({ type: 'processTerminated', id });
                }
            } catch (error:any) {
                self.postMessage({
                    type: 'error',
                    id,
                    error: error.message
                });
            }
            break;

        // ... other message handlers ...
    }
};

function setupProcessHandlers(process: Process) {
    // Initialize output buffer for this process
    processOutputs.set(process.pid, []);

    process.addEventListener(ProcessEvent.MESSAGE, (data) => {
        // Store output
        const outputs = processOutputs.get(process.pid) || [];
        if (data.stdout) outputs.push(data.stdout);
        if (data.stderr) outputs.push(data.stderr);

        // Trim buffer if too large
        if (outputs.length > MAX_OUTPUT_BUFFER) {
            outputs.splice(0, outputs.length - MAX_OUTPUT_BUFFER);
        }

        processOutputs.set(process.pid, outputs);

        // Send output to main thread
        self.postMessage({
            type: 'processOutput',
            data: {
                pid: process.pid,
                output: data.stdout || data.stderr,
                isError: !!data.stderr
            }
        });
    });

    process.addEventListener(ProcessEvent.EXIT, (data) => {
        self.postMessage({
            type: 'processExit',
            data: {
                pid: process.pid,
                exitCode: data.exitCode
            }
        });
    });
}