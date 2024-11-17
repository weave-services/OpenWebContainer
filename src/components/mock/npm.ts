import BrowserNodeRuntime from "../runtime/runtime";
import { BaseCommand, CommandOptionsDefinition } from "./baseCommand";
import { StreamOutputController } from "./streamController";

export class NpmCommand extends BaseCommand {
    protected get commandName(): string {
        return 'npm';
    }

    protected get optionsDefinition(): CommandOptionsDefinition {
        // No options parsing, return empty object
        return {};
    }

    async execute(args: string[]): Promise<StreamOutputController> {
        const runtime = new BrowserNodeRuntime({ debug: true, debugSandbox: true });
        await runtime.initialize();
        let fs = runtime.getFS()

        // Fetch npm-cli.js
        const npmCliUrl = 'https://unpkg.com/npm@9.5.1/lib/cli.js';
        let response = await fetch(npmCliUrl);
        let content = await response.text();

        // Write it to the virtual filesystem
        await fs.writeFile('/usr/local/lib/cli.js', content);

        const npmBinCliUrl = 'https://unpkg.com/npm@9.5.1/bin/npm-cli.js';
        response = await fetch(npmBinCliUrl);
        content = await response.text();

        // Write it to the virtual filesystem
        await fs.writeFile('/usr/local/bin/npm-cli.js', content);


        // Run npm commands
        try {
            // await runtime.se
            await runtime.runScript('/usr/local/bin/npm-cli.js', args);
            console.log('Debug logs:', runtime.getLogs());
        } catch (error) {
            console.error('Error running npm:', error);
            console.log('Debug logs:', runtime.getLogs());
        }
        // Empty execute function for you to implement
        // args will contain the raw npm command arguments

        await this.finish();
        return this.output;
    }
}