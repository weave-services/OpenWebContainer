export class BrowserEventEmitter {
    private events: Record<string, Function[]> = {};
    private maxListeners: number = 10;

    setMaxListeners(n: number) {
        this.maxListeners = n;
        return this;
    }

    on(event: string, listener: Function) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        if (this.events[event].length >= this.maxListeners) {
            console.warn(`MaxListenersExceededWarning: Possible memory leak detected. ${this.events[event].length} listeners added.`);
        }
        this.events[event].push(listener);
        return this;
    }

    off(event: string, listener: Function) {
        return this.removeListener(event, listener);
    }

    emit(event: string, ...args: any[]) {
        if (!this.events[event]) return false;
        this.events[event].forEach(listener => listener(...args));
        return true;
    }

    removeListener(event: string, listener: Function) {
        if (!this.events[event]) return this;
        this.events[event] = this.events[event].filter(l => l !== listener);
        return this;
    }
}