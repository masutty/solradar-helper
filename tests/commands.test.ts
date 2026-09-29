import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createCommandRunner } from "../src/core/commands";
import { createLogger, type LogEntry } from "../src/core/logger";
import { tempDir } from "./helpers";

const bun = process.execPath;
const env = process.env as Record<string, string>;

function setup() {
    const logger = createLogger(tempDir());
    return { runner: createCommandRunner(logger), logger };
}

test("passes arguments with spaces and non-ASCII intact, captures output and exit code", async () => {
    const { runner, logger } = setup();
    const lines: string[] = [];
    const r = await runner.run(
        { cmd: bun, args: ["-e", "console.log(process.argv[1]); console.error('err'); process.exit(3)", "C:\\Users\\João Silva\\x"], env },
        { onLine: l => lines.push(l) },
    );
    expect(r.exitCode).toBe(3);
    expect(r.stdout.trim()).toBe("C:\\Users\\João Silva\\x");
    expect(r.stderr.trim()).toBe("err");
    expect(lines).toContain("C:\\Users\\João Silva\\x");
    expect(readFileSync(logger.file, "utf8")).toContain("exit");
});

test("reports a missing executable instead of throwing", async () => {
    const { runner } = setup();
    const r = await runner.run({ cmd: "definitely-not-a-real-tool-xyz", args: [], env });
    expect(r.notFound).toBe(true);
});

test("cancellation kills the process", async () => {
    const { runner } = setup();
    const ac = new AbortController();
    const started = Date.now();
    setTimeout(() => ac.abort(), 300);
    const r = await runner.run({ cmd: bun, args: ["-e", "setTimeout(() => {}, 60000)"], env }, { signal: ac.signal });
    expect(r.cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(10000);
});

test("timeout kills the process", async () => {
    const { runner } = setup();
    const r = await runner.run({ cmd: bun, args: ["-e", "setTimeout(() => {}, 60000)"], env, timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
});

test("runs in the given cwd", async () => {
    const { runner } = setup();
    const dir = tempDir();
    const r = await runner.run({ cmd: bun, args: ["-e", "console.log(process.cwd())"], cwd: dir, env });
    // %TEMP% may be an 8.3 short path; compare the final segment only.
    expect(r.stdout.trim().toLowerCase().endsWith(basename(dir).toLowerCase())).toBe(true);
});

test("runner logs the command, its output and maps exit codes to levels", async () => {
    const entries: LogEntry[] = [];
    const runner = createCommandRunner(createLogger(tempDir(), new Date(), 10, e => entries.push(e)));
    await runner.run({ cmd: bun, args: ["-e", "console.log('hi'); process.exit(0)"], env });
    expect(entries[0]!.kind).toBe("cmd");
    expect(entries[0]!.level).toBe("debug");
    expect(entries.find(e => e.kind === "out")).toMatchObject({ level: "debug", text: "hi" });
    expect(entries.at(-1)).toMatchObject({ level: "debug", text: "exit 0" });

    entries.length = 0;
    await runner.run({ cmd: bun, args: ["-e", "process.exit(3)"], env });
    expect(entries.at(-1)).toMatchObject({ level: "warn", text: "exit 3" });

    entries.length = 0;
    await runner.run({ cmd: bun, args: ["-e", "setTimeout(() => {}, 30000)"], env, timeoutMs: 300 });
    expect(entries.at(-1)).toMatchObject({ level: "warn", text: "timed out" });

    entries.length = 0;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    await runner.run({ cmd: bun, args: ["-e", "setTimeout(() => {}, 30000)"], env }, { signal: ac.signal });
    expect(entries.at(-1)).toMatchObject({ level: "warn", text: "cancelled" });
});

test("activity entries hide the working directory; the log file keeps it", async () => {
    const entries: LogEntry[] = [];
    const dir = tempDir();
    const logger = createLogger(tempDir(), new Date(), 10, e => entries.push(e));
    await createCommandRunner(logger).run({ cmd: bun, args: ["-e", "0"], cwd: dir, env });
    expect(entries[0]!.text).not.toContain("(in ");
    expect(readFileSync(logger.file, "utf8")).toContain(`(in ${dir})`);
});
