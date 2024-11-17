// tar-utility.ts
import { Buffer } from 'buffer';
interface TarHeaderData {
    name: string;
    mode: number;
    uid: number;
    gid: number;
    size: number;
    mtime: number;
    checksum: number;
    typeflag: string;
    linkname: string;
    magic: string;
    version: string;
    uname: string;
    gname: string;
    devmajor: number;
    devminor: number;
    prefix: string;
}

interface TarEntry {
    headerBuffer: Uint8Array;
    content: Uint8Array;
}
export class TarUtility {
    private static readonly BLOCK_SIZE = 512;
    private static readonly HEADER_SIZE = 512;

    /**
     * Creates a TAR archive from files
     */
    public static async create(files: { [path: string]: string | Uint8Array | Buffer }): Promise<Uint8Array> {
        const entries: TarEntry[] = [];
        const encoder = new TextEncoder();

        for (const [path, content] of Object.entries(files)) {
            let contentBuffer: Uint8Array;
            if (content instanceof Uint8Array) {
                contentBuffer = content;
            } else if (Buffer.isBuffer(content)) {
                contentBuffer = new Uint8Array(content);
            } else {
                contentBuffer = encoder.encode(content);
            }

            // Calculate initial header without checksum
            const headerWithoutChecksum = this.createHeaderBuffer({
                name: path,
                size: contentBuffer.length,
                mode: 0o644,
                uid: 0,
                gid: 0,
                mtime: Math.floor(Date.now() / 1000),
                checksum: 0, // Initially set to 0
                typeflag: '0',
                linkname: '',
                magic: 'ustar',
                version: '00',
                uname: 'browseruser',
                gname: 'browsergroup',
                devmajor: 0,
                devminor: 0,
                prefix: ''
            });

            // Calculate checksum
            let checksum = 0;
            for (let i = 0; i < this.HEADER_SIZE; i++) {
                // Use spaces (ASCII 32) for the checksum field when calculating
                if (i >= 148 && i < 156) {
                    checksum += 32;
                } else {
                    checksum += headerWithoutChecksum[i];
                }
            }

            // Create final header with checksum
            const headerBuffer = this.createHeaderBuffer({
                name: path,
                size: contentBuffer.length,
                mode: 0o644,
                uid: 0,
                gid: 0,
                mtime: Math.floor(Date.now() / 1000),
                checksum: checksum,
                typeflag: '0',
                linkname: '',
                magic: 'ustar',
                version: '00',
                uname: 'browseruser',
                gname: 'browsergroup',
                devmajor: 0,
                devminor: 0,
                prefix: ''
            });

            entries.push({ headerBuffer, content: contentBuffer });
        }

        return this.packEntries(entries);
    }

    /**
     * Creates a TAR header buffer with the given header information
     */
    private static createHeaderBuffer(header: TarHeaderData): Uint8Array {
        const buffer = new Uint8Array(this.HEADER_SIZE);
        const encoder = new TextEncoder();

        // Helper function to write string to buffer
        const writeString = (str: string, offset: number, length: number) => {
            const encoded = encoder.encode(str);
            buffer.set(encoded.slice(0, length), offset);
        };

        // Helper function to write octal number
        const writeOctal = (num: number, offset: number, length: number) => {
            const octal = num.toString(8).padStart(length - 1, '0');
            writeString(octal + '\0', offset, length);
        };

        // Write header fields
        writeString(header.name, 0, 100);
        writeOctal(header.mode, 100, 8);
        writeOctal(header.uid, 108, 8);
        writeOctal(header.gid, 116, 8);
        writeOctal(header.size, 124, 12);
        writeOctal(header.mtime, 136, 12);
        writeOctal(header.checksum, 148, 8);
        writeString(header.typeflag, 156, 1);
        writeString(header.linkname, 157, 100);
        writeString(header.magic, 257, 6);
        writeString(header.version, 263, 2);
        writeString(header.uname, 265, 32);
        writeString(header.gname, 297, 32);
        writeOctal(header.devmajor, 329, 8);
        writeOctal(header.devminor, 337, 8);
        writeString(header.prefix, 345, 155);

        return buffer;
    }

    /**
     * Parses a TAR header buffer
     */
    private static parseHeader(buffer: Uint8Array): TarHeaderData {
        const decoder = new TextDecoder();

        // Helper function to read string
        const readString = (offset: number, length: number): string => {
            const slice = buffer.slice(offset, offset + length);
            const nullIndex = slice.indexOf(0);
            return decoder.decode(slice.slice(0, nullIndex !== -1 ? nullIndex : length)).trim();
        };

        // Helper function to read octal
        const readOctal = (offset: number, length: number): number => {
            const str = readString(offset, length);
            return str ? parseInt(str, 8) : 0;
        };

        return {
            name: readString(0, 100),
            mode: readOctal(100, 8),
            uid: readOctal(108, 8),
            gid: readOctal(116, 8),
            size: readOctal(124, 12),
            mtime: readOctal(136, 12),
            checksum: readOctal(148, 8),
            typeflag: readString(156, 1),
            linkname: readString(157, 100),
            magic: readString(257, 6),
            version: readString(263, 2),
            uname: readString(265, 32),
            gname: readString(297, 32),
            devmajor: readOctal(329, 8),
            devminor: readOctal(337, 8),
            prefix: readString(345, 155)
        };
    }

    /**
     * Packs entries into a TAR archive
     */
    private static packEntries(entries: TarEntry[]): Uint8Array {
        let totalSize = 0;

        // Calculate total size including padding
        entries.forEach(entry => {
            totalSize += this.HEADER_SIZE;
            totalSize += Math.ceil(entry.content.length / this.BLOCK_SIZE) * this.BLOCK_SIZE;
        });

        // Add two empty blocks at the end
        totalSize += this.BLOCK_SIZE * 2;

        const buffer = new Uint8Array(totalSize);
        let offset = 0;

        // Write entries
        entries.forEach(entry => {
            // Write header
            buffer.set(entry.headerBuffer, offset);
            offset += this.HEADER_SIZE;

            // Write content
            buffer.set(entry.content, offset);
            offset += Math.ceil(entry.content.length / this.BLOCK_SIZE) * this.BLOCK_SIZE;
        });

        return buffer;
    }

    /**
     * Extracts files from a TAR archive
     */
    public static async extract(buffer: Uint8Array): Promise<{ [path: string]: Buffer }> {
        const files: { [path: string]: Buffer } = {};
        let offset = 0;

        while (offset < buffer.length - this.BLOCK_SIZE) {
            const headerBuffer = buffer.slice(offset, offset + this.HEADER_SIZE);
            const header = this.parseHeader(headerBuffer);

            if (header.name.length === 0) {
                break; // End of archive
            }

            offset += this.HEADER_SIZE;

            if (header.typeflag === '0' || header.typeflag === '') {
                const contentSize = header.size;
                const contentBuffer = buffer.slice(offset, offset + contentSize);
                files[header.name] = Buffer.from(contentBuffer);

                // Move to next block boundary
                offset += Math.ceil(contentSize / this.BLOCK_SIZE) * this.BLOCK_SIZE;
            }
        }

        return files;
    }

    /**
     * Lists contents of a TAR archive
     * @param buffer TAR archive as Uint8Array
     * @returns Array of file information
     */
    public static list(buffer: Uint8Array): Array<{ name: string; size: number; type: string }> {
        const files: Array<{ name: string; size: number; type: string }> = [];
        let offset = 0;

        while (offset < buffer.length - this.BLOCK_SIZE) {
            const headerBuffer = buffer.slice(offset, offset + this.HEADER_SIZE);
            const header = this.parseHeader(headerBuffer);

            if (header.name.length === 0) {
                break; // End of archive
            }

            files.push({
                name: header.name,
                size: header.size,
                type: header.typeflag === '5' ? 'directory' : 'file'
            });

            offset += this.HEADER_SIZE;
            if (header.typeflag === '0' || header.typeflag === '') {
                offset += Math.ceil(header.size / this.BLOCK_SIZE) * this.BLOCK_SIZE;
            }
        }

        return files;
    }

    /**
     * Validates a TAR archive
     * @param buffer TAR archive as Uint8Array
     * @returns boolean indicating if archive is valid
     */
    public static validate(buffer: Uint8Array): boolean {
        try {
            let offset = 0;
            let foundValidHeader = false;

            while (offset < buffer.length - this.BLOCK_SIZE) {
                const headerBuffer = buffer.slice(offset, offset + this.HEADER_SIZE);
                const header = this.parseHeader(headerBuffer);

                if (header.name.length === 0) {
                    break;
                }

                foundValidHeader = true;

                // Validate magic number
                if (header.magic !== 'ustar') {
                    return false;
                }

                offset += this.HEADER_SIZE;
                if (header.typeflag === '0' || header.typeflag === '') {
                    offset += Math.ceil(header.size / this.BLOCK_SIZE) * this.BLOCK_SIZE;
                }
            }

            return foundValidHeader;
        } catch {
            return false;
        }
    }

    /**
     * Adds a file to an existing TAR archive
     * @param archive Existing TAR archive
     * @param path File path
     * @param content File content
     * @returns Updated TAR archive
     */
    public static async addFile(
        archive: Uint8Array,
        path: string,
        content: string | Uint8Array
    ): Promise<Uint8Array> {
        const files = await this.extract(archive);
        const encoder = new TextEncoder();

        files[path] = Buffer.from(content instanceof Uint8Array ? content : encoder.encode(content));
        return this.create(files);
    }

    /**
     * Removes a file from a TAR archive
     * @param archive TAR archive
     * @param path File path to remove
     * @returns Updated TAR archive
     */
    public static async removeFile(archive: Uint8Array, path: string): Promise<Uint8Array> {
        const files = await this.extract(archive);
        delete files[path];
        return this.create(files);
    }
}