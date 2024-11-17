import { BaseCommand, OptionDefinition, CommandOptionsDefinition, ParsedOptions } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { fs } from "@zenfs/core";
import { path } from "./utils";

interface CdOptionsDefinition extends CommandOptionsDefinition {
    physical: OptionDefinition<boolean>;
    logical: OptionDefinition<boolean>;
    verbose: OptionDefinition<boolean>;
    pushd: OptionDefinition<boolean>;
}

export class CdCommand extends BaseCommand<CdOptionsDefinition> {
    protected get commandName(): string {
        return 'cd';
    }

    protected get optionsDefinition(): CdOptionsDefinition {
        return {
            physical: {
                type: 'boolean',
                value: false,
                description: 'Use physical directory structure',
                shortFlag: 'P',
                longFlag: 'physical'
            },
            logical: {
                type: 'boolean',
                value: true,
                description: 'Follow symbolic links (default)',
                shortFlag: 'L',
                longFlag: 'logical'
            },
            verbose: {
                type: 'boolean',
                value: false,
                description: 'Print the new working directory',
                shortFlag: 'v',
                longFlag: 'verbose'
            },
            pushd: {
                type: 'boolean',
                value: false,
                description: 'Push the old directory onto the stack',
                shortFlag: 'p',
                longFlag: 'push'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        try {
            const { options, targets } = this.parseOptions(args);
            const target = this.resolveTarget(targets[0]);

            try {
                await this.changeDirectory(target, options);
            } catch (error: any) {
                this.handleError(error, target);
            }
        } catch (error: any) {
            this.output.emit(error.message, 'error');
        }
        await this.finish();

        return this.output;
    }

    private resolveTarget(target?: string): string {
        if (!target || target === '~') {
            return this.session.getEnv('HOME') || '/home/user';
        }
        if (target === '-') {
            return this.session.getPreviousDirectory();
        }
        if (target.startsWith('~')) {
            return path.join(this.session.getEnv('HOME') || '/home/user', target.slice(2));
        }
        return target;
    }

    private async changeDirectory(targetPath: string, options: ParsedOptions<CdOptionsDefinition>): Promise<void> {
        if (options.physical) {
            options.logical = false;
        }

        const resolvedPath = this.resolvePath(targetPath, options);

        try {
            await this.validatePath(resolvedPath);

            if (options.pushd) {
                this.session.pushDirectory(resolvedPath);
            } else {
                this.session.changeDirectory(resolvedPath);
            }

            if (options.verbose) {
                this.output.emit(resolvedPath, 'info');
            }
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                throw new Error(`no such directory`);
            } else if (error?.code === 'EACCES') {
                throw new Error(`permission denied`);
            } else if (error?.code === 'ENOTDIR') {
                throw new Error(`not a directory`);
            } else {
                throw new Error(error.message || `cannot change directory`);
            }
        }
    }

    private async validatePath(targetPath: string): Promise<void> {
        const stats = await fs.promises.stat(targetPath);
        if (!stats.isDirectory()) {
            throw { code: 'ENOTDIR' };
        }
    }

    private resolvePath(targetPath: string, options: ParsedOptions<CdOptionsDefinition>): string {
        let resolvedPath: string;

        if (path.isAbsolute(targetPath)) {
            resolvedPath = targetPath;
        } else {
            resolvedPath = path.join(this.session.getCurrentDirectory(), targetPath);
        }

        resolvedPath = path.normalize(resolvedPath);

        if (options.physical) {
            try {
                resolvedPath = fs.realpathSync(resolvedPath);
            } catch (error: any) {
                switch (error.code) {
                    case 'ELOOP':
                        if (!options.verbose) {
                            this.output.emit('warning: too many levels of symbolic links', 'warning');
                        }
                        break;
                    case 'ENOENT':
                        throw new Error(`no such directory`);
                    case 'EACCES':
                        throw new Error(`permission denied while resolving path`);
                    default:
                        if (!options.verbose) {
                            this.output.emit(`warning: could not resolve symbolic links, using logical path`, 'warning');
                        }
                }

                try {
                    fs.statSync(resolvedPath);
                } catch (statError: any) {
                    if (statError.code === 'ENOENT') {
                        throw new Error(`no such directory`);
                    }
                    throw statError;
                }
            }
        }

        return resolvedPath;
    }
}