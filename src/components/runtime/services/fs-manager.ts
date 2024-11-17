// fs-manager.ts

import {
    fs,
    configure,
    InMemory,
    MountConfiguration,
    Backend,
    Stats,
    Dirent,
} from '@zenfs/core';
import { Logger } from './logger';
import { pathUtils } from '../utils/path-utils';
import { EventEmitter } from 'events';
import { ObjectEncodingOptions } from 'fs';
import { ReaddirOptions } from '@zenfs/core/emulation/shared.js';

interface FSWatcher extends EventEmitter {
    close(): void;
}

interface WatchOptions {
    persistent?: boolean;
    recursive?: boolean;
    encoding?: string;
}

interface ReadStreamOptions {
    flags?: string;
    encoding?: string;
    fd?: number;
    mode?: number;
    autoClose?: boolean;
    emitClose?: boolean;
    start?: number;
    end?: number;
    highWaterMark?: number;
}

interface WriteStreamOptions {
    flags?: string;
    encoding?: string;
    fd?: number;
    mode?: number;
    autoClose?: boolean;
    emitClose?: boolean;
    start?: number;
}

export class FileSystemManager {
    private logger: Logger;
    private watchers: Map<string, Set<FSWatcher>>;
    private openFiles: Map<number, any>;
    private nextFileDescriptor: number;
    private initialized: boolean;

    constructor(logger: Logger) {
        this.logger = logger;
        this.watchers = new Map();
        this.openFiles = new Map();
        this.nextFileDescriptor = 3; // Start after stdin(0), stdout(1), stderr(2)
        this.initialized = false;
    }

    public async initialize(mounts: { [path: string]: MountConfiguration<Backend> }): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            this.logger.log('Initializing file system');

            // Configure default mounts if none provided
            const defaultMounts: { [path: string]: MountConfiguration<Backend> } = {
                '/': InMemory,
                '/tmp': InMemory,
                ...mounts
            };

            await configure({
                mounts: defaultMounts,
                addDevices: true
            });

            // Create essential directories
            await this.createEssentialDirectories();

            this.initialized = true;
            this.logger.log('File system initialized successfully');
        } catch (error) {
            this.logger.log('Failed to initialize file system', error);
            throw new Error(`File system initialization failed: ${error}`);
        }
    }

    private async createEssentialDirectories(): Promise<void> {
        const directories = [
            '/bin',
            '/etc',
            '/home',
            '/tmp',
            '/usr',
            '/usr/local',
            '/usr/local/bin',
            '/usr/local/lib',
            '/var',
            '/var/log',
            '/node_modules'
        ];

        for (const dir of directories) {
            try {
                await this.mkdir(dir, { recursive: true });
            } catch (error) {
                if ((error as any).code !== 'EEXIST') {
                    throw error;
                }
            }
        }
    }

    // File Operations
    public async readFile(path: string, options?: any): Promise<string | Buffer> {
        try {
            const content = await fs.promises.readFile(path, options);
            return content;
        } catch (error) {
            this.logger.log(`Error reading file ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async writeFile(path: string, data: string | Buffer, options?: any): Promise<void> {
        try {
            const dir = pathUtils.dirname(path);
            await this.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(path, data, options);
        } catch (error) {
            this.logger.log(`Error writing file ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async appendFile(path: string, data: string | Buffer, options?: any): Promise<void> {
        try {
            const dir = pathUtils.dirname(path);
            await this.mkdir(dir, { recursive: true });
            await fs.promises.appendFile(path, data, options);
        } catch (error) {
            this.logger.log(`Error appending to file ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async unlink(path: string): Promise<void> {
        try {
            await fs.promises.unlink(path);
        } catch (error) {
            this.logger.log(`Error unlinking file ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async rename(oldPath: string, newPath: string): Promise<void> {
        try {
            await fs.promises.rename(oldPath, newPath);
        } catch (error) {
            this.logger.log(`Error renaming ${oldPath} to ${newPath}`, error);
            throw this.mapError(error);
        }
    }

    // Directory Operations
    public async mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
        try {
            await fs.promises.mkdir(path, options);
        } catch (error) {
            this.logger.log(`Error creating directory ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async rmdir(path: string): Promise<void> {
        try {
            await fs.promises.rmdir(path);
        } catch (error) {
            this.logger.log(`Error removing directory ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async readdir(path: string, options?: (ObjectEncodingOptions & ReaddirOptions & {
        withFileTypes?: false;
    }) | BufferEncoding | null): Promise<string[] | Dirent[]> {
        try {
            return await fs.promises.readdir(path, options);
        } catch (error) {
            this.logger.log(`Error reading directory ${path}`, error);
            throw this.mapError(error);
        }
    }

    // File Information
    public async stat(path: string): Promise<Stats> {
        try {
            return await fs.promises.stat(path);
        } catch (error) {
            this.logger.log(`Error getting stats for ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async lstat(path: string): Promise<Stats> {
        try {
            return await fs.promises.lstat(path);
        } catch (error) {
            this.logger.log(`Error getting lstat for ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async access(path: string, mode?: number): Promise<void> {
        try {
            await fs.promises.access(path, mode);
        } catch (error) {
            this.logger.log(`Error checking access for ${path}`, error);
            throw this.mapError(error);
        }
    }

    // File Descriptors
    public async open(path: string, flags: string, mode?: number): Promise<number> {
        try {
            const fileHandle = await fs.promises.open(path, flags, mode);
            const fd = this.nextFileDescriptor++;
            this.openFiles.set(fd, fileHandle);
            return fd;
        } catch (error) {
            this.logger.log(`Error opening file ${path}`, error);
            throw this.mapError(error);
        }
    }

    public async close(fd: number): Promise<void> {
        const fileHandle = this.openFiles.get(fd);
        if (!fileHandle) {
            throw new Error('EBADF: bad file descriptor');
        }

        try {
            await fileHandle.close();
            this.openFiles.delete(fd);
        } catch (error) {
            this.logger.log(`Error closing file descriptor ${fd}`, error);
            throw this.mapError(error);
        }
    }

    public async read(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): Promise<number> {
        const fileHandle = this.openFiles.get(fd);
        if (!fileHandle) {
            throw new Error('EBADF: bad file descriptor');
        }

        try {
            const { bytesRead } = await fileHandle.read(buffer, offset, length, position);
            return bytesRead;
        } catch (error) {
            this.logger.log(`Error reading from file descriptor ${fd}`, error);
            throw this.mapError(error);
        }
    }

    public async write(fd: number, buffer: Buffer, offset: number, length: number, position: number | null): Promise<number> {
        const fileHandle = this.openFiles.get(fd);
        if (!fileHandle) {
            throw new Error('EBADF: bad file descriptor');
        }

        try {
            const { bytesWritten } = await fileHandle.write(buffer, offset, length, position);
            return bytesWritten;
        } catch (error) {
            this.logger.log(`Error writing to file descriptor ${fd}`, error);
            throw this.mapError(error);
        }
    }

    // File System Watching
    public watch(filename: string, listener?: any): FSWatcher {
        const watcher = new EventEmitter() as FSWatcher;

        if (!this.watchers.has(filename)) {
            this.watchers.set(filename, new Set());
        }

        this.watchers.get(filename)!.add(watcher);

        if (listener) {
            watcher.on('change', listener);
        }

        watcher.close = () => {
            const watcherSet = this.watchers.get(filename);
            if (watcherSet) {
                watcherSet.delete(watcher);
                if (watcherSet.size === 0) {
                    this.watchers.delete(filename);
                }
            }
        };

        return watcher;
    }

    // Utility Methods
    public async exists(path: string): Promise<boolean> {
        try {
            await this.access(path);
            return true;
        } catch {
            return false;
        }
    }

    public async copyFile(src: string, dest: string, flags?: number): Promise<void> {
        try {
            await fs.promises.copyFile(src, dest, flags);
        } catch (error) {
            this.logger.log(`Error copying file from ${src} to ${dest}`, error);
            throw this.mapError(error);
        }
    }

    public async chmod(path: string, mode: number): Promise<void> {
        try {
            await fs.promises.chmod(path, mode);
        } catch (error) {
            this.logger.log(`Error changing mode for ${path}`, error);
            throw this.mapError(error);
        }
    }

    private mapError(error: any): Error {
        // Map error codes to standard Node.js fs error codes
        const errorMap: { [key: string]: string } = {
            'ENOENT': 'no such file or directory',
            'EEXIST': 'file already exists',
            'ENOTDIR': 'not a directory',
            'EISDIR': 'is a directory',
            'EACCES': 'permission denied',
            'EPERM': 'operation not permitted',
            'EBADF': 'bad file descriptor',
            'EINVAL': 'invalid argument',
            'EMFILE': 'too many open files',
            'ENOSPC': 'no space left on device',
            'EROFS': 'read-only file system',
            'EBUSY': 'resource busy',
            'ENOTEMPTY': 'directory not empty',
            'ETIMEDOUT': 'operation timed out'
        };

        const code = error.code || 'UNKNOWN';
        const message = errorMap[code] || error.message || 'Unknown error';

        const mappedError = new Error(`${code}: ${message}`);
        mappedError.stack = error.stack;
        (mappedError as any).code = code;

        return mappedError;
    }

    // Cleanup
    public async cleanup(): Promise<void> {
        // Close all open file descriptors
        for (const [fd, handle] of this.openFiles) {
            try {
                await handle.close();
            } catch (error) {
                this.logger.log(`Error closing file descriptor ${fd} during cleanup`, error);
            }
        }
        this.openFiles.clear();

        // Clear all watchers
        for (const [filename, watcherSet] of this.watchers) {
            for (const watcher of watcherSet) {
                watcher.close();
            }
        }
        this.watchers.clear();

        this.initialized = false;
    }

    // Status methods
    public isInitialized(): boolean {
        return this.initialized;
    }

    public getOpenFileCount(): number {
        return this.openFiles.size;
    }

    public getWatcherCount(): number {
        let count = 0;
        for (const watcherSet of this.watchers.values()) {
            count += watcherSet.size;
        }
        return count;
    }
}