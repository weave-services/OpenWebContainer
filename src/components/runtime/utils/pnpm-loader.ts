import { FileSystemManager } from '../services/fs-manager';
import { Logger } from '../services/logger';
import * as pako from 'pako';
import { pathUtils } from './path-utils';
import { TarUtility } from './tar-utility';
import { Buffer } from 'buffer';

export class PnpmTarballLoader {
    private static readonly PNPM_VERSION = '8.15.4';
    private static readonly PATHS = {
        root: '/usr/local/lib/node_modules/pnpm',
        bin: '/usr/local/bin/pnpm',
        config: '/usr/local/etc/pnpmrc',
        cache: '/tmp/pnpm-cache',
        store: '/tmp/pnpm-store'
    };

    // Size limits and skip patterns
    private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    private static readonly SKIP_PATTERNS = [
        '/man/',
        '/docs/',
        '/html/',
        '/changelogs/',
        '.md',
        '.markdown',
        '.map',
        'README',
        'CHANGELOG',
        'LICENSE',
        '.git'
    ];

    constructor(
        private fsManager: FileSystemManager,
        private logger: Logger
    ) { }

    async loadFromTarball(): Promise<void> {
        this.logger.log('Starting pnpm tarball installation');

        try {
            await this.createDirectoryStructure();
            await this.downloadAndExtractTarball();
            await this.createPnpmConfig();
            await this.createBinaryLinks();

            this.logger.log('pnpm tarball installation completed');
        } catch (error) {
            this.logger.log('pnpm tarball installation failed', error);
            throw error;
        }
    }

    private async createDirectoryStructure(): Promise<void> {
        const directories = [
            PnpmTarballLoader.PATHS.root,
            '/usr/local/bin',
            '/usr/local/etc',
            PnpmTarballLoader.PATHS.cache,
            PnpmTarballLoader.PATHS.store
        ];

        for (const dir of directories) {
            await this.fsManager.mkdir(dir, { recursive: true });
        }
    }

    private async downloadAndExtractTarball(): Promise<void> {
        const tarballUrl = `https://registry.npmjs.org/pnpm/-/pnpm-${PnpmTarballLoader.PNPM_VERSION}.tgz`;

        this.logger.log(`Downloading pnpm tarball: ${tarballUrl}`);

        const response = await fetch(tarballUrl);
        if (!response.ok) {
            throw new Error(`Failed to download pnpm tarball: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const compressed = new Uint8Array(arrayBuffer);
        const decompressed = pako.ungzip(compressed);

        // Validate the tar archive
        if (!TarUtility.validate(decompressed)) {
            throw new Error('Invalid tar archive');
        }

        await this.extractTar(decompressed);
    }

    private shouldSkipFile(fileName: string, fileSize: number): boolean {
        // Skip large files
        if (fileSize > PnpmTarballLoader.MAX_FILE_SIZE) {
            this.logger.log(`Skipping large file: ${fileName} (${fileSize} bytes)`);
            return true;
        }

        // Skip unnecessary files/directories
        if (PnpmTarballLoader.SKIP_PATTERNS.some(pattern => fileName.includes(pattern))) {
            this.logger.log(`Skipping unnecessary file: ${fileName}`);
            return true;
        }

        return false;
    }

    private async extractTar(buffer: Uint8Array): Promise<void> {
        const files = await TarUtility.extract(buffer);
        let filesExtracted = 0;
        let filesSkipped = 0;

        for (const [fileName, content] of Object.entries(files)) {
            // Skip the "package" prefix from the tar
            const cleanFileName = fileName.replace(/^package\//, '');
            const fullPath = `${PnpmTarballLoader.PATHS.root}/${cleanFileName}`;

            if (this.shouldSkipFile(cleanFileName, content.length)) {
                filesSkipped++;
                continue;
            }

            try {
                const dir = pathUtils.dirname(fullPath);
                await this.fsManager.mkdir(dir, { recursive: true });

                // Write file in chunks if it's large
                if (content.length > 1024 * 1024) { // 1MB chunks
                    await this.writeFileInChunks(fullPath, content);
                } else {
                    await this.fsManager.writeFile(fullPath, content);
                }

                if (this.isExecutable(cleanFileName)) {
                    await this.fsManager.chmod(fullPath, 0o755);
                }

                filesExtracted++;
                this.logger.log(`Extracted: ${cleanFileName}`);
            } catch (error) {
                this.logger.log(`Failed to extract: ${cleanFileName}`, error);
                filesSkipped++;
            }
        }

        this.logger.log(`Extraction complete. Files extracted: ${filesExtracted}, skipped: ${filesSkipped}`);
    }

    private async writeFileInChunks(path: string, content: Buffer, chunkSize: number = 1024 * 1024): Promise<void> {
        const totalChunks = Math.ceil(content.length / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, content.length);
            const chunk = content.slice(start, end);

            if (i === 0) {
                await this.fsManager.writeFile(path, chunk);
            } else {
                await this.fsManager.appendFile(path, chunk);
            }
        }
    }

    private isExecutable(filename: string): boolean {
        return filename.includes('/bin/') ||
            filename.endsWith('.sh') ||
            filename.endsWith('.cmd') ||
            filename.endsWith('.ps1');
    }

    private async createPnpmConfig(): Promise<void> {
        const pnpmrcContent = `
registry=https://registry.npmjs.org/
cache-dir=${PnpmTarballLoader.PATHS.cache}
store-dir=${PnpmTarballLoader.PATHS.store}
global-dir=/usr/local
global-bin-dir=/usr/local/bin
node-linker=hoisted
strict-ssl=false
`.trim();

        await this.fsManager.writeFile(PnpmTarballLoader.PATHS.config, pnpmrcContent);
    }

    private async createBinaryLinks(): Promise<void> {
        const pnpmCliPath = `${PnpmTarballLoader.PATHS.root}/bin/pnpm.cjs`;

        // Create symlink to pnpm.cjs
        const cliContent = await this.fsManager.readFile(pnpmCliPath);
        await this.fsManager.writeFile(PnpmTarballLoader.PATHS.bin, cliContent);
        await this.fsManager.chmod(PnpmTarballLoader.PATHS.bin, 0o755);
    }
}