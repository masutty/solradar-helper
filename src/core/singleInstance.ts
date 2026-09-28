import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function acquireSingleInstance(lockFile: string, pid = process.pid, isAlive = pidAlive): boolean {
    mkdirSync(dirname(lockFile), { recursive: true });
    try {
        const other = Number(readFileSync(lockFile, "utf8").trim());
        if (Number.isInteger(other) && other > 0 && other !== pid && isAlive(other)) return false;
    } catch {
        // no lock yet
    }
    writeFileSync(lockFile, String(pid));
    return true;
}
