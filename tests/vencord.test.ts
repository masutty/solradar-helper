import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appPaths } from "../src/core/paths";
import { HelperError } from "../src/core/errors";
import { backupDist, inject, installPackages, isBuilt, pnpmSpec, readVencordPackage, restoreDist } from "../src/services/vencord";
import { fakeRunner, tempDir } from "./helpers";

function fakeNode(root: string) {
    const nodeDir = join(root, "nodejs");
    mkdirSync(join(nodeDir, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), "");
    return join(nodeDir, "node.exe");
}

test("pnpmSpec uses packageManager and strips the integrity hash", () => {
    expect(pnpmSpec({ packageManager: "pnpm@11.9.0" })).toBe("pnpm@11.9.0");
    expect(pnpmSpec({ packageManager: "pnpm@11.9.0+sha512.abc" })).toBe("pnpm@11.9.0");
    expect(pnpmSpec(undefined)).toBe("pnpm@latest");
});

test("readVencordPackage returns undefined when absent", () => {
    const p = appPaths(tempDir());
    expect(readVencordPackage(p.checkout)).toBeUndefined();
    mkdirSync(p.checkout, { recursive: true });
    writeFileSync(join(p.checkout, "package.json"), JSON.stringify({ packageManager: "pnpm@11.9.0", engines: { node: ">=22" } }));
    expect(readVencordPackage(p.checkout)?.engines?.node).toBe(">=22");
});

test("pnpm runs through node + npx-cli with the pinned version, never a .cmd", async () => {
    const root = tempDir();
    const p = appPaths(root);
    mkdirSync(p.checkout, { recursive: true });
    writeFileSync(join(p.checkout, "package.json"), JSON.stringify({ packageManager: "pnpm@11.9.0" }));
    const nodeExe = fakeNode(root);
    const { runner, calls } = fakeRunner(spec => (spec.args[0] === "-p" ? { stdout: nodeExe + "\n" } : {}));
    await installPackages({ runner, env: {} }, p);
    await inject({ runner, env: {} }, p, "ptb");
    const [, install, , injectCall] = calls;
    expect(install).toMatchObject({ cmd: nodeExe, cwd: p.checkout });
    expect(install!.args.slice(1)).toEqual(["--yes", "pnpm@11.9.0", "install", "--frozen-lockfile"]);
    expect(install!.env?.CI).toBe("true");
    expect(injectCall!.args.slice(1)).toEqual(["--yes", "pnpm@11.9.0", "inject", "--branch", "ptb"]);
});

test("missing npm is reported as a dependency problem", async () => {
    const p = appPaths(tempDir());
    const { runner } = fakeRunner(() => ({ stdout: "C:\\nowhere\\node.exe" }));
    await expect(installPackages({ runner, env: {} }, p)).rejects.toBeInstanceOf(HelperError);
});

test("dist backup and restore", () => {
    const p = appPaths(tempDir());
    expect(backupDist(p)).toBe(false); // nothing built yet
    mkdirSync(join(p.checkout, "dist"), { recursive: true });
    writeFileSync(join(p.checkout, "dist", "patcher.js"), "good");
    expect(isBuilt(p)).toBe(true);
    expect(backupDist(p)).toBe(true);
    writeFileSync(join(p.checkout, "dist", "patcher.js"), "broken");
    writeFileSync(join(p.checkout, "dist", "junk.js"), "junk");
    restoreDist(p);
    expect(readFileSync(join(p.checkout, "dist", "patcher.js"), "utf8")).toBe("good");
    expect(existsSync(join(p.checkout, "dist", "junk.js"))).toBe(false);
});
