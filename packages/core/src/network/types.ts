export type ServerType = 'http' | 'https' | 'tcp' | 'udp' | 'ws' | 'wss';

export interface VirtualServer {
    pid: number;
    port: number;
    type: ServerType;
    status: 'running' | 'stopped';
    options?: {
        host?: string;
        backlog?: number;
        path?: string;
    };
}

export interface SocketConnection {
    id: string;
    serverId: string;
    remoteAddress: string;
    remotePort: number;
    localAddress: string;
    localPort: number;
}

export interface NetworkStats {
    servers: {
        total: number;
        active: number;
        byType: Record<ServerType, number>;
    };
    connections: {
        total: number;
        active: number;
        byServer: Record<string, number>;
    };
    traffic: {
        bytesReceived: number;
        bytesSent: number;
        requestsTotal: number;
        requestsSuccess: number;
        requestsFailed: number;
        avgResponseTime: number;
    };
    requestsPerMinute: number;
}

export interface ServerStats {
    requestsTotal: number;
    requestsSuccess: number;
    requestsFailed: number;
    bytesReceived: number;
    bytesSent: number;
    connections: number;
    startTime: Date;
}