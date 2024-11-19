import { SpawnPayload, WorkerMessage, WorkerRequestMessage, WorkerResponse, WorkerResponseMessage } from 'worker-code';
import { OpenWebContainer } from './container';
import { Process, ProcessEvent } from './process';

let container: OpenWebContainer;
const processOutputs = new Map<number, string[]>();
const MAX_OUTPUT_BUFFER = 1000; // Maximum lines to keep in buffer


self.onmessage = async function (e:MessageEvent<WorkerMessage>) {
    const { type, id } = e.data;

    switch (type) {
        case 'initialize':
            let { payload } = e.data;
            // Initialize container when worker starts
            container = new OpenWebContainer({ debug: payload.debug });
            // Send back confirmation
            sendWorkerResponse({ type: 'initialized', id });
            break;
        case 'spawn':
            try {
                let payload:SpawnPayload = e.data.payload;
                
                const process = await container.spawn(payload.command, payload.args, payload.parentPid, {
                    env: payload.options.env,
                    cwd: payload.options.cwd
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

        case 'writeInput':
            try {
                const { payload } = e.data;
                const { pid, input } = payload;
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

        case 'terminate':
            try {
                const { payload } = e.data;
                const { pid } = payload;
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
        
        case 'getStats':
            try {
                const stats = {
                    network: container.getNetworkStats(),
                    processes: container.listProcesses().map(p => ({
                        pid: p.pid,
                        type: p.type,
                        state: p.state,
                        uptime: p.uptime
                    }))
                };
                sendWorkerResponse({ type: 'stats', id, payload: stats });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
        
        case 'dispose':
            try {
                await container.dispose();
                sendWorkerResponse({ type: 'disposed', id });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;

        // ... other message handlers ...
        case 'writeFile':
            try {
                const { pid, path, content } = e.data.payload;
                await container.writeFile(path, content);
                sendWorkerResponse({
                    type: 'success',
                    id,
                });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
        case 'readFile':
            try {
                const { pid, path } = e.data.payload;
                const content = await container.readFile(path);
                sendWorkerResponse({
                    type: 'success',
                    id,
                    payload: { content }
                });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
        case 'deleteFile':
            try {
                const { pid, path, recursive } = e.data.payload;
                await container.deleteFile(path);
                sendWorkerResponse({
                    type: 'success',
                    id,
                });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
        case 'listFiles':
            try {
                const { pid, path } = e.data.payload;
                const files = await container.listFiles(path);
                sendWorkerResponse({
                    type: 'success',
                    id,
                    payload: { files }
                });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
        case 'createDirectory':
            try {
                const { pid, path } = e.data.payload;
                await container.createDirectory(path);
                sendWorkerResponse({
                    type: 'success',
                    id,
                });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
        case 'listDirectory':
            try {
                const { pid, path } = e.data.payload;
                const files = await container.listDirectory(path);
                sendWorkerResponse({
                    type: 'success',
                    id,
                    payload: { files }
                });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
        case 'deleteDirectory':
            try {
                const { pid, path } = e.data.payload;
                await container.deleteDirectory(path);
                sendWorkerResponse({
                    type: 'success',
                    id,
                });
            }
            catch (error: any) {
                sendWorkerResponse({
                    type: 'error',
                    id,
                    payload: { error: error.message }
                });
            }
            break;
    }
};

function sendWorkerResponse(response: WorkerResponse) {
    self.postMessage(response);
}

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