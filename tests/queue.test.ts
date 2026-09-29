import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedQueue } from "../src/shared/queue";

test("drain returns pushed values in order and empties the queue", () => {
    const q = SharedQueue.create(1024);
    q.push({ a: 1 });
    q.push("two");
    q.push([3, "ã"]);
    expect(q.drain()).toEqual([{ a: 1 }, "two", [3, "ã"]]);
    expect(q.drain()).toEqual([]);
});

test("a second view over the same buffer sees the data", () => {
    const q = SharedQueue.create(1024);
    const other = new SharedQueue(q.buffer);
    q.push({ hello: "world" });
    expect(other.drain()).toEqual([{ hello: "world" }]);
});

test("push rejects values that can never fit", () => {
    const q = SharedQueue.create(64);
    expect(q.push("x".repeat(200))).toBe(false);
});

test("works across a real Worker", async () => {
    const q = SharedQueue.create(4096);
    const file = join(mkdtempSync(join(tmpdir(), "srh-")), "worker.ts");
    writeFileSync(file, `
        import { SharedQueue } from ${JSON.stringify(join(import.meta.dir, "..", "src", "shared", "queue.ts"))};
        self.onmessage = (e) => {
            const q = new SharedQueue(e.data);
            for (let i = 0; i < 50; i++) q.push(i);
            postMessage("done");
        };`);
    const worker = new Worker(file);
    const done = new Promise(r => (worker.onmessage = r));
    worker.postMessage(q.buffer);
    await done;
    worker.terminate();
    expect(q.drain()).toEqual(Array.from({ length: 50 }, (_, i) => i));
});
