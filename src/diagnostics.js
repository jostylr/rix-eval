/**
 * RiX Diagnostics Module
 *
 * Provides:
 * - Unified event/result objects for warnings, info, errors, stops, tests, debug, trace
 * - DiagnosticsRegistry: per-session event sink and test result storage
 * - RixAbort: structured abrupt completion for .Error and .Stop
 */

import { Integer } from "@ratmath/core";

// --- RixAbort: structured abrupt completion ---

export class RixAbort extends Error {
    constructor(event) {
        // event is a RiX map: { type: "map", entries: Map { "label" => { type: "string", value: ... } } }
        const label = event?.entries?.get("label")?.value ?? "RiX abort";
        super(label);
        this.name = "RixAbort";
        this.event = event;
    }
}

export function isRixAbort(err) {
    return err instanceof RixAbort;
}

// --- Event creation helper ---

let eventCounter = 0;

/**
 * Create a diagnostic event as a RiX map value.
 * @param {object} fields - { kind, label, level?, file?, line?, col?, scope?, data? }
 * @returns {object} RiX map value { type: "map", entries: Map }
 */
export function createEvent(fields) {
    const entries = new Map();
    entries.set("kind", { type: "string", value: fields.kind });
    entries.set("label", typeof fields.label === "string"
        ? { type: "string", value: fields.label }
        : fields.label);

    if (fields.level !== undefined) {
        entries.set("level", fields.level instanceof Integer ? fields.level : new Integer(fields.level));
    }
    if (fields.file !== undefined) {
        entries.set("file", { type: "string", value: fields.file });
    }
    if (fields.line !== undefined) {
        entries.set("line", new Integer(fields.line));
    }
    if (fields.col !== undefined) {
        entries.set("col", new Integer(fields.col));
    }
    if (fields.scope !== undefined) {
        entries.set("scope", { type: "string", value: fields.scope });
    }

    entries.set("time", new Integer(BigInt(Date.now())));

    if (fields.data !== undefined) {
        entries.set("data", fields.data);
    } else {
        entries.set("data", { type: "map", entries: new Map() });
    }

    // Include any extra fields
    if (fields.extra) {
        for (const [k, v] of Object.entries(fields.extra)) {
            entries.set(k, v);
        }
    }

    eventCounter++;

    return { type: "map", entries };
}

// --- DiagnosticsRegistry ---

const DIAG_ENV_KEY = "__diagnostics__";

export class DiagnosticsRegistry {
    constructor() {
        /** Ordered list of all emitted events */
        this.events = [];
        /** Nested map: filePath -> testLabel -> result object */
        this.testResultsByFile = new Map();
    }

    /** Append an event to the ordered list */
    addEvent(event) {
        this.events.push(event);
    }

    /** Register a test result under file/label. Throws on duplicate label within same file. */
    registerTestResult(filePath, label, result) {
        if (!this.testResultsByFile.has(filePath)) {
            this.testResultsByFile.set(filePath, new Map());
        }
        const fileResults = this.testResultsByFile.get(filePath);
        if (fileResults.has(label)) {
            throw new Error(`Duplicate test group label "${label}" in file "${filePath}"`);
        }
        fileResults.set(label, result);
    }

    /** Get all test results for a file */
    getFileResults(filePath) {
        return this.testResultsByFile.get(filePath) || new Map();
    }

    /** Get all file paths that have test results */
    getTestFiles() {
        return Array.from(this.testResultsByFile.keys());
    }

    /** Get a summary of all test results */
    getSummary() {
        let totalGroups = 0;
        let passedGroups = 0;
        let failedGroups = 0;
        let erroredGroups = 0;

        for (const [_file, results] of this.testResultsByFile) {
            for (const [_label, result] of results) {
                totalGroups++;
                const passedEntry = result.entries?.get("passed");
                if (passedEntry === null) {
                    // Check summary for errored
                    const summary = result.entries?.get("summary");
                    const errored = summary?.entries?.get("errored");
                    if (errored !== null && errored !== undefined) {
                        const erVal = errored instanceof Integer ? Number(errored.value) : Number(errored);
                        if (erVal > 0) {
                            erroredGroups++;
                        } else {
                            failedGroups++;
                        }
                    } else {
                        failedGroups++;
                    }
                } else {
                    passedGroups++;
                }
            }
        }

        return { totalGroups, passedGroups, failedGroups, erroredGroups };
    }

    /** Get events filtered by kind */
    getEventsByKind(kind) {
        return this.events.filter(e => {
            const k = e.entries?.get("kind");
            return k?.value === kind;
        });
    }
}

/**
 * Get or create the DiagnosticsRegistry for a context.
 */
export function getDiagnostics(context) {
    let diag = context.getEnv(DIAG_ENV_KEY);
    if (!diag) {
        diag = new DiagnosticsRegistry();
        context.setEnv(DIAG_ENV_KEY, diag);
    }
    return diag;
}

/**
 * Get the current source file path from the script runtime, if available.
 */
export function getCurrentFilePath(context) {
    const runtime = context.getEnv("__script_runtime__");
    if (runtime && runtime.frameStack.length > 0) {
        return runtime.frameStack[runtime.frameStack.length - 1].path;
    }
    return context.getEnv("__current_file__", "<repl>");
}

/**
 * Extract source location from an IR node's pos field.
 * Returns { line, col } or null.
 */
export function getSourceLocation(irNode) {
    if (!irNode || !irNode.pos) return null;
    // pos is [startOffset, endOffset, inputLength] from tokenizer
    // We'd need the source to convert to line/col, so just return the offset for now
    return { offset: irNode.pos[0] };
}

// --- Helpers for extracting string values from RiX values ---

export function rixStringValue(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === "string") return val;
    if (val.type === "string") return val.value;
    return null;
}

export function rixIntValue(val) {
    if (val === null || val === undefined) return null;
    if (val instanceof Integer) return Number(val.value);
    if (typeof val === "number") return val;
    if (typeof val === "bigint") return Number(val);
    return null;
}

export function isRixMap(val) {
    return val && val.type === "map" && val.entries instanceof Map;
}

export function isRixArray(val) {
    return val && (val.type === "sequence" || val.type === "array") && Array.isArray(val.values);
}
