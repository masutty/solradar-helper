import { SharedQueue } from "../shared/queue";

declare var self: Worker;
let queue: SharedQueue;

self.onmessage = async (event: MessageEvent) => {
    const msg = event.data;
    if (msg.type === "init") {
        queue = new SharedQueue(msg.buffer);
        queue.push({ type: "ready" });
        return;
    }
    if (msg.command?.type === "ping") {
        for (let i = 1; i <= 5; i++) {
            queue.push({ type: "tick", i });
            await Bun.sleep(600);
        }
        const git = Bun.spawn(["git", "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
        queue.push({ type: "git", out: (await new Response(git.stdout).text()).trim(), code: await git.exited });
        const node = Bun.which("node");
        if (node) {
            // grandchild process: must not flash a console window either
            const p = Bun.spawn([node, "-e", "console.log(require('child_process').execSync('git --version').toString())"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
            queue.push({ type: "grandchild", out: (await new Response(p.stdout).text()).trim(), code: await p.exited });
        }
    }
};
