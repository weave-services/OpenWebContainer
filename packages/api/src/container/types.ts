export interface ContainerOptions {
    debug?: boolean;
    maxProcesses?: number;
    memoryLimit?: number;
}

export interface ContainerStats {
    processes: number;
    memory: number;
    uptime: number;
}