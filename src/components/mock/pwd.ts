import { BaseCommand, OptionDefinition, CommandOptionsDefinition, ParsedOptions } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { fs } from "@zenfs/core";

interface PwdOptionsDefinition extends CommandOptionsDefinition {
    logical: OptionDefinition<boolean>;
    physical: OptionDefinition<boolean>;
}

export class PwdCommand extends BaseCommand<PwdOptionsDefinition> {
    protected get commandName(): string {
        return 'pwd';
    }

    protected get optionsDefinition(): PwdOptionsDefinition {
        return {
            logical: {
                type: 'boolean',
                value: true,
                description: 'Use PWD from environment, even if it contains symlinks',
                shortFlag: 'L',
                longFlag: 'logical'
            },
            physical: {
                type: 'boolean',
                value: false,
                description: 'Avoid all symlinks, show physical location',
                shortFlag: 'P',
                longFlag: 'physical'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        try {
            const { options } = this.parseOptions(args);

            // If both are true, physical takes precedence
            if (options.physical) {
                options.logical = false;
            }

            const currentPath = await this.getCurrentPath(options);
            this.output.emit(currentPath);

        } catch (error: any) {
            if (error.code === 'EACCES') {
                this.output.emit('pwd: permission denied', 'error');
            } else if (error.code === 'ENOENT') {
                this.output.emit('pwd: current directory does not exist', 'error');
            } else if (error.code === 'ELOOP') {
                this.output.emit('pwd: too many levels of symbolic links', 'error');
            } else {
                this.output.emit(`pwd: ${error.message}`, 'error');
            }
        }
        await this.finish();
        return this.output;
    }

    private async getCurrentPath(options: ParsedOptions<PwdOptionsDefinition>): Promise<string> {
        let currentPath = this.session.getCurrentDirectory();

        if (options.physical) {
            try {
                // Resolve all symlinks in the path
                currentPath = await fs.promises.realpath(currentPath);
            } catch (error: any) {
                if (error.code === 'ENOENT') {
                    // If the current directory no longer exists
                    throw new Error('current directory does not exist');
                } else if (error.code === 'EACCES') {
                    // If we don't have permission to read the path
                    throw new Error('permission denied reading path');
                } else if (error.code === 'ELOOP') {
                    // If there are too many symbolic links
                    throw new Error('too many levels of symbolic links');
                } else {
                    // Fall back to logical path if realpath fails
                    if (!options.logical) {
                        throw error;
                    }
                }
            }
        }

        // Validate that the path still exists and is accessible
        try {
            await fs.promises.access(currentPath);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error('current directory does not exist');
            } else if (error.code === 'EACCES') {
                throw new Error('permission denied reading current directory');
            }
            throw error;
        }

        return currentPath;
    }
}