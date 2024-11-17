import { BaseCommand, OptionDefinition, CommandOptionsDefinition, ParsedOptions } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { formatPath, OSC } from "./utils";
import { fs } from "@zenfs/core";

interface RmOptionsDefinition extends CommandOptionsDefinition {
    recursive: OptionDefinition<boolean>;
    force: OptionDefinition<boolean>;
    dir: OptionDefinition<boolean>;
    interactive: OptionDefinition<boolean>;
    verbose: OptionDefinition<boolean>;
    preserveRoot: OptionDefinition<boolean>;
}

export class RmCommand extends BaseCommand<RmOptionsDefinition> {
    protected get commandName(): string {
        return 'rm';
    }

    protected get optionsDefinition(): RmOptionsDefinition {
        return {
            recursive: {
                type: 'boolean',
                value: false,
                description: 'Remove directories and their contents recursively',
                shortFlag: 'r',
                longFlag: 'recursive'
            },
            force: {
                type: 'boolean',
                value: false,
                description: 'Ignore nonexistent files and never prompt',
                shortFlag: 'f',
                longFlag: 'force'
            },
            dir: {
                type: 'boolean',
                value: false,
                description: 'Remove empty directories',
                shortFlag: 'd',
                longFlag: 'dir'
            },
            interactive: {
                type: 'boolean',
                value: false,
                description: 'Prompt before every removal',
                shortFlag: 'i',
                longFlag: 'interactive'
            },
            verbose: {
                type: 'boolean',
                value: false,
                description: 'Explain what is being done',
                shortFlag: 'v',
                longFlag: 'verbose'
            },
            preserveRoot: {
                type: 'boolean',
                value: true,
                description: 'Do not remove / (default)',
                longFlag: 'preserve-root'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        if (!this.validateArgs(args)) {
            return this.output;
        }

        try {
            const { options, targets } = this.parseOptions(args);

            // Handle --no-preserve-root
            if (args.includes('--no-preserve-root')) {
                options.preserveRoot = false;
            }

            // If force is true, interactive should be false
            if (options.force) {
                options.interactive = false;
            }

            for (const target of targets) {
                const path = formatPath(target, this.session.getCurrentDirectory());
                try {
                    await this.removeItem(path, target, options);
                } catch (error: any) {
                    this.handleError(error, target, options.force);
                }
            }
        } catch (error: any) {
            this.output.emit(error.message, 'error');
        }
        await this.finish();
        return this.output;
    }

    private async removeItem(path: string, pathArg: string, options: ParsedOptions<RmOptionsDefinition>): Promise<void> {
        if (!fs.existsSync(path)) {
            if (!options.force) {
                this.output.emit(
                    `cannot remove '${pathArg}': No such file or directory`,
                    'error'
                );
            }
            return;
        }

        const stats = fs.statSync(path);

        if (options.preserveRoot && path === '/') {
            this.output.emit(
                "it is dangerous to operate recursively on '/'",
                'warning'
            );
            this.output.emit(
                "use --no-preserve-root to override this failsafe",
                'info'
            );
            return;
        }

        if (stats.isDirectory()) {
            await this.handleDirectory(path, pathArg, options);
        } else {
            await this.handleFile(path, pathArg, stats, options);
        }
    }

    private async handleDirectory(
        path: string,
        pathArg: string,
        options: ParsedOptions<RmOptionsDefinition>
    ): Promise<void> {
        const dirContents = fs.readdirSync(path);
        const isEmpty = dirContents.length === 0;

        if (!options.recursive && !options.dir) {
            this.output.emit(
                `cannot remove '${pathArg}': Is a directory`,
                'error'
            );
            return;
        }

        if (!options.recursive && !isEmpty) {
            this.output.emit(
                `cannot remove '${pathArg}': Directory not empty`,
                'error'
            );
            return;
        }

        if (options.interactive) {
            const descend = await this.promptUser(
                `${OSC.yellow}?${OSC.reset} descend into directory '${pathArg}'? (y/N)`
            );
            if (!descend.startsWith('y')) {
                this.output.emit(`skipping '${pathArg}'`, 'info');
                return;
            }
        }

        if (options.recursive) {
            await this.removeRecursive(path, options);
        } else {
            fs.rmdirSync(path);
            if (options.verbose) {
                this.output.emit(`removed directory '${pathArg}'`, 'success');
            }
        }
    }

    private async handleFile(
        path: string,
        pathArg: string,
        stats: fs.Stats,
        options: ParsedOptions<RmOptionsDefinition>
    ): Promise<void> {
        if (options.interactive) {
            const remove = await this.promptUser(
                `${OSC.yellow}?${OSC.reset} remove regular file '${pathArg}'? (y/N)`
            );
            if (!remove.startsWith('y')) {
                this.output.emit(`skipping '${pathArg}'`, 'info');
                return;
            }
        }

        if (stats.isSymbolicLink()) {
            fs.unlinkSync(path);
            if (options.verbose) {
                this.output.emit(`removed symbolic link '${pathArg}'`, 'success');
            }
        } else {
            if (!options.force && (stats.mode & 0o200) === 0) {
                const override = await this.promptUser(
                    `${OSC.yellow}?${OSC.reset} remove write-protected regular file '${pathArg}'? (y/N)`
                );
                if (!override.startsWith('y')) {
                    this.output.emit(`skipping '${pathArg}'`, 'info');
                    return;
                }
            }

            fs.unlinkSync(path);
            if (options.verbose) {
                this.output.emit(`removed '${pathArg}'`, 'success');
            }
        }
    }

    private async removeRecursive(
        dirPath: string,
        options: ParsedOptions<RmOptionsDefinition>
    ): Promise<void> {
        const contents = fs.readdirSync(dirPath);

        for (const item of contents) {
            const itemPath = `${dirPath}/${item}`;
            const itemStats = fs.statSync(itemPath);

            if (itemStats.isDirectory()) {
                await this.removeRecursive(itemPath, options);
            } else {
                if (options.interactive) {
                    const remove = await this.promptUser(
                        `${OSC.yellow}?${OSC.reset} remove regular file '${itemPath}'? (y/N)`
                    );
                    if (!remove.startsWith('y')) {
                        this.output.emit(`skipping '${itemPath}'`, 'info');
                        continue;
                    }
                }

                fs.unlinkSync(itemPath);
                if (options.verbose) {
                    this.output.emit(`removed '${itemPath}'`, 'success');
                }
            }
        }

        if (options.interactive) {
            const remove = await this.promptUser(
                `${OSC.yellow}?${OSC.reset} remove directory '${dirPath}'? (y/N)`
            );
            if (!remove.startsWith('y')) {
                this.output.emit(`skipping '${dirPath}'`, 'info');
                return;
            }
        }

        fs.rmdirSync(dirPath);
        if (options.verbose) {
            this.output.emit(`removed directory '${dirPath}'`, 'success');
        }
    }
}