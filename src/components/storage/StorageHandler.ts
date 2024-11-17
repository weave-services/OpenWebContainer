interface StorageOptions {
    fallback?: boolean;
    retries?: number;
    retryDelay?: number;
}

export class StorageHandler {
    private memoryStorage: Map<string, string>;
    private useMemoryFallback: boolean;

    constructor(options: StorageOptions = {}) {
        this.memoryStorage = new Map();
        this.useMemoryFallback = options.fallback ?? true;
    }

    private async checkStorageAccess(): Promise<boolean> {
        try {
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, testKey);
            localStorage.removeItem(testKey);
            return true;
        } catch (e) {
            return false;
        }
    }

    async initialize(options: StorageOptions = {}): Promise<void> {
        const retries = options.retries ?? 3;
        const retryDelay = options.retryDelay ?? 1000;

        for (let i = 0; i < retries; i++) {
            const hasAccess = await this.checkStorageAccess();
            if (hasAccess) {
                this.useMemoryFallback = false;
                return;
            }

            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        if (this.useMemoryFallback) {
            console.warn('Using in-memory storage fallback. Data will not persist across page reloads.');
        } else {
            throw new Error('Storage access is not available in this context');
        }
    }

    setItem(key: string, value: string): void {
        if (this.useMemoryFallback) {
            this.memoryStorage.set(key, value);
        } else {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                if (this.useMemoryFallback) {
                    this.memoryStorage.set(key, value);
                } else {
                    throw e;
                }
            }
        }
    }

    getItem(key: string): string | null {
        if (this.useMemoryFallback) {
            return this.memoryStorage.get(key) ?? null;
        }
        try {
            return localStorage.getItem(key);
        } catch (e) {
            if (this.useMemoryFallback) {
                return this.memoryStorage.get(key) ?? null;
            }
            throw e;
        }
    }

    removeItem(key: string): void {
        if (this.useMemoryFallback) {
            this.memoryStorage.delete(key);
        } else {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                if (this.useMemoryFallback) {
                    this.memoryStorage.delete(key);
                } else {
                    throw e;
                }
            }
        }
    }

    clear(): void {
        if (this.useMemoryFallback) {
            this.memoryStorage.clear();
        } else {
            try {
                localStorage.clear();
            } catch (e) {
                if (this.useMemoryFallback) {
                    this.memoryStorage.clear();
                } else {
                    throw e;
                }
            }
        }
    }
}