import { useEffect, useRef, useState } from 'react';
import { OpenWebContainer, ShellProcess, ProcessEvent } from '@open-web-container/core';

export function useContainer() {
    const containerRef = useRef<OpenWebContainer>();
    const shellRef = useRef<ShellProcess>();
    const [ready, setReady] = useState(false);
    const [output, setOutput] = useState<string[]>([]);

    useEffect(() => {
        async function initContainer() {
            const container = new OpenWebContainer();
            containerRef.current = container;

            // Create a shell process
            const shell = await container.spawn('sh') as ShellProcess;
            shellRef.current = shell;

            // Listen for shell output
            shell.addEventListener(ProcessEvent.MESSAGE, ({ stdout, stderr }) => {
                if (stdout) {
                    setOutput(prev => [...prev, stdout]);
                }
                if (stderr) {
                    setOutput(prev => [...prev, `Error: ${stderr}`]);
                }
            });

            setReady(true);
        }

        initContainer();

        return () => {
            containerRef.current?.dispose();
        };
    }, []);

    const executeCommand = async (command: string) => {
        if (!shellRef.current) return;
        await shellRef.current.executeCommand(command);
    };

    const writeFile = (path: string, content: string) => {
        containerRef.current?.writeFile(path, content);
    };

    return {
        ready,
        output,
        executeCommand,
        writeFile,
        container: containerRef.current
    };
}