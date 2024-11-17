import { BaseCommand, OptionDefinition, CommandOptionsDefinition } from "./baseCommand";
import { StreamOutputController } from "./streamController";

interface EchoOptionsDefinition extends CommandOptionsDefinition {
    noNewline: OptionDefinition<boolean>;
    escapeSequences: OptionDefinition<boolean>;
}

export class EchoCommand extends BaseCommand<EchoOptionsDefinition> {
    protected get commandName(): string {
        return 'echo';
    }

    protected get optionsDefinition(): EchoOptionsDefinition {
        return {
            noNewline: {
                type: 'boolean',
                value: false,
                description: 'Do not output trailing newline',
                shortFlag: 'n',
                longFlag: 'no-newline'
            },
            escapeSequences: {
                type: 'boolean',
                value: false,
                description: 'Enable interpretation of backslash escapes',
                shortFlag: 'e',
                longFlag: 'enable-escapes'
            }
        };
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        try {
            const { options, targets } = this.parseOptions(args);

            // Join arguments with space
            let text = targets.join(' ');

            // Process escape sequences if enabled
            if (options.escapeSequences) {
                text = this.processEscapeSequences(text);
            }

            // If no newline is requested, use slice to remove the trailing newline
            // that emit would add by default
            if (options.noNewline) {
                await this.output.emit(text);
            } else {
                await this.output.emit(text + '\n');
            }

        } catch (error: any) {
            this.output.emit(error.message, 'error');
        }
        await this.finish();
        return this.output;
    }

    private processEscapeSequences(text: string): string {
        const escapeMap: Record<string, string> = {
            'a': '\x07',  // Alert (bell)
            'b': '\b',    // Backspace
            'c': '',      // Produce no further output
            'e': '\x1B',  // Escape character
            'f': '\f',    // Form feed
            'n': '\n',    // New line
            'r': '\r',    // Carriage return
            't': '\t',    // Horizontal tab
            'v': '\v',    // Vertical tab
            '\\': '\\',   // Backslash
            '0': '\0'     // Null character
        };

        let result = '';
        let i = 0;

        while (i < text.length) {
            if (text[i] === '\\' && i + 1 < text.length) {
                // Handle octal values (\0NNN)
                if (/[0-7]/.test(text[i + 1])) {
                    let octalValue = '';
                    let j = i + 1;
                    while (j < Math.min(i + 4, text.length) && /[0-7]/.test(text[j])) {
                        octalValue += text[j];
                        j++;
                    }
                    if (octalValue) {
                        const charCode = parseInt(octalValue, 8);
                        result += String.fromCharCode(charCode);
                        i = j;
                        continue;
                    }
                }

                // Handle hexadecimal values (\xHH)
                if (text[i + 1] === 'x' && i + 2 < text.length) {
                    const hexValue = text.slice(i + 2, i + 4);
                    if (/^[0-9A-Fa-f]{2}$/.test(hexValue)) {
                        const charCode = parseInt(hexValue, 16);
                        result += String.fromCharCode(charCode);
                        i += 4;
                        continue;
                    }
                }

                // Handle special sequences
                const nextChar = text[i + 1];
                if (nextChar in escapeMap) {
                    result += escapeMap[nextChar];
                    if (nextChar === 'c') {
                        // Stop processing on \c
                        break;
                    }
                    i += 2;
                    continue;
                }

                // Unrecognized escape sequence, keep the backslash
                result += '\\';
            } else {
                result += text[i];
            }
            i++;
        }

        return result;
    }
}