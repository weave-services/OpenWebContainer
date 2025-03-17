/**
 * export interface for file system operations
 */
export interface PackageMetadata {
    name: string;
    version: string;
    main?: string; // Entry point (defaults to 'index.js')
    dependencies?: Record<string, string>; // Package name -> version
    files: Record<string, string>; // Relative path -> file content
}
export interface IFileSystem {
    writeFile(path: string, content: string): void;
    writeBuffer(path: string, buffer: Buffer): void;
    readFile(path: string): string | undefined;
    readBuffer(path: string): Buffer | undefined;
    deleteFile(path: string, recursive?: boolean): void;
    listFiles(basePath?: string): string[];
    resolvePath(path: string, basePath?: string): string;
    fileExists(path: string): boolean;
    resolveModulePath(specifier: string, basePath?: string): string;
    createDirectory(path: string): void;
    deleteDirectory(path: string): void;
    listDirectory(path: string): string[];
    isDirectory(path: string): boolean;
    normalizePath(path: string): string;
    loadPackage(pkg: PackageMetadata): Promise<void>;
    packageExists(packageName: string, version?: string): Promise<boolean>;
    resolvePackagePath(packageName: string, basePath?: string): Promise<string>;
    loadNodeModules(modules:Record<string,string>):Promise<void>;
}
