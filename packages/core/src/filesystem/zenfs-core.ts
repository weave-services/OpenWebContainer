// packages/core/src/filesystem/zenfs-core.ts
import { fs, normalizePath, configure } from '@zenfs/core';
import { IFileSystem, PackageMetadata } from './types';
import * as BrowserFS from '@zenfs/browserfs';
import * as InMemory from '@zenfs/memory';
import * as IndexedDB from '@zenfs/indexeddb';
import * as MountableFileSystem from '@zenfs/mountable';

export class ZenFSCore implements IFileSystem {
    private fs: typeof fs;

    constructor() {
        this.fs = fs;
        configure({
            '/': { backend: InMemory }
        });
    }

    // --- Existing methods (using async/await) ---
    async writeFile(path: string, content: string): Promise<void> {
        return this.fs.promises.writeFile(path, content, { encoding: 'utf-8' });
    }

    async readFile(path: string): Promise<string | undefined> {
        try {
            return await this.fs.promises.readFile(path, 'utf-8');
        } catch (error) {
            // Handle file not found, etc.
            return undefined;
        }
    }
    async readBuffer(path: string): Promise<Buffer | undefined> {
        try{
            return await this.fs.promises.readFile(path);
        }
        catch(error){
            return undefined;
        }
        
    }
    async writeBuffer(path: string, buffer: Buffer): Promise<void> {
        return await this.fs.promises.writeFile(path, buffer);
    }

    async deleteFile(path: string, recursive = false): Promise<void> {
        return this.fs.promises.rm(path, { recursive });
    }

    async listFiles(basePath: string = "/"): Promise<string[]> {
        const files = [];
        const items = await this.fs.promises.readdir(basePath, { withFileTypes: true });
        if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
        for (const item of items) {
            if (item.isDirectory()) {
                files.push(...(await this.listFiles(`${basePath}/${item.name}`)));
            } else {
                files.push(`${basePath}/${item.name}`);
            }
        }

        return files;
    }

    async resolvePath(path: string, basePath: string = ''): Promise<string> {
        // Note: normalizePath already makes paths absolute
        return normalizePath(this.fs.path.resolve(basePath, path));
    }

    async fileExists(path: string): Promise<boolean> {
        try {
            await this.fs.promises.access(path);
            return true;
        } catch {
            return false;
        }
    }

    async createDirectory(path: string): Promise<void> {
        return this.fs.promises.mkdir(path, { recursive: true });
    }

    async deleteDirectory(path: string): Promise<void> {
        return this.fs.promises.rmdir(path);
    }

    async listDirectory(path: string): Promise<string[]> {
        return this.fs.promises.readdir(path);
    }

    async isDirectory(path: string): Promise<boolean> {
        try {
            return (await this.fs.promises.lstat(path)).isDirectory();
        } catch {
            return false; // Consider throwing if it's not a "not found" error.
        }
    }

    normalizePath(path: string): string {
        return normalizePath(path);
    }

    // --- New methods for package support ---

    async loadPackage(pkg: PackageMetadata): Promise<void> {
        const packagePath = `/node_modules/${pkg.name}`;
        await this.createDirectory(packagePath); // Ensure directory exists

        for (const [relativePath, content] of Object.entries(pkg.files)) {
            const filePath = `${packagePath}/${relativePath}`;
            const dirPath = this.fs.path.dirname(filePath);
            if (!await this.fileExists(dirPath)) {
                await this.createDirectory(dirPath);
            }
            await this.writeFile(filePath, content);
        }
    }
    async loadNodeModules(modules: Record<string, string>): Promise<void> {
        for (const [path, content] of Object.entries(modules)) {
            const fullPath = `/node_modules/${path}`;
            const dir = this.fs.path.dirname(fullPath);
            if (!await this.isDirectory(dir)) {
                await this.createDirectory(dir);
            }
            await this.writeFile(fullPath, content);
        }
    }

    async packageExists(packageName: string, version?: string): Promise<boolean> {
        // Simplified check: just see if the directory exists
        const packagePath = `/node_modules/${packageName}`;
        return this.isDirectory(packagePath);
    }

    async resolvePackagePath(packageName: string, basePath: string = '/'): Promise<string> {
        const directPath = this.fs.path.resolve(basePath, 'node_modules', packageName);
        if (await this.isDirectory(directPath)) {
            let packageJson = await this.readFile(`${directPath}/package.json`);

            if (packageJson) {
                try {
                    const parsed = JSON.parse(packageJson);
                    return this.fs.path.resolve(directPath, parsed.main || 'index.js');
                }
                catch (error) {
                    throw error;
                }

            }
            else {
                return this.fs.path.resolve(directPath, 'index.js');
            }
        }
        // rudimentary search in parent directories
        if (basePath == '/') throw new Error(`Module ${packageName} not found`);
        return this.resolvePackagePath(packageName, await this.resolvePath('..', basePath));
    }


    async resolveModulePath(specifier: string, basePath: string = ''): Promise<string> {

        const normalizedBasePath = this.normalizePath(basePath);

        let resolvedPath: string;
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            // Relative path
            resolvedPath = await this.resolvePath(specifier, normalizedBasePath.endsWith('/') ? normalizedBasePath : this.fs.path.dirname(normalizedBasePath));
        } else if (specifier.startsWith('/')) {
            // Absolute path
            resolvedPath = this.normalizePath(specifier);
        }
        else {
            // treat as module
            return this.resolvePackagePath(specifier, normalizedBasePath);
        }


        // Check for file existence
        if (await this.fileExists(resolvedPath)) {
            let stat = await this.fs.promises.lstat(resolvedPath)
            if (stat.isFile()) return resolvedPath;
            else if (stat.isDirectory()) {
                let indexPath = this.normalizePath(`${resolvedPath}/index`)
                let exts = ['.js', '.mjs', '.cjs', '.json']
                for (const ext of exts) {
                    const withExt = `${indexPath}${ext}`;
                    if (await this.fileExists(withExt)) {
                        return withExt;
                    }
                }

            }
        }

        for (const ext of ['.js', '.mjs', '.cjs', '.json']) {
            const withExt = `${resolvedPath}${ext}`;
            if (await this.fileExists(withExt)) {
                return withExt;
            }
        }

        throw new Error(`Module not found: ${specifier} (resolved to ${resolvedPath})`);
    }
}
