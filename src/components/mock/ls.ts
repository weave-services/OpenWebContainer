import { BaseCommand, OptionDefinition, CommandOptionsDefinition, ParsedOptions } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { formatPath, path, OSC } from "./utils";
import { fs } from "@zenfs/core";

interface LsOptionsDefinition extends CommandOptionsDefinition {
    all: OptionDefinition<boolean>;
    almostAll: OptionDefinition<boolean>;
    long: OptionDefinition<boolean>;
    humanReadable: OptionDefinition<boolean>;
    noGroup: OptionDefinition<boolean>;
    reverse: OptionDefinition<boolean>;
    recursive: OptionDefinition<boolean>;
    sortTime: OptionDefinition<boolean>;
    sortSize: OptionDefinition<boolean>;
    oneLine: OptionDefinition<boolean>;
    color: OptionDefinition<boolean>;
}

interface FileInfo {
    name: string;
    path: string;
    stats: fs.Stats;
    isHidden: boolean;
}

export class LsCommand extends BaseCommand<LsOptionsDefinition> {
    protected get commandName(): string {
        return 'ls';
    }

    protected get optionsDefinition(): LsOptionsDefinition {
        return {
            all: {
                type: 'boolean',
                value: false,
                description: 'Show hidden files',
                shortFlag: 'a',
                longFlag: 'all'
            },
            almostAll: {
                type: 'boolean',
                value: false,
                description: 'Show hidden files except . and ..',
                shortFlag: 'A',
                longFlag: 'almost-all'
            },
            long: {
                type: 'boolean',
                value: false,
                description: 'Use long listing format',
                shortFlag: 'l',
                longFlag: 'long'
            },
            humanReadable: {
                type: 'boolean',
                value: false,
                description: 'Print sizes in human readable format',
                shortFlag: 'h',
                longFlag: 'human-readable'
            },
            noGroup: {
                type: 'boolean',
                value: false,
                description: 'Do not display group information',
                shortFlag: 'G',
                longFlag: 'no-group'
            },
            reverse: {
                type: 'boolean',
                value: false,
                description: 'Reverse order while sorting',
                shortFlag: 'r',
                longFlag: 'reverse'
            },
            recursive: {
                type: 'boolean',
                value: false,
                description: 'List subdirectories recursively',
                shortFlag: 'R',
                longFlag: 'recursive'
            },
            sortTime: {
                type: 'boolean',
                value: false,
                description: 'Sort by modification time',
                shortFlag: 't',
                longFlag: 'sort-time'
            },
            sortSize: {
                type: 'boolean',
                value: false,
                description: 'Sort by file size',
                shortFlag: 'S',
                longFlag: 'sort-size'
            },
            oneLine: {
                type: 'boolean',
                value: false,
                description: 'List one file per line',
                shortFlag: '1',
                longFlag: 'one-line'
            },
            color: {
                type: 'boolean',
                value: true,
                description: 'Colorize the output',
                longFlag: 'color'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        try {
            const { options, targets } = this.parseOptions(args);
            const paths = targets.length > 0 ? targets : ['.'];

            for (let i = 0; i < paths.length; i++) {
                const target = formatPath(paths[i], this.session.getCurrentDirectory());

                try {
                    if (paths.length > 1) {
                        if (i > 0) this.output.emit(''); // Empty line between directories
                        this.output.emit(`${target}:`, 'info');
                    }

                    await this.listDirectory(target, options);

                } catch (error: any) {
                    this.handleError(error, target);
                }
            }
        } catch (error: any) {
            this.output.emit(error.message, 'error');
        }
        await this.finish();
        return this.output;
    }

    private async listDirectory(dirPath: string, options: ParsedOptions<LsOptionsDefinition>, level: number = 0): Promise<void> {
        const entries = await this.getDirectoryEntries(dirPath, options);
        const fileInfos = await this.getFileInfos(dirPath, entries, options);

        // Sort entries
        this.sortEntries(fileInfos, options);

        if (options.long) {
            await this.displayLongFormat(fileInfos, options);
        } else {
            await this.displayShortFormat(fileInfos, options);
        }

        // Handle recursive listing
        if (options.recursive) {
            for (const info of fileInfos) {
                if (info.stats.isDirectory() &&
                    info.name !== '.' &&
                    info.name !== '..' &&
                    (!info.isHidden || options.all || options.almostAll)) {
                    this.output.emit('');
                    this.output.emit(`${info.path}:`, 'info');
                    await this.listDirectory(info.path, options, level + 1);
                }
            }
        }
    }

    private async getDirectoryEntries(dirPath: string, options: ParsedOptions<LsOptionsDefinition>): Promise<string[]> {
        const entries = await fs.promises.readdir(dirPath);

        if (!options.all && !options.almostAll) {
            return entries.filter(entry => !entry.startsWith('.'));
        }

        if (options.almostAll) {
            return entries.filter(entry => entry !== '.' && entry !== '..');
        }

        return entries;
    }

    private async getFileInfos(dirPath: string, entries: string[], options: ParsedOptions<LsOptionsDefinition>): Promise<FileInfo[]> {
        const fileInfos: FileInfo[] = [];

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry);
            try {
                const stats = await fs.promises.stat(fullPath);
                fileInfos.push({
                    name: entry,
                    path: fullPath,
                    stats,
                    isHidden: entry.startsWith('.')
                });
            } catch (error) {
                this.handleError(error as Error, fullPath);
            }
        }

        return fileInfos;
    }

    private sortEntries(entries: FileInfo[], options: ParsedOptions<LsOptionsDefinition>): void {
        let compareFunction: (a: FileInfo, b: FileInfo) => number;

        if (options.sortSize) {
            compareFunction = (a, b) => b.stats.size - a.stats.size;
        } else if (options.sortTime) {
            compareFunction = (a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime();
        } else {
            compareFunction = (a, b) => a.name.localeCompare(b.name);
        }

        entries.sort((a, b) => {
            const result = compareFunction(a, b);
            return options.reverse ? -result : result;
        });
    }

    private formatMode(mode: number): string {
        const types = { directory: 'd', file: '-', symlink: 'l' };
        const permissions = ['r', 'w', 'x'];
        const groups = [mode >> 6, mode >> 3, mode].map(n => n & 7);

        let result = mode & fs.constants.S_IFDIR ? types.directory :
            mode & fs.constants.S_IFLNK ? types.symlink :
                types.file;

        for (const group of groups) {
            for (let i = 0; i < 3; i++) {
                result += (group >> (2 - i)) & 1 ? permissions[i] : '-';
            }
        }

        return result;
    }

    private formatSize(size: number, humanReadable: boolean): string {
        if (!humanReadable) return size.toString().padStart(8);

        const units = ['B', 'K', 'M', 'G', 'T'];
        let unit = 0;
        let value = size;

        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }

        return `${value.toFixed(unit > 0 ? 1 : 0)}${units[unit]}`.padStart(5);
    }

    private colorize(name: string, stats: fs.Stats, options: ParsedOptions<LsOptionsDefinition>): string {
        if (!options.color) return name;

        if (stats.isDirectory()) return `${OSC.blue}${name}${OSC.reset}`;
        if (stats.isSymbolicLink()) return `${OSC.cyan}${name}${OSC.reset}`;
        if ((stats.mode & 0o111) !== 0) return `${OSC.green}${name}${OSC.reset}`; // Executable
        return name;
    }

    private async displayLongFormat(files: FileInfo[], options: ParsedOptions<LsOptionsDefinition>): Promise<void> {
        for (const file of files) {
            const mode = this.formatMode(file.stats.mode);
            const links = file.stats.nlink.toString().padStart(3);
            const owner = file.stats.uid.toString().padStart(8);
            const group = options.noGroup ? '' : file.stats.gid.toString().padStart(8);
            const size = this.formatSize(file.stats.size, options.humanReadable);
            const date = file.stats.mtime.toLocaleDateString();
            const time = file.stats.mtime.toLocaleTimeString();
            const name = this.colorize(file.name, file.stats, options);

            const groupPart = options.noGroup ? '' : ` ${group}`;
            this.output.emit(
                `${mode} ${links} ${owner}${groupPart} ${size} ${date} ${time} ${name}`,
                'info'
            );
        }
    }

    private async displayShortFormat(files: FileInfo[], options: ParsedOptions<LsOptionsDefinition>): Promise<void> {
        if (options.oneLine) {
            for (const file of files) {
                this.output.emit(this.colorize(file.name, file.stats, options), 'info');
            }
            return;
        }

        // Calculate column width and count
        const maxWidth = Math.max(...files.map(f => f.name.length));
        const terminalWidth = 80;
        const columns = Math.floor(terminalWidth / (maxWidth + 2));
        const rows = Math.ceil(files.length / columns);

        // Create grid
        for (let row = 0; row < rows; row++) {
            let line = '';
            for (let col = 0; col < columns; col++) {
                const index = col * rows + row;
                if (index < files.length) {
                    const file = files[index];
                    line += this.colorize(file.name.padEnd(maxWidth + 2), file.stats, options);
                }
            }
            this.output.emit(line.trimEnd(), 'info');
        }
    }
}