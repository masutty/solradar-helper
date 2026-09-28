import { SizeHint, Webview } from "webview-bun";
import htmlText from "./ui/index.html" with { type: "text" };
import { HELPER_NAME, WEBVIEW2_URL } from "./core/constants";
import { appPaths } from "./core/paths";
import { acquireSingleInstance } from "./core/singleInstance";
import { openUrl, showMessageBox, webView2Installed } from "./core/win32";
import { SharedQueue } from "./shared/queue";
import type { UiCommand, WorkerMessage } from "./shared/protocol";

const html = htmlText as unknown as string;

// The main thread only owns the window: webview.run() blocks this thread's event loop,
// so all work happens in the worker and events come back through SharedQueue.

const paths = appPaths(process.env.LOCALAPPDATA ?? "");

if (!acquireSingleInstance(paths.lock)) {
    showMessageBox(HELPER_NAME, "SolRadar Helper is already open.");
    process.exit(0);
}

if (!webView2Installed()) {
    const answer = showMessageBox(
        HELPER_NAME,
        "SolRadar Helper needs the Microsoft Edge WebView2 Runtime, which is missing on this computer.\n\nClick OK to open the official download page. Install it, then open SolRadar Helper again.",
        "okcancel",
    );
    if (answer === "ok") openUrl(WEBVIEW2_URL);
    process.exit(1);
}

const queue = SharedQueue.create();
const worker = new Worker(new URL("./backend/worker.ts", import.meta.url).href);
worker.postMessage({ type: "init", buffer: queue.buffer } satisfies WorkerMessage);

let webview: Webview;
try {
    webview = new Webview(false, { width: 780, height: 700, hint: SizeHint.NONE });
} catch (e) {
    showMessageBox(HELPER_NAME, `The window could not be created.\n\n${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
}

webview.title = HELPER_NAME;
webview.bind("__send", (command: UiCommand) => {
    worker.postMessage({ type: "command", command } satisfies WorkerMessage);
});
webview.bind("__poll", () => queue.drain());
webview.setHTML(html);
webview.run();

worker.terminate();
process.exit(0);
