import { useEffect, useRef, useState } from 'react';
import { ContainerManager } from '@open-web-container/api';


export function useContainer() {
    const containerRef = useRef<ContainerManager | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        containerRef.current = new ContainerManager();
        containerRef.current.waitForReady().then(() => {
            setReady(true);
        });

        // return () => {
        //     containerRef.current?.dispose();
        // };
    }, []);

    return {
        ready,
        container: containerRef.current,    
    };
}