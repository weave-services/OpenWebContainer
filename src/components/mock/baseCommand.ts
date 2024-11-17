import { StreamOutputController } from "./streamController";
import { Session } from "./session";
import { pipeReaderToWritableText } from "./utils";

export type OptionValue = boolean | number | string;

export interface OptionDefinition<T extends OptionValue = OptionValue> {
    type: 'boolean' | 'number' | 'string';
    value: T;
    description?: string;
    shortFlag?: string;
    longFlag?: string;
}

export type CommandOptionsDefinition = {
    [key: string]: OptionDefinition;
};

export type ParsedOptions<T extends CommandOptionsDefinition> = {
    [K in keyof T]: T[K]['value'];
};

export abstract class BaseCommand<T extends CommandOptionsDefinition = CommandOptionsDefinition> {
    protected output: StreamOutputController;
    protected session: Session;
    protected inputWriter: WritableStreamDefaultWriter<string>;
    protected inputReader: ReadableStreamDefaultReader<string>;

    constructor(
        session: Session,
        inputStream: ReadableStreamDefaultReader<string>,
    ) {
        this.session = session;
        this.output = new StreamOutputController();
        this.inputReader = inputStream;
        this.inputWriter = this.output.input.getWriter();
        pipeReaderToWritableText(inputStream, this.inputWriter);
    }

    protected abstract get commandName(): string;
    protected abstract get optionsDefinition(): T;

    protected async finish(): Promise<void> {
        try {
            await this.inputWriter.close();
            await this.output.close();
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    protected parseOptions(args: string[]): {
        options: ParsedOptions<T>;
        targets: string[]
    } {
        const options = Object.entries(this.optionsDefinition).reduce((acc, [key, def]) => {
            acc[key as keyof T] = def.value;
            return acc;
        }, {} as { -readonly [K in keyof T]: T[K]['value'] });

        const targets: string[] = [];
        let currentLongOption: keyof T | null = null;

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];

            if (currentLongOption) {
                const def = this.optionsDefinition[currentLongOption];
                options[currentLongOption] = this.parseValue(arg, def);
                currentLongOption = null;
                continue;
            }

            if (arg.startsWith('--')) {
                const longFlag = arg.slice(2);
                const optionEntry = Object.entries(this.optionsDefinition)
                    .find(([_, def]) => def.longFlag === longFlag);

                if (!optionEntry) {
                    throw new Error(`Unknown option: ${arg}`);
                }

                const [key, def] = optionEntry;
                if (def.type === 'boolean') {
                    options[key as keyof T] = true as any;
                } else {
                    currentLongOption = key as keyof T;
                }
            } else if (arg.startsWith('-')) {
                const flags = arg.slice(1);
                for (const flag of flags) {
                    const optionEntry = Object.entries(this.optionsDefinition)
                        .find(([_, def]) => def.shortFlag === flag);

                    if (!optionEntry) {
                        throw new Error(`Unknown option: -${flag}`);
                    }

                    const [key, def] = optionEntry;
                    if (def.type === 'boolean') {
                        options[key as keyof T] = true as any;
                    } else {
                        if (i + 1 >= args.length) {
                            throw new Error(`Option -${flag} requires a value`);
                        }
                        options[key as keyof T] = this.parseValue(args[++i], def);
                    }
                }
            } else {
                targets.push(arg);
            }
        }

        if (currentLongOption) {
            throw new Error(`Option --${this.optionsDefinition[currentLongOption].longFlag} requires a value`);
        }

        return { options, targets };
    }

    private parseValue(value: string, definition: OptionDefinition): OptionValue {
        switch (definition.type) {
            case 'boolean':
                return value.toLowerCase() === 'true';
            case 'number':
                const num = Number(value);
                if (isNaN(num)) {
                    throw new Error(`Invalid number: ${value}`);
                }
                return num;
            case 'string':
                return value;
            default:
                throw new Error(`Unknown option type: ${definition.type}`);
        }
    }

    protected async promptUser(question: string): Promise<string> {
        await this.output.emit(question, 'prompt');
        const response = await this.output.readLine();
        return response.toLowerCase();
    }

    protected handleError(error: Error, target: string, force: boolean = false): void {
        if (!force) {
            this.output.emit(`cannot process '${target}': ${error.message}`, 'error');
        }
    }

    protected validateArgs(args: string[]): boolean {
        if (args.length === 0) {
            this.output.emit(`${this.commandName}: missing operand`, 'error');
            this.output.emit(`Try '${this.commandName} --help' for more information.`, 'info');
            return false;
        }
        return true;
    }

    get process() {
        return this.output;
    }

    abstract execute(args: string[]): Promise<StreamOutputController>;
}