import { expect, test } from "bun:test";
import { checkDependency, minNodeMajor, parseVersion, wingetInstallArgs } from "../src/services/dependencies";
import { fakeRunner } from "./helpers";

test("parseVersion handles git and node output", () => {
    expect(parseVersion("git version 2.45.1.windows.1")).toBe("2.45.1");
    expect(parseVersion("v24.21.0\n")).toBe("24.21.0");
    expect(parseVersion("garbage")).toBeUndefined();
});

test("minNodeMajor reads >=N and falls back to 22", () => {
    expect(minNodeMajor(">=22")).toBe(22);
    expect(minNodeMajor(">= 24.1")).toBe(24);
    expect(minNodeMajor(undefined)).toBe(22);
    expect(minNodeMajor("^20 || ^22")).toBe(22);
});

test("checkDependency classifies ok / missing / outdated / error", async () => {
    const env = {};
    const ok = fakeRunner(() => ({ stdout: "v24.1.0" }));
    expect(await checkDependency("node", ok.runner, env, 22)).toEqual({ id: "node", state: "ok", version: "24.1.0" });
    expect(ok.calls[0]).toMatchObject({ cmd: "node", args: ["--version"] });

    const old = fakeRunner(() => ({ stdout: "v20.11.0" }));
    expect((await checkDependency("node", old.runner, env, 22)).state).toBe("outdated");

    const missing = fakeRunner(() => ({ notFound: true, exitCode: -1 }));
    expect((await checkDependency("git", missing.runner, env, 22)).state).toBe("missing");

    const broken = fakeRunner(() => ({ exitCode: 1, stderr: "dll missing" }));
    expect(await checkDependency("git", broken.runner, env, 22)).toMatchObject({ state: "error", detail: "dll missing" });
});

test("winget args are exact, silent and non-interactive", () => {
    expect(wingetInstallArgs("git")).toEqual([
        "install", "--exact", "--id", "Git.Git",
        "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity",
    ]);
});
