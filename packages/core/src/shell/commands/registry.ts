import { CommandOptions, ShellCommand } from "./base";

export class CommandRegistry {
    private commands: Map<string, new (options: CommandOptions) => ShellCommand> = new Map();

    register(name: string, commandClass: new (options: CommandOptions) => ShellCommand) {
        this.commands.set(name, commandClass);
    }

    get(name: string): (new (options: CommandOptions) => ShellCommand) | undefined {
        return this.commands.get(name);
    }
    has(name: string): boolean {
        return this.commands.has(name);
    }

    getAll(): string[] {
        return Array.from(this.commands.keys());
    }
}
