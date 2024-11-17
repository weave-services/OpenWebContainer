import { ProcessEvent, ProcessState, ProcessType } from "../interfaces";
import { Process } from "./base";

/**
 * JavaScript Process Implementation
 */
export class JavaScriptProcess extends Process {
    private runtime: any; // QuickJSRuntime
    private context: any; // QuickJSContext

    constructor(
        pid: number,
        executablePath: string,
        args: string[],
        runtime: any,
        context: any
    ) {
        super(pid, ProcessType.JAVASCRIPT, executablePath, args);
        this.runtime = runtime;
        this.context = context;
    }

    async start(): Promise<void> {
        try {
            this._state = ProcessState.RUNNING;
            this.emit(ProcessEvent.START, { pid: this.pid });

            const result = await this.context.evalCode(
                `import('${this.executablePath}');`,
                this.executablePath,
                { type: 'module' }
            );

            if (result.error) {
                const error = this.context.dump(result.error);
                result.error.dispose();
                throw new Error(error);
            }

            result.value.dispose();
            this._state = ProcessState.COMPLETED;
            this._exitCode = 0;
            this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
        } catch (error) {
            this._state = ProcessState.FAILED;
            this._exitCode = 1;
            this.emit(ProcessEvent.ERROR, { pid: this.pid, error });
            this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
            throw error;
        }
    }

    async terminate(): Promise<void> {
        if (this.state !== ProcessState.RUNNING) {
            return;
        }

        this._state = ProcessState.TERMINATED;
        this._exitCode = -1;

        this.context.dispose();
        this.runtime.dispose();

        this.emit(ProcessEvent.EXIT, { pid: this.pid, exitCode: this._exitCode });
    }
}