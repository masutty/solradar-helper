import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runOperation } from "../src/app/operations";
import { HelperError } from "../src/core/errors";
import { readInjection, findDiscordInstalls } from "../src/services/discord";
import { makeWorld } from "./world";

const injection = (w: ReturnType<typeof makeWorld>) => readInjection(findDiscordInstalls(w.local)[0]!, w.paths.checkout);
const kindOf = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as HelperError).kind; } };

test("fresh install clones, builds, injects, verifies and launches Discord", async () => {
    const w = makeWorld();
    await runOperation("install", w.deps());
    expect(injection(w)).toBe("injected");
    expect(existsSync(join(w.paths.plugin, "index.tsx"))).toBe(true);
    expect(w.launched).toEqual(["stable"]);
    const statuses = w.events.filter(e => e.type === "step" && e.status !== "running").map(e => (e as any).id + ":" + (e as any).status);
    expect(statuses).toEqual(["requirements:done", "discord:done", "vencord:done", "solradar:done", "packages:done", "build:done", "inject:done", "verify:done", "launch:done"]);
});

test("install refuses while Discord runs, before touching anything", async () => {
    const w = makeWorld({ discordRunning: true });
    expect(await kindOf(runOperation("install", w.deps()))).toBe("discord-running");
    expect(w.calls.some(c => c.cmd === "git" && c.args[0] === "clone")).toBe(false);
});

test("install closes Discord first when the user agreed", async () => {
    const w = makeWorld({ discordRunning: true });
    await runOperation("install", w.deps({ closeDiscordFirst: true }));
    expect(w.calls.some(c => c.cmd.endsWith("taskkill.exe") && c.args.includes("42"))).toBe(true);
    expect(injection(w)).toBe("injected");
});

test("install over an official Vencord replaces it (review focus 3)", async () => {
    const w = makeWorld({ injectedElsewhere: true });
    expect(injection(w)).toBe("injected-elsewhere");
    await runOperation("install", w.deps());
    expect(injection(w)).toBe("injected");
});

test("install is idempotent: second run skips clone and inject", async () => {
    const w = makeWorld({ alreadyInstalled: true });
    await runOperation("install", w.deps());
    expect(w.calls.some(c => c.args[0] === "clone")).toBe(false);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "step", id: "inject", status: "skipped" }));
});

test("update runs with Discord open, then restarts it", async () => {
    const w = makeWorld({ alreadyInstalled: true, discordRunning: true });
    await runOperation("update", w.deps());
    expect(w.state.heads).toEqual({ vencord: "v-new", plugin: "p-new" });
    expect(w.calls.some(c => c.cmd.endsWith("taskkill.exe"))).toBe(true); // restart at the end
    expect(w.launched).toEqual(["stable"]);
});

test("failed build during update restores dist and both commits (review focus 5)", async () => {
    const w = makeWorld({ alreadyInstalled: true, buildFails: true });
    expect(await kindOf(runOperation("update", w.deps()))).toBe("build");
    expect(readFileSync(join(w.paths.checkout, "dist", "patcher.js"), "utf8")).toBe("old build");
    expect(w.state.heads).toEqual({ vencord: "v-old", plugin: "p-old" });
    expect(injection(w)).toBe("injected");
});

test("modified checkout stops install and update with checkout-modified; repair fixes it", async () => {
    const w = makeWorld({ vencordModified: true });
    expect(await kindOf(runOperation("update", w.deps()))).toBe("checkout-modified");
    await runOperation("repair", w.deps());
    expect(w.calls.some(c => c.args[0] === "clean" && c.cwd === w.paths.checkout)).toBe(true);
});

test("inject step is announced as not cancellable", async () => {
    const w = makeWorld();
    await runOperation("install", w.deps());
    const injectRunning = w.events.find(e => e.type === "step" && e.id === "inject" && e.status === "running");
    expect(injectRunning).toMatchObject({ cancellable: false });
});

test("cancel before build stops with cancelled", async () => {
    const w = makeWorld();
    const ac = new AbortController();
    const deps = w.deps({ signal: ac.signal, emit: e => { if (e.type === "step" && e.id === "packages" && e.status === "done") ac.abort(); } });
    expect(await kindOf(runOperation("install", deps))).toBe("cancelled");
    expect(injection(w)).toBe("not-injected");
});

test("uninstall uninjects, verifies and launches", async () => {
    const w = makeWorld({ alreadyInstalled: true });
    await runOperation("uninstall", w.deps());
    expect(injection(w)).toBe("not-injected");
    expect(w.launched).toEqual(["stable"]);
});

test("missing Discord is reported", async () => {
    const w = makeWorld();
    expect(await kindOf(runOperation("install", w.deps({ localAppData: join(w.local, "nowhere") })))).toBe("discord-not-found");
});

test("update cancelled at packages rolls both repos back", async () => {
    const w = makeWorld({ alreadyInstalled: true });
    const ac = new AbortController();
    const deps = w.deps({ signal: ac.signal, emit: e => { if (e.type === "step" && e.id === "packages" && e.status === "running") ac.abort(); } });
    expect(await kindOf(runOperation("update", deps))).toBe("cancelled");
    expect(w.state.heads).toEqual({ vencord: "v-old", plugin: "p-old" });
});

test("update where the SolRadar fetch fails rolls Vencord back", async () => {
    const w = makeWorld({ alreadyInstalled: true, pluginFetchFails: true });
    expect(await kindOf(runOperation("update", w.deps()))).toBe("network");
    expect(w.state.heads).toEqual({ vencord: "v-old", plugin: "p-old" });
});

test("failed install relaunches Discord when the Helper closed it", async () => {
    const w = makeWorld({ discordRunning: true, buildFails: true });
    expect(await kindOf(runOperation("install", w.deps({ closeDiscordFirst: true })))).toBe("build");
    expect(w.launched).toEqual(["stable"]);
});

test("failed install does not launch Discord it did not close", async () => {
    const w = makeWorld({ buildFails: true });
    expect(await kindOf(runOperation("install", w.deps()))).toBe("build");
    expect(w.launched).toEqual([]);
});
