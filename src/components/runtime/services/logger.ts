export class Logger {
    private debugLog: string[] = [];
    private debug: boolean;
    private debugSandbox: boolean;

    constructor(debug: boolean, debugSandbox: boolean) {
        this.debug = debug;
        this.debugSandbox = debugSandbox;
    }

    log(message: string, data?: any) {
        if (this.debug || this.debugSandbox) {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] ${message}`;
            this.debugLog.push(logMessage);

            console.group('🏃 Runtime Debug');
            console.log(logMessage);
            if (data) {
                console.log('Data:', data);
            }
            console.groupEnd();
        }
    }

    getLogs(): string[] {
        return [...this.debugLog];
    }

    clearLogs(): void {
        this.debugLog = [];
    }
}