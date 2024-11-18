/**
 * export interface for file system operations
 */
export interface IFileSystem {
    writeFile(path: string, content: string): void;
    readFile(path: string): string | undefined;
    deleteFile(path: string, recursive?: boolean): void;
    listFiles(): string[];
    resolvePath(path: string, basePath?: string): string;
    fileExists(path: string): boolean;
    resolveModulePath(specifier: string, basePath?: string): string;
    createDirectory(path: string): void;
    deleteDirectory(path: string): void;
    listDirectory(path: string): string[];
    isDirectory(path: string): boolean;
    normalizePath(path: string): string;
}
