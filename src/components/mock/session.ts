export interface Environment {
    [key: string]: string;
}

export interface DirectoryStack {
    current: string;
    previous: string;
    stack: string[];
}

export class Session {
    private env: Environment;
    private dirStack: DirectoryStack;

    constructor(initialDir: string = '/') {
        this.dirStack = {
            current: initialDir,
            previous: initialDir,
            stack: []
        };

        this.env = {
            HOME: '/home/user',
            PATH: '/bin:/usr/bin',
            PWD: initialDir,
            OLDPWD: initialDir,
            SHELL: '/bin/shell',
            USER: 'user',
            TERM: 'xterm-256color'
        };
    }

    // Environment methods
    getEnv(key: string): string | undefined {
        return this.env[key];
    }

    setEnv(key: string, value: string): void {
        this.env[key] = value;
    }

    getAllEnv(): Environment {
        return { ...this.env };
    }

    // Directory management
    getCurrentDirectory(): string {
        return this.dirStack.current;
    }

    getPreviousDirectory(): string {
        return this.dirStack.previous;
    }

    changeDirectory(newDir: string): void {
        this.dirStack.previous = this.dirStack.current;
        this.dirStack.current = newDir;
        this.env.PWD = newDir;
        this.env.OLDPWD = this.dirStack.previous;
    }

    // Directory stack management
    pushDirectory(dir: string): void {
        this.dirStack.stack.push(this.dirStack.current);
        this.changeDirectory(dir);
    }

    popDirectory(): string | undefined {
        const previousDir = this.dirStack.stack.pop();
        if (previousDir) {
            this.changeDirectory(previousDir);
        }
        return previousDir;
    }

    getDirectoryStack(): string[] {
        return [...this.dirStack.stack];
    }
}