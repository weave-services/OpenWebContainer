import { ShellCommand, CommandHelp, CommandOptions } from './base';
import { ShellCommandResult } from '../types';
import { ProcessEvent } from '../../process';
import { unzip, inflate, gunzip, type Unzipped } from 'fflate';

interface FileEntry {
    name: string;
    size: number;
    type: 'file' | 'directory';
    content: Uint8Array;
    mode?: number;
    mtime?: Date;
}

export class UnzipCommand extends ShellCommand {
    constructor(options: CommandOptions) {
        super(options);
    }

    get help(): CommandHelp {
        return {
            name: 'unzip',
            description: 'Extract compressed zip or tgz files',
            usage: `Usage: unzip [options] <file.zip|file.tgz> [destination]

Options:
  -l    List contents without extracting
  -v    Verbose mode showing file details
  -q    Quiet mode, suppress output
  -d    Extract files into directory
  --help Show this help message`,
            examples: [
                'unzip archive.zip',
                'unzip file.tgz output/',
                'unzip -l archive.zip',
                'unzip -v package.tgz',
                'unzip -d /target/dir archive.zip'
            ]
        };
    }

    async execute(args: string[]): Promise<ShellCommandResult> {
        try {
            if (args.includes('--help')) {
                return this.showHelp();
            }

            if (args.length === 0) {
                return this.error('unzip: filename required');
            }

            // Parse options
            const options = {
                listOnly: args.includes('-l'),
                verbose: args.includes('-v'),
                quiet: args.includes('-q')
            };

            // Remove flags and process -d option
            let destination = '.';
            const cleanArgs = args.filter((arg, index) => {
                if (arg === '-d' && args[index + 1]) {
                    destination = args[index + 1];
                    return false;
                }
                return !arg.startsWith('-');
            });

            const filename = cleanArgs[0];
            destination = cleanArgs[1] || destination;

            // Resolve paths
            const filepath = this.resolvePath(filename);
            const content = this.fileSystem.readBuffer(filepath);
            if (!content) {
                return this.error(`unzip: cannot find ${filename}`);
            }
            const uint8Array = new Uint8Array(content?.buffer, 0, content.length);

            // Process based on file type
            if (filename.endsWith('.tgz') || filename.endsWith('.tar.gz')) {
                return this.handleTarGz(filename, uint8Array, destination, options);
            } else {
                return this.handleZip(filename, uint8Array, destination, options);
            }

        } catch (error: any) {
            return this.error(`unzip: ${error.message}`);
        }
    }
    private async handleTarGz(
        filename: string,
        content: Uint8Array,
        destination: string,
        options: { listOnly: boolean; verbose: boolean; quiet: boolean; }
    ): Promise<ShellCommandResult> {
        try {
            // First decompress with gunzip
            const inflated = await new Promise<Uint8Array>((resolve, reject) => {
                gunzip(content, (err, result) => {
                    if (err) {
                        // Try regular inflate if gunzip fails
                        inflate(content, (err2, result2) => {
                            if (err2) {
                                reject(new Error('Cannot decompress file. File may be corrupted.'));
                            } else {
                                resolve(result2);
                            }
                        });
                    } else {
                        resolve(result);
                    }
                });
            });

            if (!inflated || inflated.length === 0) {
                return this.error(`Decompressed file is empty: ${filename}`);
            }

            // Parse tar
            const files = this.parseTar(inflated);
            const outputLines: string[] = [];

            if (!options.quiet) {
                outputLines.push(`Archive:  ${filename}`);
            }

            if (options.listOnly) {
                outputLines.push('  Length      Date    Time    Name');
                outputLines.push('---------  ---------- -----   ----');

                let totalSize = 0;
                let totalFiles = 0;

                for (const file of files) {
                    if (file.type === 'file') {
                        totalSize += file.size;
                        totalFiles++;
                        const date = file.mtime || new Date();
                        const dateStr = date.toISOString().split('T')[0];
                        const timeStr = date.toTimeString().slice(0, 5);
                        outputLines.push(
                            `${file.size.toString().padStart(9)}  ` +
                            `${dateStr} ${timeStr}   ${file.name}`
                        );
                    }
                }

                outputLines.push('---------                     -------');
                outputLines.push(`${totalSize.toString().padStart(9)}                     ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`);

                return this.success(outputLines.join('\n'));
            }

            // Extract files
            let extractedCount = 0;
            const destPath = this.resolvePath(destination);

            for (const file of files) {
                const fullPath = `${destPath}/${file.name}`.replace(/\/+/g, '/');

                if (file.type === 'directory') {
                    this.fileSystem.createDirectory(fullPath);
                    if (options.verbose && !options.quiet) {
                        outputLines.push(`   creating: ${file.name}/`);
                    }
                } else {
                    // Ensure parent directory exists
                    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
                    if (parentDir) {
                        this.fileSystem.createDirectory(parentDir);
                    }

                    // Convert content to base64 in chunks
                    const content = this.uint8ArrayToBase64(file.content);
                    this.fileSystem.writeFile(fullPath, content);

                    if (!options.quiet) {
                        if (options.verbose) {
                            outputLines.push(` extracting: ${file.name}`);
                        } else {
                            this.log('.', false);
                        }
                    }
                    extractedCount++;
                }
            }

            if (!options.quiet) {
                if (!options.verbose) {
                    outputLines.push(''); // New line after dots
                }
                outputLines.push(`${extractedCount} file${extractedCount !== 1 ? 's' : ''} extracted`);
            }

            return this.success(outputLines.join('\n'));

        } catch (error: any) {
            return this.error(`Cannot expand tar.gz: ${error.message}`);
        }
    }

    private uint8ArrayToBase64(array: Uint8Array): string {
        const CHUNK_SIZE = 32 * 1024; // 32KB chunks
        let base64 = '';

        for (let i = 0; i < array.length; i += CHUNK_SIZE) {
            const chunk = array.slice(i, Math.min(i + CHUNK_SIZE, array.length));
            const binaryString = Array.from(chunk)
                .map(byte => String.fromCharCode(byte))
                .join('');
            base64 += btoa(binaryString);
        }

        return base64;
    }

    private handleZip(
        filename: string,
        content: Uint8Array,
        destination: string,
        options: { listOnly: boolean; verbose: boolean; quiet: boolean; }
    ): Promise<ShellCommandResult> {
        return new Promise((resolve, reject) => {
            unzip(content, (err, unzipped: Unzipped) => {
                if (err) {
                    resolve(this.error(`Cannot expand zip: ${err.message}`));
                    return;
                }

                const outputLines: string[] = [];
                if (!options.quiet) {
                    outputLines.push(`Archive:  ${filename}`);
                }

                if (options.listOnly) {
                    outputLines.push('  Length      Date    Time    Name');
                    outputLines.push('---------  ---------- -----   ----');

                    let totalSize = 0;
                    let totalFiles = 0;

                    // Process files and get their sizes
                    for (const [path, file] of Object.entries(unzipped)) {
                        const fileSize = file.length;
                        totalSize += fileSize;
                        totalFiles++;

                        const date = new Date();
                        const dateStr = date.toISOString().split('T')[0];
                        const timeStr = date.toTimeString().slice(0, 5);
                        outputLines.push(
                            `${fileSize.toString().padStart(9)}  ` +
                            `${dateStr} ${timeStr}   ${path}`
                        );
                    }

                    outputLines.push('---------                     -------');
                    outputLines.push(`${totalSize.toString().padStart(9)}                     ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`);

                    resolve(this.success(outputLines.join('\n')));
                    return;
                }

                // Extract files
                let extractedCount = 0;
                const destPath = this.resolvePath(destination);

                try {
                    for (const [path, file] of Object.entries(unzipped)) {
                        const fullPath = `${destPath}/${path}`.replace(/\/+/g, '/');

                        // Ensure parent directory exists
                        const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
                        if (parentDir) {
                            this.fileSystem.createDirectory(parentDir);
                        }

                        // Convert to base64 using chunked method
                        const content = this.uint8ArrayToBase64(file);
                        this.fileSystem.writeFile(fullPath, content);

                        if (!options.quiet) {
                            if (options.verbose) {
                                outputLines.push(` extracting: ${path} (${this.formatSize(file.length)})`);
                            } else {
                                this.log('.', false);
                            }
                        }
                        extractedCount++;
                    }

                    if (!options.quiet) {
                        if (!options.verbose) {
                            outputLines.push(''); // New line after dots
                        }
                        outputLines.push(`${extractedCount} file${extractedCount !== 1 ? 's' : ''} extracted`);
                    }

                    resolve(this.success(outputLines.join('\n')));
                } catch (error: any) {
                    resolve(this.error(`Error extracting files: ${error.message}`));
                }
            });
        });
    }

    private parseTar(buffer: Uint8Array): FileEntry[] {
        const files: FileEntry[] = [];
        let offset = 0;

        while (offset < buffer.length - 512) {
            // Read header block
            const header = buffer.slice(offset, offset + 512);

            // Check for end of archive (two consecutive zero blocks)
            if (header.every(byte => byte === 0)) {
                break;
            }

            // Parse header fields
            const name = this.parseString(header, 0, 100).replace(/\0/g, '');
            const mode = parseInt(this.parseString(header, 100, 8), 8);
            const size = parseInt(this.parseString(header, 124, 12).trim(), 8);
            const mtime = new Date(parseInt(this.parseString(header, 136, 12).trim(), 8) * 1000);
            const typeflag = String.fromCharCode(header[156]);
            const linkname = this.parseString(header, 157, 100).replace(/\0/g, '');

            // Move past header
            offset += 512;

            if (typeflag === '5') {
                // Directory
                files.push({
                    name,
                    size: 0,
                    type: 'directory',
                    content: new Uint8Array(0),
                    mode,
                    mtime
                });
            } else if (typeflag === '0' || typeflag === '' || typeflag === '7') {
                // Regular file or high-performance file
                const content = buffer.slice(offset, offset + size);
                files.push({
                    name,
                    size,
                    type: 'file',
                    content,
                    mode,
                    mtime
                });

                // Move to next block boundary
                offset += Math.ceil(size / 512) * 512;
            }
            // Skip other types (links, etc.)
        }

        return files;
    }

    private parseString(buffer: Uint8Array, offset: number, size: number): string {
        return Array.from(buffer.slice(offset, offset + size))
            .map(byte => String.fromCharCode(byte))
            .join('');
    }

    private formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    }

    private log(message: string, newline: boolean = true) {
        this.process.emit(ProcessEvent.MESSAGE, { stdout: message + (newline ? '\n' : '') });
    }
}