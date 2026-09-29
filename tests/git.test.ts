import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCommandRunner } from "../src/core/commands";
import { createLogger } from "../src/core/logger";
import { cloneRepo, discardChanges, fetchAndReset, inspectRepo, normalizeRemote, remoteHead, resetTo, type ServiceCtx } from "../src/services/git";
import { readPluginVersion } from "../src/services/solradar";
import { tempDir } from "./helpers";

let ctx: ServiceCtx;
const sh = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return r.stdout.toString().trim();
};

// A "remote": a bare repo on branch main with one commit containing index.tsx.
function makeRemote(): { bare: string; work: string } {
    const root = tempDir();
    const bare = join(root, "remote.git");
    const work = join(root, "work");
    sh(root, "init", "--bare", "--initial-branch=main", bare);
    sh(root, "clone", bare, work);
    writeFileSync(join(work, "index.tsx"), "v1");
    writeFileSync(join(work, "version.json"), JSON.stringify({ currentVersion: "1.3.6" }));
    sh(work, "add", ".");
    sh(work, "commit", "-m", "v1");
    sh(work, "push", "origin", "HEAD:main");
    return { bare, work };
}

beforeAll(() => {
    ctx = { runner: createCommandRunner(createLogger(tempDir())), env: process.env as Record<string, string> };
});

test("normalizeRemote ignores case, .git suffix and trailing slash", () => {
    expect(normalizeRemote("https://GitLab.com/masutty/solradar.git\n")).toBe(normalizeRemote("https://gitlab.com/masutty/solradar/"));
});

test("absent → clone → ready, with version readable", async () => {
    const { bare } = makeRemote();
    const dir = join(tempDir(), "plugin");
    expect((await inspectRepo(ctx, dir, bare, "index.tsx")).state).toBe("absent");
    expect((await cloneRepo(ctx, bare, dir)).exitCode).toBe(0);
    const st = await inspectRepo(ctx, dir, bare, "index.tsx");
    expect(st.state).toBe("ready");
    expect(st.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(readPluginVersion(dir)).toBe("1.3.6");
});

test("interrupted clone leftovers are replaced by the next clone (review focus 2)", async () => {
    const { bare } = makeRemote();
    const dir = join(tempDir(), "plugin");
    mkdirSync(join(dir + ".partial", ".git"), { recursive: true }); // half-written previous attempt
    mkdirSync(dir, { recursive: true });                              // empty target folder
    expect((await inspectRepo(ctx, dir, bare, "index.tsx")).state).toBe("invalid");
    expect((await cloneRepo(ctx, bare, dir)).exitCode).toBe(0);
    expect((await inspectRepo(ctx, dir, bare, "index.tsx")).state).toBe("ready");
    expect(existsSync(dir + ".partial")).toBe(false);
});

test("a folder nested in another repo is invalid, not mistaken for the parent", async () => {
    const outer = makeRemote();
    const dir = join(outer.work, "nested");
    mkdirSync(dir);
    writeFileSync(join(dir, "index.tsx"), "x");
    expect((await inspectRepo(ctx, dir, outer.bare, "index.tsx")).state).toBe("invalid");
});

test("wrong remote is invalid; local edits are modified; discardChanges repairs", async () => {
    const a = makeRemote();
    const b = makeRemote();
    const dir = join(tempDir(), "plugin");
    await cloneRepo(ctx, a.bare, dir);
    expect((await inspectRepo(ctx, dir, b.bare, "index.tsx")).state).toBe("invalid");
    writeFileSync(join(dir, "index.tsx"), "tampered");
    writeFileSync(join(dir, "extra.ts"), "new file");
    expect((await inspectRepo(ctx, dir, a.bare, "index.tsx")).state).toBe("modified");
    await discardChanges(ctx, dir);
    expect((await inspectRepo(ctx, dir, a.bare, "index.tsx")).state).toBe("ready");
    expect(existsSync(join(dir, "extra.ts"))).toBe(false);
});

test("fetchAndReset follows rewritten history; resetTo rolls back; remoteHead reads main", async () => {
    const { bare, work } = makeRemote();
    const dir = join(tempDir(), "plugin");
    await cloneRepo(ctx, bare, dir);
    const before = (await inspectRepo(ctx, dir, bare, "index.tsx")).commit!;

    // Simulate SolRadar's release process: a brand-new parentless commit force-pushed.
    sh(work, "checkout", "--orphan", "release");
    writeFileSync(join(work, "index.tsx"), "v2");
    sh(work, "add", ".");
    sh(work, "commit", "-m", "chore: release");
    sh(work, "push", "--force", "origin", "HEAD:main");

    expect(await remoteHead(ctx, bare)).toBe(sh(work, "rev-parse", "HEAD"));
    expect((await fetchAndReset(ctx, dir)).exitCode).toBe(0);
    const after = await inspectRepo(ctx, dir, bare, "index.tsx");
    expect(after.state).toBe("ready");
    expect(after.commit).not.toBe(before);

    expect((await resetTo(ctx, dir, before)).exitCode).toBe(0);
    expect((await inspectRepo(ctx, dir, bare, "index.tsx")).commit).toBe(before);
});

test("inspectRepo reports unknown when git itself is missing", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "index.tsx"), "x");
    const noGit: ServiceCtx = { ...ctx, env: { ...ctx.env, PATH: "C:\\nowhere", Path: "C:\\nowhere" } as Record<string, string> };
    expect((await inspectRepo(noGit, dir, "x", "index.tsx")).state).toBe("unknown");
});
