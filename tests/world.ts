import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SOLRADAR_REPO, VENCORD_REPO } from "../src/core/constants";
import { createLogger } from "../src/core/logger";
import { appPaths } from "../src/core/paths";
import type { OperationDeps, OperationEvent } from "../src/app/operations";
import type { CommandSpec } from "../src/core/commands";
import { fakeRunner, tempDir } from "./helpers";

export interface WorldOptions {
    discordRunning?: boolean;
    buildFails?: boolean;
    alreadyInstalled?: boolean;
    injectedElsewhere?: boolean;
    vencordModified?: boolean;
}

// A fake machine: temp LOCALAPPDATA with a Discord install, and a fake runner that
// behaves like git/node/pnpm/powershell, including their filesystem side effects.
export function makeWorld(opts: WorldOptions = {}) {
    const local = tempDir();
    const paths = appPaths(local);
    const res = join(local, "Discord", "app-1.0.9175", "resources");
    mkdirSync(res, { recursive: true });
    writeFileSync(join(res, "app.asar"), "original discord");

    const nodeDir = join(local, "nodejs");
    mkdirSync(join(nodeDir, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), "");
    const nodeExe = join(nodeDir, "node.exe");

    const state = { running: !!opts.discordRunning, heads: { vencord: "v-old", plugin: "p-old" } };

    const writeRepo = (dir: string, marker: string) => {
        mkdirSync(join(dir, ".git"), { recursive: true });
        writeFileSync(join(dir, marker), "{}");
    };
    const inject = () => {
        writeFileSync(join(res, "_app.asar"), "original discord");
        writeFileSync(join(res, "app.asar"), `require(${JSON.stringify(join(paths.checkout, "dist", "patcher.js"))})`);
    };

    if (opts.alreadyInstalled || opts.vencordModified) {
        writeRepo(paths.checkout, "package.json");
        writeRepo(paths.plugin, "index.tsx");
        mkdirSync(join(paths.checkout, "dist"), { recursive: true });
        writeFileSync(join(paths.checkout, "dist", "patcher.js"), "old build");
        inject();
    }
    if (opts.injectedElsewhere) {
        writeFileSync(join(res, "_app.asar"), "original discord");
        writeFileSync(join(res, "app.asar"), `require("C:/Users/x/AppData/Roaming/Vencord/dist/patcher.js")`);
    }

    const isPlugin = (cwd?: string) => !!cwd && cwd.toLowerCase().startsWith(paths.plugin.toLowerCase());
    const { runner, calls } = fakeRunner((spec: CommandSpec) => {
        const a = spec.args;
        if (spec.cmd === "git" && a[0] === "--version") return { stdout: "git version 2.45.1.windows.1" };
        if (spec.cmd === "node" && a[0] === "--version") return { stdout: "v24.21.0" };
        if (spec.cmd === "node" && a[0] === "-p") return { stdout: nodeExe };
        if (spec.cmd.endsWith("powershell.exe")) {
            return { stdout: state.running ? JSON.stringify([{ ProcessId: 42, ExecutablePath: join(local, "Discord", "app-1.0.9175", "Discord.exe") }]) : "" };
        }
        if (spec.cmd.endsWith("taskkill.exe")) { state.running = false; return {}; }
        if (spec.cmd === "git") {
            const plugin = isPlugin(spec.cwd);
            if (a[0] === "rev-parse") return { stdout: plugin ? state.heads.plugin : state.heads.vencord };
            if (a[0] === "remote") return { stdout: plugin ? SOLRADAR_REPO : VENCORD_REPO };
            if (a[0] === "status") return { stdout: !plugin && opts.vencordModified ? " M src/Vencord.ts" : "" };
            if (a[0] === "clone") {
                const target = join(spec.cwd!, a.at(-1)!);
                writeRepo(target, a.includes(SOLRADAR_REPO) ? "index.tsx" : "package.json");
                if (!a.includes(SOLRADAR_REPO)) writeFileSync(join(target, "package.json"), JSON.stringify({ packageManager: "pnpm@11.9.0", engines: { node: ">=22" } }));
                return {};
            }
            if (a[0] === "fetch") return {};
            if (a[0] === "reset") {
                const to = a[2] === "FETCH_HEAD" ? (plugin ? "p-new" : "v-new") : a[2]!;
                if (plugin) state.heads.plugin = to; else state.heads.vencord = to;
                return {};
            }
            return {};
        }
        if (spec.cmd === nodeExe) {
            const cmd = a[3];
            if (cmd === "build") {
                mkdirSync(join(paths.checkout, "dist"), { recursive: true });
                writeFileSync(join(paths.checkout, "dist", "patcher.js"), opts.buildFails ? "half-written" : "new build");
                return opts.buildFails ? { exitCode: 1, stderr: "esbuild error" } : {};
            }
            if (cmd === "inject") { inject(); return {}; }
            if (cmd === "uninject") { writeFileSync(join(res, "app.asar"), "original discord"); rmSync(join(res, "_app.asar"), { force: true }); return {}; }
            return {};
        }
        return {};
    });

    const events: OperationEvent[] = [];
    const launched: string[] = [];
    const deps = (over: Partial<OperationDeps> = {}): OperationDeps => ({
        runner, env: {}, paths, localAppData: local, logger: createLogger(join(local, "logs")),
        signal: new AbortController().signal, emit: e => events.push(e),
        closeDiscordFirst: false, launch: i => launched.push(i.branch), ...over,
    });
    return { local, paths, res, state, calls, events, launched, deps };
}
