import pako from 'pako';
import { FileSystemManager } from './fs-manager';
import { Logger } from './logger';
import { fs, Stats } from '@zenfs/core';
import { Buffer } from 'buffer';

interface FSNode {
    type: 'file' | 'directory';
    name: string;
    content?: string | Buffer;
    mode?: number;
    children?: { [name: string]: FSNode };
}

export interface FSSnapshot {
    version: string;
    timestamp: number;
    root: FSNode;
}

export class FileSystemSnapshot {
    private static readonly SNAPSHOT_VERSION = '1.0';

    constructor(
        private fsManager: FileSystemManager,
        private logger: Logger
    ) { }

    async createSnapshot(): Promise<FSSnapshot> {
        this.logger.log('Creating filesystem snapshot');

        const snapshot: FSSnapshot = {
            version: FileSystemSnapshot.SNAPSHOT_VERSION,
            timestamp: Date.now(),
            root: await this.serializeDirectory('/')
        };

        return snapshot;
    }

    private async serializeDirectory(path: string): Promise<FSNode> {
        const stats = await this.fsManager.stat(path);
        const node: FSNode = {
            type: 'directory',
            name: path.split('/').pop() || '/',
            mode: stats.mode,
            children: {}
        };

        const entries = await this.fsManager.readdir(path);

        for (const entry of entries) {
            // Convert Dirent to string for the key
            const entryName = entry instanceof fs.Dirent ? entry.name : entry;
            const fullPath = path === '/' ? `/${entryName}` : `${path}/${entryName}`;
            const entryStats = await this.fsManager.stat(fullPath);

            if (entryStats.isDirectory()) {
                node.children![entryName] = await this.serializeDirectory(fullPath);
            } else if (entryStats.isFile()) {
                node.children![entryName] = await this.serializeFile(fullPath, entryStats);
            }
        }

        return node;
    }

    private async serializeFile(path: string, stats: Stats): Promise<FSNode> {
        let content = await this.fsManager.readFile(path);

        // Convert Uint8Array to Buffer if necessary
        if (content instanceof Uint8Array) {
            content = Buffer.from(content);
        }

        return {
            type: 'file',
            name: path.split('/').pop() || '',
            mode: stats.mode,
            content: content
        };
    }

    async saveSnapshotToFile(snapshot: FSSnapshot): Promise<Blob> {
        // Convert Buffers to base64 for JSON serialization
        const processed = this.processForSerialization(snapshot);
        const json = JSON.stringify(processed);

        // Compress using gzip
        const compressed = pako.gzip(json);
        return new Blob([compressed], { type: 'application/x-gzip' });
    }

    private processForSerialization(node: any): any {
        if (Buffer.isBuffer(node)) {
            return {
                _type: 'Buffer',
                data: node.toString('base64')
            };
        }

        if (node instanceof Uint8Array) {
            return {
                _type: 'Buffer',
                data: Buffer.from(node).toString('base64')
            };
        }

        if (node && typeof node === 'object') {
            const processed: any = Array.isArray(node) ? [] : {};
            for (const [key, value] of Object.entries(node)) {
                processed[key] = this.processForSerialization(value);
            }
            return processed;
        }

        return node;
    }

    private processFromSerialization(node: any): any {
        if (node && typeof node === 'object') {
            if (node._type === 'Buffer') {
                return Buffer.from(node.data, 'base64');
            }

            const processed: any = Array.isArray(node) ? [] : {};
            for (const [key, value] of Object.entries(node)) {
                processed[key] = this.processFromSerialization(value);
            }
            return processed;
        }

        return node;
    }

    async loadSnapshot(snapshot: FSSnapshot): Promise<void> {
        this.logger.log('Loading filesystem snapshot');

        if (snapshot.version !== FileSystemSnapshot.SNAPSHOT_VERSION) {
            throw new Error(`Incompatible snapshot version: ${snapshot.version}`);
        }

        await this.restoreNode('/', snapshot.root);
        this.logger.log('Filesystem snapshot loaded successfully');
    }

    private async restoreNode(path: string, node: FSNode): Promise<void> {
        const fullPath = path === '/' ? `/${node.name}` : `${path}/${node.name}`;

        if (node.type === 'directory') {
            await this.fsManager.mkdir(fullPath, { recursive: true });
            if (node.mode !== undefined) {
                await this.fsManager.chmod(fullPath, node.mode);
            }

            if (node.children) {
                for (const [name, childNode] of Object.entries(node.children)) {
                    await this.restoreNode(fullPath, childNode);
                }
            }
        } else if (node.type === 'file') {
            await this.fsManager.writeFile(fullPath, node.content!);
            if (node.mode !== undefined) {
                await this.fsManager.chmod(fullPath, node.mode);
            }
        }
    }

    async loadSnapshotFromBlob(blob: Blob): Promise<void> {
        const arrayBuffer = await blob.arrayBuffer();
        const compressed = new Uint8Array(arrayBuffer);
        const decompressed = pako.ungzip(compressed, { to: 'string' });
        const snapshot = this.processFromSerialization(JSON.parse(decompressed));
        await this.loadSnapshot(snapshot);
    }

    downloadSnapshot(snapshot: FSSnapshot, filename: string = 'fs-snapshot.gz'): void {
        this.saveSnapshotToFile(snapshot).then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        });
    }
}