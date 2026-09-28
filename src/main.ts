import { SizeHint, Webview } from "webview-bun";
import html from "./ui/index.html" with { type: "text" };
import { SharedQueue } from "./shared/queue";

const queue = SharedQueue.create();
const worker = new Worker(new URL("./backend/worker.ts", import.meta.url).href);
worker.postMessage({ type: "init", buffer: queue.buffer });

const webview = new Webview(false, { width: 760, height: 640, hint: SizeHint.NONE });
webview.title = "SolRadar Helper";
webview.bind("__send", (command: unknown) => {
    worker.postMessage({ type: "command", command });
});
webview.bind("__poll", () => queue.drain());
webview.setHTML(html);
webview.run();

worker.terminate();
process.exit(0);
