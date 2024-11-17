import { Process } from "./base";

/**
 * Process Manager to handle multiple processes
 */
class ProcessManager {
    private processes: Map<number, Process>;
    private nextPid: number;

    constructor() {
        this.processes = new Map();
        this.nextPid = 1;
    }

    getNextPid(): number {
        return this.nextPid++;
    }

    addProcess(process: Process): void {
        this.processes.set(process.pid, process);
    }

    getProcess(pid: number): Process | undefined {
        return this.processes.get(pid);
    }

    removeProcess(pid: number): boolean {
        return this.processes.delete(pid);
    }

    listProcesses(): Process[] {
        return Array.from(this.processes.values());
    }

    async killAll(): Promise<void> {
        const processes = this.listProcesses();
        await Promise.all(processes.map(process => process.terminate()));
        this.processes.clear();
    }
}