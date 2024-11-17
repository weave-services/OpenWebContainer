import { BaseCommand, OptionDefinition, CommandOptionsDefinition, ParsedOptions } from "./baseCommand";
import { StreamOutputController } from "./streamController";
import { formatPath } from "./utils";
import { fs } from "@zenfs/core";

interface CatOptionsDefinition extends CommandOptionsDefinition {
    numberNonblank: OptionDefinition<boolean>;
    showEnds: OptionDefinition<boolean>;
    number: OptionDefinition<boolean>;
    squeezeBlank: OptionDefinition<boolean>;
    showTabs: OptionDefinition<boolean>;
    showNonprinting: OptionDefinition<boolean>;
}

export class CatCommand extends BaseCommand<CatOptionsDefinition> {
    protected get commandName(): string {
        return 'cat';
    }

    protected get optionsDefinition(): CatOptionsDefinition {
        return {
            numberNonblank: {
                type: 'boolean',
                value: false,
                description: 'Number nonempty output lines, overrides -n',
                shortFlag: 'b',
                longFlag: 'number-nonblank'
            },
            showEnds: {
                type: 'boolean',
                value: false,
                description: 'Display $ at end of each line',
                shortFlag: 'E',
                longFlag: 'show-ends'
            },
            number: {
                type: 'boolean',
                value: false,
                description: 'Number all output lines',
                shortFlag: 'n',
                longFlag: 'number'
            },
            squeezeBlank: {
                type: 'boolean',
                value: false,
                description: 'Suppress repeated empty output lines',
                shortFlag: 's',
                longFlag: 'squeeze-blank'
            },
            showTabs: {
                type: 'boolean',
                value: false,
                description: 'Display TAB characters as ^I',
                shortFlag: 'T',
                longFlag: 'show-tabs'
            },
            showNonprinting: {
                type: 'boolean',
                value: false,
                description: 'Use ^ and M- notation, except for LFD and TAB',
                shortFlag: 'v',
                longFlag: 'show-nonprinting'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        try {
            const { options, targets } = this.parseOptions(args);

            if (targets.length === 0) {
                // Read from stdin if no files specified
                await this.processStream(this.output.getInputReader(), options);
            } else {
                for (const target of targets) {
                    try {
                        const path = formatPath(target, this.session.getCurrentDirectory());
                        await this.processFile(path, options);
                    } catch (error: any) {
                        this.handleError(error, target);
                    }
                }
            }
        } catch (error: any) {
            this.output.emit(error.message, 'error');
        }
        await this.finish();
        return this.output;
    }

    private async processFile(filePath: string, options: ParsedOptions<CatOptionsDefinition>): Promise<void> {
        try {
            const stats = await fs.promises.stat(filePath);
            if (stats.isDirectory()) {
                throw new Error(`Is a directory`);
            }

            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            let lineNumber = 1;
            let lastLineWasBlank = false;

            for (let i = 0; i < lines.length; i++) {
                // const isLastLine = i === lines.length - 1;
                // const shouldAddNewline = !isLastLine || lines[i].endsWith('\n');
                const shouldAddNewline = false;

                await this.emitProcessedLine(
                    lines[i],
                    lineNumber,
                    lastLineWasBlank,
                    options,
                    shouldAddNewline
                );

                if (!options.squeezeBlank || lines[i].trim() !== '') {
                    lineNumber++;
                }
                lastLineWasBlank = lines[i].trim() === '';
            }
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error(`No such file or directory`);
            } else if (error.code === 'EACCES') {
                throw new Error(`Permission denied`);
            }
            throw error;
        }
    }

    private async emitProcessedLine(
        line: string,
        lineNumber: number,
        lastLineWasBlank: boolean,
        options: ParsedOptions<CatOptionsDefinition>,
        addNewline: boolean
    ): Promise<void> {
        const processedLine = this.processLine(line, options);
        const isBlankLine = processedLine.trim() === '';

        if (options.squeezeBlank && isBlankLine && lastLineWasBlank) {
            return;
        }

        let outputLine = processedLine;

        if (options.numberNonblank && !isBlankLine) {
            outputLine = `${String(lineNumber).padStart(6)}\t${outputLine}`;
        } else if (options.number) {
            outputLine = `${String(lineNumber).padStart(6)}\t${outputLine}`;
        }

        if (options.showEnds) {
            outputLine = `${outputLine}$`;
        }

        if (addNewline) {
            await this.output.emit(outputLine + '\n', 'info');
        } else {
            await this.output.emit(outputLine, 'info');
        }
    }

    private async processStream(
        reader: ReadableStreamDefaultReader<string>,
        options: ParsedOptions<CatOptionsDefinition>
    ): Promise<void> {
        let lineNumber = 1;
        let lastLineWasBlank = false;
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += value;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const processedLine = this.processLine(line, options);
                    const isBlankLine = processedLine.trim() === '';

                    if (options.squeezeBlank && isBlankLine && lastLineWasBlank) {
                        continue;
                    }

                    let outputLine = processedLine;

                    if (options.numberNonblank && !isBlankLine) {
                        outputLine = `${String(lineNumber++).padStart(6)}\t${outputLine}`;
                    } else if (options.number) {
                        outputLine = `${String(lineNumber++).padStart(6)}\t${outputLine}`;
                    }

                    if (options.showEnds) {
                        outputLine = `${outputLine}$`;
                    }

                    await this.output.emit(outputLine + '\n', 'info');
                    lastLineWasBlank = isBlankLine;
                }
            }

            if (buffer) {
                const processedLine = this.processLine(buffer, options);
                const isBlankLine = processedLine.trim() === '';

                if (!(options.squeezeBlank && isBlankLine && lastLineWasBlank)) {
                    let outputLine = processedLine;

                    if (options.numberNonblank && !isBlankLine) {
                        outputLine = `${String(lineNumber).padStart(6)}\t${outputLine}`;
                    } else if (options.number) {
                        outputLine = `${String(lineNumber).padStart(6)}\t${outputLine}`;
                    }

                    if (options.showEnds) {
                        outputLine = `${outputLine}$`;
                    }

                    await this.output.emit(outputLine, 'info');
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    private processLine(line: string, options: ParsedOptions<CatOptionsDefinition>): string {
        if (options.showTabs) {
            line = line.replace(/\t/g, '^I');
        }

        if (options.showNonprinting) {
            line = this.showNonPrintingChars(line);
        }

        return line;
    }

    private showNonPrintingChars(str: string): string {
        return str.split('').map(char => {
            const code = char.charCodeAt(0);
            if (code < 32 && code !== 9 && code !== 10) {
                return '^' + String.fromCharCode(code + 64);
            } else if (code === 127) {
                return '^?';
            } else if (code >= 128) {
                return 'M-' + (code < 160 ?
                    '^' + String.fromCharCode((code - 128) + 64) :
                    String.fromCharCode(code - 128));
            }
            return char;
        }).join('');
    }
}