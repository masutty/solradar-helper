import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, CommandRunner, CommandSpec } from "../src/core/commands";

export function tempDir(): string {
    return mkdtempSync(join(tmpdir(), "srh-"));
}

export function fakeRunner(handler: (spec: CommandSpec) => Partial<CommandResult> | Promise<Partial<CommandResult>>) {
    const calls: CommandSpec[] = [];
    const runner: CommandRunner = {
        async run(spec) {
            calls.push(spec);
            const reply = await handler(spec);
            return { exitCode: 0, stdout: "", stderr: "", notFound: false, timedOut: false, cancelled: false, ...reply };
        },
    };
    return { runner, calls };
}
