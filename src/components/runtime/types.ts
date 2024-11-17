import { Backend, MountConfiguration } from "@zenfs/core";

export interface RuntimeOptions {
    enableFileSystem?: boolean;
    enableNetworking?: boolean;
    debug?: boolean;
    debugSandbox?: boolean;
    initialFiles?: { [key: string]: string };
    mounts?: {
        [path: string]: MountConfiguration<Backend>;
    };
}

export interface Process {
    env: { [key: string]: string | undefined };
    argv: string[];
    pid: number;
    platform: string;
    version: string;
    nextTick(callback: (...args: any[]) => void): void;
}

export interface Module {
    exports: any;
    require: (path: string) => any;
    id: string;
    filename: string;
    loaded: boolean;
    paths: string[];
}

export interface SandboxWindow extends Window {
    Function: FunctionConstructor;
    secureFunction?: FunctionConstructor;
    secureEval?: (code: string) => any;
}