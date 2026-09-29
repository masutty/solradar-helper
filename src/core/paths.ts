import { join } from "node:path";
import { PLUGIN_DIR_NAME } from "./constants";

export interface AppPaths {
    root: string;
    checkout: string;
    userplugins: string;
    plugin: string;
    distBackup: string;
    logs: string;
    reports: string;
    state: string;
    lock: string;
}

export function appPaths(localAppData: string): AppPaths {
    const root = join(localAppData, "SolRadarHelper");
    const checkout = join(root, "Vencord");
    const userplugins = join(checkout, "src", "userplugins");
    return {
        root,
        checkout,
        userplugins,
        plugin: join(userplugins, PLUGIN_DIR_NAME),
        distBackup: join(root, "dist-backup"),
        logs: join(root, "logs"),
        reports: join(root, "reports"),
        state: join(root, "state.json"),
        lock: join(root, "helper.lock"),
    };
}
