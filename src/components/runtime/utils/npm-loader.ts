import { FileSystemManager } from '../services/fs-manager';
import { Logger } from '../services/logger';
import * as pako from 'pako';
import { pathUtils } from './path-utils';
import { Buffer } from 'buffer';
import { TarUtility } from './tar-utility';




export class NpmTarballLoader {
    private static readonly NPM_VERSION = '10.2.4';
    private static readonly PATHS = {
        root: '/usr/local/lib/node_modules/npm',
        bin: '/usr/local/bin/npm',
        config: '/usr/local/etc/npmrc',
        cache: '/tmp/npm-cache'
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
        this.logger.log('Starting npm tarball installation');

        try {
            await this.createDirectoryStructure();
            await this.downloadAndExtractTarball();
            await this.createNpmConfig();
            await this.createBinaryLinks();

            this.logger.log('npm tarball installation completed');
        } catch (error) {
            this.logger.log('npm tarball installation failed', error);
            throw error;
        }
    }

    private async createDirectoryStructure(): Promise<void> {
        const directories = [
            NpmTarballLoader.PATHS.root,
            '/usr/local/bin',
            '/usr/local/etc',
            NpmTarballLoader.PATHS.cache
        ];

        for (const dir of directories) {
            await this.fsManager.mkdir(dir, { recursive: true });
        }
    }

    private shouldSkipFile(fileName: string, fileSize: number): boolean {
        // Skip large files
        if (fileSize > NpmTarballLoader.MAX_FILE_SIZE) {
            this.logger.log(`Skipping large file: ${fileName} (${fileSize} bytes)`);
            return true;
        }

        // Skip unnecessary files/directories
        if (NpmTarballLoader.SKIP_PATTERNS.some(pattern => fileName.includes(pattern))) {
            this.logger.log(`Skipping unnecessary file: ${fileName}`);
            return true;
        }

        return false;
    }
    public async downloadAndExtractTarball(): Promise<void> {
        const tarballUrl = `https://registry.npmjs.org/npm/-/npm-${NpmTarballLoader.NPM_VERSION}.tgz`;

        this.logger.log(`Downloading npm tarball: ${tarballUrl}`);

        const response = await fetch(tarballUrl);
        if (!response.ok) {
            throw new Error(`Failed to download npm tarball: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const compressed = new Uint8Array(arrayBuffer);

        this.logger.log('Decompressing tarball...');
        const decompressed = pako.ungzip(compressed);

        this.logger.log('Extracting tarball...');
        await this.extractTar(decompressed);
    }

    private async extractTar(tarData: Uint8Array): Promise<void> {
        try {
            // Validate the tar file
            if (!TarUtility.validate(tarData)) {
                throw new Error('Invalid tar file');
            }

            // Extract all files from the tar
            const files = await TarUtility.extract(tarData);

            // Process and write each file
            for (const [path, content] of Object.entries(files)) {
                try {
                    // npm tarballs typically have a "package" prefix directory
                    // we need to strip it and remap to our desired location
                    const relativePath = path.replace(/^package\//, '');
                    const targetPath = pathUtils.join('/usr/local/lib/node_modules/npm', relativePath);

                    // Create the directory structure
                    const dir = pathUtils.dirname(targetPath);
                    await this.fsManager.mkdir(dir, { recursive: true });

                    let buff: Buffer
                    if (content instanceof Uint8Array) {
                        buff = Buffer.from(content);
                    } else {
                        buff = content;
                    }

                    // Write the file
                    await this.fsManager.writeFile(targetPath, buff);

                    this.logger.log(`Extracted: ${targetPath}`);
                } catch (error) {
                    this.logger.log(`Error extracting file ${path}:`, error);
                    throw error;
                }
            }

            // Create necessary symlinks
            await this.createNpmSymlinks();

            this.logger.log('npm installation completed successfully');
        } catch (error) {
            this.logger.log('Error extracting tar:', error);
            throw new Error(`Failed to extract npm: ${error}`);
        }
    }

    private async createNpmSymlinks(): Promise<void> {
        try {
            // Ensure bin directory exists
            await this.fsManager.mkdir('/usr/local/bin', { recursive: true });

            // Create npm command file
            const npmScript = `#!/usr/bin/env node
require('/usr/local/lib/node_modules/npm/bin/npm-cli.js')`;

            await this.fsManager.writeFile('/usr/local/bin/npm', npmScript);
            await this.fsManager.chmod('/usr/local/bin/npm', 0o755);

            // Create npx command file
            const npxScript = `#!/usr/bin/env node
require('/usr/local/lib/node_modules/npm/bin/npx-cli.js')`;

            await this.fsManager.writeFile('/usr/local/bin/npx', npxScript);
            await this.fsManager.chmod('/usr/local/bin/npx', 0o755);

            this.logger.log('Created npm and npx command files');
        } catch (error) {
            this.logger.log('Error creating npm symlinks:', error);
            throw error;
        }
    }

    public async verify(): Promise<boolean> {
        try {
            // Check for essential npm files
            const essentialPaths = [
                '/usr/local/lib/node_modules/npm/package.json',
                '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
                '/usr/local/lib/node_modules/npm/bin/npx-cli.js',
                '/usr/local/bin/npm',
                '/usr/local/bin/npx'
            ];

            for (const path of essentialPaths) {
                if (!await this.fsManager.exists(path)) {
                    this.logger.log(`Missing essential npm file: ${path}`);
                    return false;
                }
            }

            // Verify npm package.json
            const packageJsonContent = await this.fsManager.readFile(
                '/usr/local/lib/node_modules/npm/package.json',
                'utf8'
            );
            const packageJson = JSON.parse(packageJsonContent.toString());

            if (packageJson.version !== NpmTarballLoader.NPM_VERSION) {
                this.logger.log(`Version mismatch: expected ${NpmTarballLoader.NPM_VERSION}, got ${packageJson.version}`);
                return false;
            }

            return true;
        } catch (error) {
            this.logger.log('Error verifying npm installation:', error);
            return false;
        }
    }

    public static getVersion(): string {
        return NpmTarballLoader.NPM_VERSION;
    }

    private async createNpmConfig(): Promise<void> {
        const npmrcContent = `
registry=https://registry.npmjs.org/
cache=${NpmTarballLoader.PATHS.cache}
prefix=/usr/local
strict-ssl=false
init-module=/tmp/.npm-init.js
tmp=${NpmTarballLoader.PATHS.cache}
global=true
`.trim();

        await this.fsManager.writeFile(NpmTarballLoader.PATHS.config, npmrcContent);
    }

    private async createBinaryLinks(): Promise<void> {
        const npmCliPath = `${NpmTarballLoader.PATHS.root}/bin/npm-cli.js`;

        // Create symlink to npm-cli.js
        const cliContent = await this.fsManager.readFile(npmCliPath);
        await this.fsManager.writeFile(NpmTarballLoader.PATHS.bin, cliContent);
        await this.fsManager.chmod(NpmTarballLoader.PATHS.bin, 0o755);
    }
}