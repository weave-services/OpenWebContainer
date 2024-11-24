import { useEffect, useRef, useState } from 'react';
import { ContainerManager } from '@open-web-container/api';


export function useContainer() {
    const containerRef = useRef<ContainerManager | null>(null);
    const [ready, setReady] = useState(false);
    const [servers, setServers] = useState<number[]>([]);

    useEffect(() => {        
        if (!containerRef.current||!ready) return
        let interval = setInterval(() => {
            containerRef.current?.listActiveServers().then((resp)=>{
                let {ports}=resp
                setServers(ports)
        });
        }, 1000);
        return ()=>{
            clearInterval(interval)
        }
    }, [ready]);
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
        servers
    };
}