import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireSingleInstance } from "../src/core/singleInstance";
import { tempDir } from "./helpers";

test("first instance acquires; a live other instance blocks; a dead one does not", () => {
    const lock = join(tempDir(), "x", "helper.lock");
    expect(acquireSingleInstance(lock, 100, () => false)).toBe(true);
    expect(acquireSingleInstance(lock, 200, pid => pid === 100)).toBe(false);
    expect(acquireSingleInstance(lock, 200, () => false)).toBe(true);
    writeFileSync(lock, "garbage");
    expect(acquireSingleInstance(lock, 300, () => true)).toBe(true);
});
