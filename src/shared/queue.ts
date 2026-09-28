// Worker → main-thread event queue. The main thread is blocked inside the native
// webview loop and cannot receive postMessage events, so the page polls drain()
// through a bound function. Layout: Int32[0] = bytes used, Int32[1] = lock, data from byte 8.
// Each record: uint32 length (LE) + UTF-8 JSON.
const HEADER = 8;
const USED = 0;
const LOCK = 1;

export class SharedQueue {
    private readonly i32: Int32Array;
    private readonly u8: Uint8Array;
    private readonly view: DataView;

    constructor(readonly buffer: SharedArrayBuffer) {
        this.i32 = new Int32Array(buffer, 0, 2);
        this.u8 = new Uint8Array(buffer);
        this.view = new DataView(buffer);
    }

    static create(bytes = 1 << 20): SharedQueue {
        return new SharedQueue(new SharedArrayBuffer(bytes));
    }

    private lock() {
        while (Atomics.compareExchange(this.i32, LOCK, 0, 1) !== 0) {
            // spin: critical sections are a memcpy long
        }
    }

    private unlock() {
        Atomics.store(this.i32, LOCK, 0);
    }

    push(value: unknown): boolean {
        const data = new TextEncoder().encode(JSON.stringify(value));
        const need = 4 + data.length;
        if (HEADER + need > this.u8.length) return false;
        for (;;) {
            this.lock();
            const used = Atomics.load(this.i32, USED);
            if (HEADER + used + need <= this.u8.length) {
                this.view.setUint32(HEADER + used, data.length, true);
                this.u8.set(data, HEADER + used + 4);
                Atomics.store(this.i32, USED, used + need);
                this.unlock();
                return true;
            }
            this.unlock();
            Bun.sleepSync(5); // queue full: wait for the page to drain
        }
    }

    drain(): unknown[] {
        this.lock();
        const used = Atomics.load(this.i32, USED);
        const copy = this.u8.slice(HEADER, HEADER + used);
        Atomics.store(this.i32, USED, 0);
        this.unlock();

        const out: unknown[] = [];
        const view = new DataView(copy.buffer);
        const decoder = new TextDecoder();
        for (let off = 0; off < copy.length; ) {
            const len = view.getUint32(off, true);
            out.push(JSON.parse(decoder.decode(copy.subarray(off + 4, off + 4 + len))));
            off += 4 + len;
        }
        return out;
    }
}
