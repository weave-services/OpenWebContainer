
export class BrowserEventEmitter {
    private events: Record<string, Function[]> = {};
    private maxListeners: number = 10;
    private onceEvents: Set<Function> = new Set();

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

    once(event: string, listener: Function) {
        const onceWrapper = (...args: any[]) => {
            this.off(event, onceWrapper);
            this.onceEvents.delete(onceWrapper);
            listener(...args);
        };
        this.onceEvents.add(onceWrapper);
        return this.on(event, onceWrapper);
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

    removeAllListeners(event?: string) {
        if (event) {
            this.events[event] = [];
        } else {
            this.events = {};
        }
        return this;
    }

    listenerCount(event: string): number {
        return this.events[event]?.length || 0;
    }
}