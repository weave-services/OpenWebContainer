import { useEffect, useRef, useState } from 'react';
import { OpenWebContainer } from '@open-web-container/core';


export function useContainer() {
    const containerRef = useRef<OpenWebContainer | null>(null);
    const [ready, setReady] = useState(false);
    const [output, setOutput] = useState<string[]>([]);

    useEffect(() => {
        containerRef.current = new OpenWebContainer();
        setReady(true);

        return () => {
            containerRef.current?.dispose();
        };
    }, []);

    // Set up output handling
    useEffect(() => {
        if (!containerRef.current) return;

        const unsubscribe = containerRef.current.onOutput((newOutput:string) => {
            setOutput(prev => [...prev, newOutput]);
        });

        return unsubscribe;
    }, [containerRef.current]);

    return {
        ready,
        output,
        container: containerRef.current,    
    };
}