import type { OperationEvent, OperationKind } from "../app/operations";
import type { ViewModel } from "../app/view";
import type { ErrorKind } from "../core/errors";
import type { DependencyId } from "../services/dependencies";

export type UiCommand =
    | { type: "refresh" }
    | { type: "select-branch"; branch: string }
    | { type: "run"; op: OperationKind; closeDiscord: boolean }
    | { type: "cancel" }
    | { type: "install-dependency"; id: DependencyId }
    | { type: "open-url"; url: string }
    | { type: "open-logs" }
    | { type: "debug-report"; redact: boolean };

export type BackendEvent =
    | { type: "view"; view: ViewModel; busy: boolean }
    | OperationEvent
    | { type: "operation-end"; op: OperationKind; ok: boolean; error?: { kind: ErrorKind; message: string } }
    | { type: "dependency-install"; id: DependencyId; status: "running" | "done" | "failed"; message?: string }
    | { type: "report-ready"; path: string }
    | { type: "fatal"; message: string };

export type WorkerMessage =
    | { type: "init"; buffer: SharedArrayBuffer }
    | { type: "command"; command: UiCommand };
