import { IFileSystem } from './types';

export class VirtualFileSystem implements IFileSystem {
    private files: Map<string, string>;
    private directories: Set<string>;

    constructor() {
        this.files = new Map();
        this.directories = new Set();
        this.directories.add('/'); // Root directory
    }

    private normalizePath(path: string): string {
        let normalized = path.replace(/\\/g, '/');
        if (!normalized.startsWith('/')) {
            normalized = '/' + normalized;
        }
        return normalized.replace(/\/+/g, '/');
    }

    private getDirectoryPath(path: string): string {
        return this.normalizePath(path.split('/').slice(0, -1).join('/'));
    }

    createDirectory(path: string): void {
        const normalizedPath = this.normalizePath(path);
        if (this.files.has(normalizedPath)) {
            throw new Error(`File exists at path: ${path}`);
        }

        // Create parent directories if they don't exist
        const parentPath = this.getDirectoryPath(normalizedPath);
        if (parentPath !== '/' && !this.directories.has(parentPath)) {
            this.createDirectory(parentPath);
        }

        this.directories.add(normalizedPath);
    }

    deleteDirectory(path: string): void {
        const normalizedPath = this.normalizePath(path);
        if (!this.directories.has(normalizedPath)) {
            throw new Error(`Directory not found: ${path}`);
        }
        if (this.listDirectory(normalizedPath).length > 0) {
            throw new Error(`Directory not empty: ${path}`);
        }
        this.directories.delete(normalizedPath);
    }

    listDirectory(path: string): string[] {
        const normalizedPath = this.normalizePath(path);
        if (!this.directories.has(normalizedPath)) {
            throw new Error(`Directory not found: ${path}`);
        }

        const entries = new Set<string>();

        // Add subdirectories
        for (const dir of this.directories) {
            if (dir !== normalizedPath && dir.startsWith(normalizedPath)) {
                const relativePath = dir.slice(normalizedPath.length + 1);
                const topLevel = relativePath.split('/')[0];
                if (topLevel) {
                    entries.add(topLevel + '/');
                }
            }
        }

        // Add files
        for (const file of this.files.keys()) {
            if (file.startsWith(normalizedPath)) {
                const relativePath = file.slice(normalizedPath.length + 1);
                const topLevel = relativePath.split('/')[0];
                if (topLevel) {
                    entries.add(topLevel);
                }
            }
        }

        return Array.from(entries).sort();
    }

    isDirectory(path: string): boolean {
        return this.directories.has(this.normalizePath(path));
    }

    writeFile(path: string, content: string): void {
        const normalizedPath = this.normalizePath(path);
        const dirPath = this.getDirectoryPath(normalizedPath);

        if (!this.directories.has(dirPath)) {
            this.createDirectory(dirPath);
        }

        this.files.set(normalizedPath, content);
    }

    readFile(path: string): string | undefined {
        return this.files.get(this.normalizePath(path));
    }

    deleteFile(path: string, recursive = false): void {
        const normalizedPath = this.normalizePath(path);
        if (!this.files.has(normalizedPath)) {
            throw new Error(`File not found: ${path}`);
        }
        this.files.delete(normalizedPath);
    }

    listFiles(): string[] {
        return Array.from(this.files.keys());
    }

    resolveModulePath(specifier: string, basePath: string = ''): string {
        const normalizedBasePath = this.normalizePath(basePath);

        let resolvedPath: string;

        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            const baseDir = normalizedBasePath.endsWith('/') ?
                normalizedBasePath :
                normalizedBasePath + '/';

            // Split paths into segments and handle .. navigation
            const baseSegments = baseDir.split('/').filter(Boolean);
            const specSegments = specifier.split('/').filter(Boolean);

            const resultSegments = [...baseSegments];

            for (const segment of specSegments) {
                if (segment === '..') {
                    if (resultSegments.length === 0) {
                        throw new Error(`Invalid path: ${specifier} goes beyond root from ${basePath}`);
                    }
                    resultSegments.pop();
                } else if (segment !== '.') {
                    resultSegments.push(segment);
                }
            }

            resolvedPath = '/' + resultSegments.join('/');
        } else {
            resolvedPath = this.normalizePath(specifier);
        }

        // Check for file existence
        if (this.files.has(resolvedPath)) {
            return resolvedPath;
        }

        for (const ext of ['.js', '.mjs']) {
            const withExt = `${resolvedPath}${ext}`;
            if (this.files.has(withExt)) {
                return withExt;
            }
        }

        throw new Error(`Module not found: ${specifier} (resolved to ${resolvedPath})`);
    }
}