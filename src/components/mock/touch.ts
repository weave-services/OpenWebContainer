import { BaseCommand, OptionDefinition, CommandOptionsDefinition, ParsedOptions } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { formatPath, path } from "./utils";
import { fs } from "@zenfs/core";

interface TouchOptionsDefinition extends CommandOptionsDefinition {
    accessTime: OptionDefinition<boolean>;
    noCreate: OptionDefinition<boolean>;
    date: OptionDefinition<string>;
    modifyTime: OptionDefinition<boolean>;
    reference: OptionDefinition<string>;
    time: OptionDefinition<string>;
}

export class TouchCommand extends BaseCommand<TouchOptionsDefinition> {
    protected get commandName(): string {
        return 'touch';
    }

    protected get optionsDefinition(): TouchOptionsDefinition {
        return {
            accessTime: {
                type: 'boolean',
                value: false,
                description: 'Change only the access time',
                shortFlag: 'a',
                longFlag: 'access'
            },
            noCreate: {
                type: 'boolean',
                value: false,
                description: 'Do not create any files',
                shortFlag: 'c',
                longFlag: 'no-create'
            },
            date: {
                type: 'string',
                value: '',
                description: 'Parse STRING and use it instead of current time',
                shortFlag: 'd',
                longFlag: 'date'
            },
            modifyTime: {
                type: 'boolean',
                value: false,
                description: 'Change only the modification time',
                shortFlag: 'm',
                longFlag: 'modify'
            },
            reference: {
                type: 'string',
                value: '',
                description: 'Use this file\'s times instead of current time',
                shortFlag: 'r',
                longFlag: 'reference'
            },
            time: {
                type: 'string',
                value: '',
                description: 'Specify which timestamp to change',
                shortFlag: 't',
                longFlag: 'time'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        if (!this.validateArgs(args)) {
            return this.output;
        }

        try {
            const { options, targets } = this.parseOptions(args);

            // Parse date if provided
            let timestamp: Date | null = null;
            if (options.date) {
                timestamp = this.parseDate(options.date);
            } else if (options.time) {
                timestamp = this.parseTimeString(options.time);
            } else if (options.reference) {
                timestamp = await this.getReferenceTime(options.reference);
            }

            for (const target of targets) {
                try {
                    await this.touchFile(formatPath(target, this.session.getCurrentDirectory()), options, timestamp);
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

    private async touchFile(
        filePath: string,
        options: ParsedOptions<TouchOptionsDefinition>,
        timestamp: Date | null
    ): Promise<void> {
        // Validate path
        if (!filePath || filePath.trim() === '') {
            throw new Error('Path can not be empty');
        }

        const now = timestamp || new Date();
        const exists = await fs.promises.access(filePath)
            .then(() => true)
            .catch(() => false);

        if (!exists) {
            if (options.noCreate) {
                return;
            }

            try {
                // Create the file if it doesn't exist
                const dirPath = path.dirname(filePath);

                // Validate directory path
                if (dirPath && dirPath !== '.') {
                    const dirExists = await fs.promises.access(dirPath)
                        .then(() => true)
                        .catch(() => false);

                    if (!dirExists) {
                        await fs.promises.mkdir(dirPath, { recursive: true });
                    }
                }

                // Create empty file
                await fs.promises.writeFile(filePath, '');
            } catch (error: any) {
                if (error.code === 'EACCES') {
                    throw new Error(`cannot create '${filePath}': permission denied`);
                } else if (error.code === 'EINVAL') {
                    throw new Error(`cannot process '${filePath}': Invalid argument`);
                }
                throw new Error(`cannot create '${filePath}': ${error.message}`);
            }
        }

        try {
            const times: { atime?: Date; mtime?: Date } = {};

            // Get current times first
            const stats = await fs.promises.stat(filePath);

            // Set access time if -a flag is set or neither -a nor -m is set
            times.atime = options.accessTime || (!options.accessTime && !options.modifyTime)
                ? now
                : stats.atime;

            // Set modification time if -m flag is set or neither -a nor -m is set
            times.mtime = options.modifyTime || (!options.accessTime && !options.modifyTime)
                ? now
                : stats.mtime;

            await fs.promises.utimes(filePath, times.atime, times.mtime);
        } catch (error: any) {
            if (error.code === 'EACCES') {
                throw new Error(`cannot touch '${filePath}': permission denied`);
            } else if (error.code === 'ENOENT') {
                throw new Error(`cannot touch '${filePath}': no such file or directory`);
            }
            throw new Error(`cannot touch '${filePath}': ${error.message}`);
        }
    }

    private parseDate(dateString: string): Date {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            throw new Error(`invalid date format: '${dateString}'`);
        }
        return date;
    }

    private parseTimeString(timeString: string): Date {
        // Format: [[CC]YY]MMDDhhmm[.ss]
        const regex = /^(\d{2,4})(\d{2})(\d{2})(\d{2})(\d{2})(\.(\d{2}))?$/;
        const match = timeString.match(regex);

        if (!match) {
            throw new Error(`invalid time format: '${timeString}'`);
        }

        const [_, yearStr, month, day, hours, minutes, __, seconds = '00'] = match;
        let year = parseInt(yearStr);

        // Handle two-digit years
        if (yearStr.length === 2) {
            year += year < 69 ? 2000 : 1900;
        }

        const date = new Date(
            year,
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hours),
            parseInt(minutes),
            parseInt(seconds)
        );

        if (isNaN(date.getTime())) {
            throw new Error(`invalid time: '${timeString}'`);
        }

        return date;
    }

    private async getReferenceTime(refPath: string): Promise<Date> {
        try {
            const stats = await fs.promises.stat(refPath);
            return stats.mtime;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error(`failed to get reference time: no such file '${refPath}'`);
            }
            throw new Error(`failed to get reference time: ${error.message}`);
        }
    }
}