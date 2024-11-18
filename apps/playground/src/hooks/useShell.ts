import { OpenWebContainer, Process, ProcessEvent, ShellProcess} from '@open-web-container/core';
import { useState, useEffect, useCallback, useRef } from 'react';
interface UseShellOptions {
    osc?: boolean;
    initialCommands?: string[];
}

export function useShell(container: OpenWebContainer | null, options: UseShellOptions = {}) {
    const [ready, setReady] = useState(false);
    const [output, setOutput] = useState<string[]>([]);
    const processRef = useRef<Process | null>(null);
    const { osc = true, initialCommands = [] } = options;

    // Initialize shell process when container is available
    useEffect(() => {
        if (!container) return;

        async function initShell(container: OpenWebContainer) {
            try {
                const args = osc ? ['--osc'] : [];
                const process = await container.spawn('sh', args);

                if (!(process instanceof Process)) {
                    throw new Error('Failed to create shell process');
                }

                // Store the process reference
                processRef.current = process;

                // Set up process event listeners
                process.addEventListener(ProcessEvent.MESSAGE, (data) => {
                    if (data.stdout) setOutput((prev:string[]) => [...prev, data.stdout||'']);
                    if (data.stderr) setOutput((prev:string[]) => [...prev, data.stderr||'']);
                });

                process.addEventListener(ProcessEvent.ERROR, (data) => {
                    if (data.error) setOutput(prev => [...prev, `Error: ${data.error.message}\n`]);
                });

                process.addEventListener(ProcessEvent.EXIT, () => {
                    setReady(false);
                    processRef.current = null;
                });

                setReady(true);

                // Execute initial commands if any
                for (const cmd of initialCommands) {
                    process.writeInput(cmd + '\r');
                }
            } catch (error) {
                console.error('Failed to initialize shell:', error);
                setReady(false);
            }
        }

        initShell(container);

        // Cleanup
        return () => {
            const process = processRef.current;
            if (process) {
                process.terminate();
                processRef.current = null;
                setReady(false);
            }
        };
    }, [container]);

    const sendCommand = useCallback(async (input: string) => {
        if (!processRef.current || !ready) {
            throw new Error('Shell is not ready');
        }

        try {
            processRef.current.writeInput(input);
        } catch (error) {
            console.error('Failed to send command:', error);
            throw error;
        }
    }, [ready]);

    const clearOutput = useCallback(() => {
        setOutput([]);
    }, []);

    return {
        ready,
        output,
        sendCommand,
        clearOutput,
        shell: processRef.current
    };
}