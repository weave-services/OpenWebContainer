import { BaseCommand, OptionDefinition, CommandOptionsDefinition } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { formatPath, path } from "./utils";
import { fs } from "@zenfs/core";

interface MkdirOptionsDefinition extends CommandOptionsDefinition {
    parents: OptionDefinition<boolean>;
    mode: OptionDefinition<number>;
    verbose: OptionDefinition<boolean>;
}

interface CreateDirectoryOptions {
    parents: boolean;
    mode: number;
    verbose: boolean;
}

export class MkdirCommand extends BaseCommand<MkdirOptionsDefinition> {
    get commandName(): string {
        return 'mkdir';
    }

    protected get optionsDefinition(): MkdirOptionsDefinition {
        return {
            parents: {
                type: 'boolean',
                value: false,
                description: 'Create parent directories as needed',
                shortFlag: 'p',
                longFlag: 'parents'
            },
            mode: {
                type: 'number',
                value: 0o777,
                description: 'Set file mode (permissions)',
                shortFlag: 'm',
                longFlag: 'mode'
            },
            verbose: {
                type: 'boolean',
                value: false,
                description: 'Print a message for each created directory',
                shortFlag: 'v',
                longFlag: 'verbose'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        if (!this.validateArgs(args)) {
            return this.output;
        }

        try {
            const { options, targets } = this.parseOptions(args);

            for (const target of targets) {
                try {
                    await this.createDirectory(target, options);
                } catch (error: any) {
                    if (error?.code === 'EEXIST' && !options.parents) {
                        this.handleError(new Error(`cannot create directory '${target}': File exists`), target);
                    } else if (error?.code === 'EACCES') {
                        this.handleError(new Error(`cannot create directory '${target}': Permission denied`), target);
                    } else {
                        this.handleError(error, target);
                    }
                }
            }
        } catch (error: any) {
            // Handle parsing errors
            this.output.emit(error.message, 'error');
        }
        await this.finish();
        return this.output;
    }

    private async createDirectory(targetPath: string, options: CreateDirectoryOptions): Promise<void> {
        const resolvedPath = this.resolvePath(targetPath);

        // Validate path
        this.validatePath(resolvedPath);

        try {
            if (options.parents) {
                await this.createParentDirectories(resolvedPath, options);
            } else {
                await this.createSingleDirectory(resolvedPath, options);
            }
        } catch (error) {
            throw error;
        }
    }

    private resolvePath(targetPath: string): string {
        if (path.isAbsolute(targetPath)) {
            return path.normalize(targetPath);
        }
        return path.normalize(path.join(this.session.getCurrentDirectory(), targetPath));
    }

    private validatePath(targetPath: string): void {
        if (!targetPath) {
            throw new Error('mkdir: empty path');
        }

        // Check for invalid characters
        const invalidChars = /[\0]/;
        if (invalidChars.test(targetPath)) {
            throw new Error('mkdir: path contains invalid characters');
        }

        // Check if path is too long (typical max path length is 4096)
        if (targetPath.length > 4096) {
            throw new Error('mkdir: path too long');
        }

        // Check if path ends with '/' or '.'
        if (targetPath.endsWith('/') || targetPath.endsWith('/.')) {
            throw new Error('mkdir: path cannot end with "/" or "/."');
        }
    }

    private async createParentDirectories(dirPath: string, options: CreateDirectoryOptions): Promise<void> {
        const parts = dirPath.split('/').filter(Boolean);
        let currentPath = '';

        for (const part of parts) {
            currentPath = currentPath ? path.join(currentPath, part) : `/${part}`;

            try {
                await this.createSingleDirectory(currentPath, {
                    ...options,
                    // Only show verbose output for the final directory
                    verbose: options.verbose && currentPath === dirPath
                });
            } catch (error: any) {
                // Ignore EEXIST when using -p
                if (error.code !== 'EEXIST') {
                    throw error;
                }
            }
        }
    }

    private async createSingleDirectory(dirPath: string, options: CreateDirectoryOptions): Promise<void> {
        try {
            // Check if directory already exists
            try {
                const stats = await fs.promises.stat(dirPath);
                if (stats.isDirectory()) {
                    if (!options.parents) {
                        throw { code: 'EEXIST' };
                    }
                    return;
                }
                // Path exists but is not a directory
                throw new Error(`${dirPath} exists but is not a directory`);
            } catch (error: any) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }

            // Create the directory with specified mode
            await fs.promises.mkdir(dirPath, {
                mode: options.mode,
                recursive: false
            });

            if (options.verbose) {
                this.output.emit(`created directory '${dirPath}'`, 'success');
            }

            // Verify the directory was created with correct permissions
            const stats = await fs.promises.stat(dirPath);
            const actualMode = stats.mode & 0o777;
            if (actualMode !== (options.mode & 0o777)) {
                // Warning if permissions don't match (could happen due to umask)
                this.output.emit(
                    `warning: created directory '${dirPath}' with mode ` +
                    `${actualMode.toString(8)} instead of ${options.mode.toString(8)}`,
                    'warning'
                );
            }

        } catch (error: any) {
            if (error.code === 'EACCES') {
                throw new Error(`permission denied`);
            } else if (error.code === 'ENOSPC') {
                throw new Error(`no space left on device`);
            } else {
                throw error;
            }
        }
    }

    // Helper method to parse octal or symbolic modes
    private parseModeString(modeStr: string): number {
        // Handle symbolic mode (e.g., "u=rwx,g=rx,o=rx")
        if (modeStr.includes('=') || modeStr.includes('+') || modeStr.includes('-')) {
            return this.parseSymbolicMode(modeStr);
        }

        // Handle octal mode
        const octalMode = parseInt(modeStr, 8);
        if (isNaN(octalMode) || octalMode < 0 || octalMode > 0o777) {
            throw new Error(`invalid mode: ${modeStr}`);
        }
        return octalMode;
    }

    private parseSymbolicMode(modeStr: string): number {
        let mode = 0o666; // Start with standard permission

        const parts = modeStr.split(',');
        for (const part of parts) {
            const match = part.match(/^([ugoa]*)([-+=])([rwx]*)$/);
            if (!match) {
                throw new Error(`invalid mode: ${modeStr}`);
            }

            const [, who, op, perm] = match;
            const permissions = {
                r: 0b100,
                w: 0b010,
                x: 0b001
            };

            let mask = 0;
            for (const p of perm) {
                if (!(p in permissions)) {
                    throw new Error(`invalid permission: ${p}`);
                }
                mask |= permissions[p as keyof typeof permissions];
            }

            const targets = who || 'ugo';
            for (const target of targets) {
                let shift: number;
                switch (target) {
                    case 'u': shift = 6; break;
                    case 'g': shift = 3; break;
                    case 'o': shift = 0; break;
                    case 'a':
                        this.applyPermissionToMode(mode, mask, op, 6);
                        this.applyPermissionToMode(mode, mask, op, 3);
                        this.applyPermissionToMode(mode, mask, op, 0);
                        continue;
                    default:
                        throw new Error(`invalid target: ${target}`);
                }
                mode = this.applyPermissionToMode(mode, mask, op, shift);
            }
        }

        return mode;
    }

    private applyPermissionToMode(mode: number, mask: number, op: string, shift: number): number {
        switch (op) {
            case '=':
                mode &= ~(0o7 << shift);
                mode |= (mask << shift);
                break;
            case '+':
                mode |= (mask << shift);
                break;
            case '-':
                mode &= ~(mask << shift);
                break;
        }
        return mode;
    }
}