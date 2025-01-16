export const pathUtils = {
    dirname(path: string): string {
        if (path === '/') return '/';
        const parts = path.split('/');
        parts.pop();
        return parts.join('/') || '/';
    },

    resolve(...paths: string[]): string {
        const segments: string[] = [];

        paths.forEach(path => {
            if (path.startsWith('/')) {
                segments.length = 0;
            }

            const parts = path.split('/').filter(p => p && p !== '.');

            parts.forEach(part => {
                if (part === '..') {
                    segments.pop();
                } else {
                    segments.push(part);
                }
            });
        });

        return '/' + segments.join('/');
    },

    normalize(path: string): string {
        return pathUtils.resolve(path);
    },

    join(...paths: string[]): string {
        return paths.join('/').replace(/\/+/g, '/');
    }
};
