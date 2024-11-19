import { ShellCommandResult } from "../types";
import { CommandHelp, ShellCommand } from "./base";

export class CurlCommand extends ShellCommand {
    get help(): CommandHelp {
        return {
            name: 'curl',
            description: 'Transfer data from or to a server',
            usage: 'curl [options] URL\n' +
                'Options:\n' +
                '  -X <method>  HTTP method\n' +
                '  -H <header>  Custom header\n' +
                '  -o <file>    Output to file',
            examples: [
                'curl https://api.example.com',
                'curl -X POST -H "Content-Type: application/json" https://api.com',
                'curl -o output.json https://api.com/data'
            ]
        };
    }

    async execute(args: string[]): Promise<ShellCommandResult> {
        try {
            // Basic argument parsing
            const urlIndex = args.findIndex(arg => !arg.startsWith('-'));
            if (urlIndex === -1) {
                return {
                    stdout: '',
                    stderr: 'curl: URL required',
                    exitCode: 1
                };
            }

            const url = args[urlIndex];
            const options = args.slice(0, urlIndex);

            // Parse options
            const method = options.includes('-X') ?
                args[args.indexOf('-X') + 1] : 'GET';
            const headers: Record<string, string> = {};
            const outputFile = options.includes('-o') ?
                args[args.indexOf('-o') + 1] : undefined;

            const followRedirects = !options.includes('--no-follow');
            const insecure = options.includes('-k') || options.includes('--insecure');

            // Parse headers
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '-H' && args[i + 1]) {
                    const headerStr = args[i + 1];
                    const [key, ...valueParts] = headerStr.split(':');
                    const value = valueParts.join(':').trim();
                    headers[key.trim()] = value;
                    i++; // Skip next argument since we processed it
                }
            }


            try {
                const response = await fetch(url, {
                    method,
                    headers: {
                        ...headers,
                        'Accept': '*/*',
                        'Accept-Encoding': 'gzip, deflate, br',
                    },
                    redirect: followRedirects ? 'follow' : 'manual',
                    // Ignore SSL certificate errors if -k flag is used
                    mode: 'cors',
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const responseText = await response.text();

                // Handle output to file if -o option is used
                if (outputFile) {
                    this.fileSystem.writeFile(this.resolvePath(outputFile), responseText);
                    return {
                        stdout: `  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n` +
                            `                                   Dload  Upload   Total   Spent    Left  Speed\n` +
                            `100  ${responseText.length}  100  ${responseText.length}    0     0   ${Math.floor(responseText.length / 0.1)}      0  0:00:01 --:--:--  0:00:01 ${Math.floor(responseText.length / 0.1)}\n`,
                        stderr: '',
                        exitCode: 0
                    };
                }

                return {
                    stdout: responseText + '\n',
                    stderr: '',
                    exitCode: 0
                };

            } catch (error: any) {
                return {
                    stdout: '',
                    stderr: `curl: (6) Could not resolve host: ${error.message}\n`,
                    exitCode: 6
                };
            }
        } catch (error: any) {
            return {
                stdout: '',
                stderr: `curl: ${error.message}\n`,
                exitCode: 1
            };
        }
    }
}