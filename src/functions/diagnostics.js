/**
 * Diagnostic system capabilities for RiX:
 * .Warn, .Info, .Error, .Stop, .Test, .Debug, .Trace
 *
 * All emit structured event objects via the DiagnosticsRegistry.
 */

import { Integer } from "@ratmath/core";
import {
    createEvent,
    getDiagnostics,
    getCurrentFilePath,
    RixAbort,
    isRixAbort,
    rixStringValue,
    rixIntValue,
    isRixMap,
    isRixArray,
} from "../diagnostics.js";
import { irToText } from "../ir-to-text.js";
import { callWithConcreteArgs } from "./functions.js";

const EMPTY_MAP = Object.freeze({ type: "map", entries: new Map() });

function toRixInt(n) {
    return new Integer(n);
}

function toRixString(s) {
    return { type: "string", value: s };
}

function isTruthy(val) {
    return val !== null && val !== undefined;
}

/**
 * Validate that a value is a RiX string and return its JS string.
 */
function requireString(val, paramName) {
    const s = rixStringValue(val);
    if (s === null) {
        throw new Error(`${paramName} must be a string`);
    }
    return s;
}

/**
 * Validate that a value is a RiX map or return default empty map.
 */
function requireMap(val, paramName) {
    if (val === null || val === undefined) return EMPTY_MAP;
    if (isRixMap(val)) return val;
    throw new Error(`${paramName} must be a map`);
}

/**
 * Merge user data into event data map, preserving user entries.
 */
function mergeDataMap(baseEntries, userMap) {
    const merged = new Map(baseEntries);
    if (isRixMap(userMap)) {
        for (const [k, v] of userMap.entries) {
            merged.set(k, v);
        }
    }
    return { type: "map", entries: merged };
}

// --- .Warn ---

export const WARN = {
    impl(args, context) {
        const label = requireString(args[0], ".Warn label");
        const dataMap = requireMap(args[1] !== undefined ? args[1] : null, ".Warn dataMap");
        const filePath = getCurrentFilePath(context);

        const event = createEvent({
            kind: "warn",
            label,
            file: filePath,
            data: dataMap,
        });

        getDiagnostics(context).addEvent(event);
        return event;
    },
    doc: "Emit a warning event: .Warn(label, dataMap ?= {=})",
};

// --- .Info ---

export const INFO = {
    impl(args, context) {
        const label = requireString(args[0], ".Info label");
        const level = args[1] !== undefined && args[1] !== null ? rixIntValue(args[1]) : 1;
        if (level === null || !Number.isInteger(level)) {
            throw new Error(".Info level must be an integer");
        }
        // Determine if second arg is level or dataMap
        let dataMap;
        if (args.length >= 3) {
            dataMap = requireMap(args[2], ".Info dataMap");
        } else if (args[1] !== undefined && args[1] !== null && isRixMap(args[1])) {
            // Second arg is actually a map, not a level
            dataMap = args[1];
        } else {
            dataMap = EMPTY_MAP;
        }

        const filePath = getCurrentFilePath(context);

        const event = createEvent({
            kind: "info",
            label,
            level,
            file: filePath,
            data: dataMap,
        });

        getDiagnostics(context).addEvent(event);
        return event;
    },
    doc: "Emit an info event: .Info(label, level ?= 1, dataMap ?= {=})",
};

// --- .Error ---

export const ERROR = {
    impl(args, context) {
        const label = requireString(args[0], ".Error label");
        const dataMap = requireMap(args[1] !== undefined ? args[1] : null, ".Error dataMap");
        const filePath = getCurrentFilePath(context);

        const event = createEvent({
            kind: "error",
            label,
            file: filePath,
            data: dataMap,
        });

        getDiagnostics(context).addEvent(event);
        throw new RixAbort(event);
    },
    doc: "Emit an error event and abort: .Error(label, dataMap ?= {=})",
};

// --- .Stop ---

export const STOP = {
    lazy: true,
    impl(args, context, evaluate) {
        const label = requireString(evaluate(args[0]), ".Stop label");
        const condition = evaluate(args[1]);

        if (!isTruthy(condition)) {
            return null;
        }

        const dataMapArg = args.length >= 3 ? evaluate(args[2]) : null;
        const userMap = requireMap(dataMapArg, ".Stop dataMap");

        const condData = new Map();
        condData.set("condition", condition);
        const data = mergeDataMap(condData, userMap);

        const filePath = getCurrentFilePath(context);

        const event = createEvent({
            kind: "stop",
            label,
            file: filePath,
            data,
        });

        getDiagnostics(context).addEvent(event);
        throw new RixAbort(event);
    },
    doc: "Conditional abort: .Stop(label, condition, dataMap ?= {=})",
};

// --- .Test ---

export const TEST = {
    lazy: true,
    impl(args, context, evaluate) {
        const label = requireString(evaluate(args[0]), ".Test label");
        const setupNode = args[1];
        const testsNode = args[2];
        const filePath = getCurrentFilePath(context);
        const diag = getDiagnostics(context);

        // Determine mode by evaluating the tests argument type
        // We need to peek at the IR node to decide
        const testsIR = testsNode;

        // Check if it's an ARRAY or MAP IR node
        if (testsIR && testsIR.fn === "ARRAY") {
            return runSequentialTests(label, setupNode, testsIR.args, filePath, context, evaluate, diag);
        } else if (testsIR && (testsIR.fn === "MAP" || testsIR.fn === "MAP_OBJ")) {
            return runIsolatedTests(label, setupNode, testsIR.args, filePath, context, evaluate, diag);
        } else {
            // Evaluate to determine type
            const testsVal = evaluate(testsIR);
            if (isRixArray(testsVal)) {
                // Already evaluated array - can't defer individual tests
                // Treat values as already-evaluated test results
                return runSequentialTestsFromValues(label, setupNode, testsVal.values, filePath, context, evaluate, diag);
            } else if (isRixMap(testsVal)) {
                return runIsolatedTestsFromValues(label, setupNode, testsVal, filePath, context, evaluate, diag);
            } else {
                throw new Error(".Test third argument must be an array or map of tests");
            }
        }
    },
    doc: "Run tests: .Test(label, setup, [tests] | {= tests })",
};

function runSequentialTests(label, setupNode, testArgs, filePath, context, evaluate, diag) {
    const results = [];
    let passedAll = true;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalErrored = 0;
    let totalSkipped = 0;
    let stopped = false;

    // Run setup once in a new scope, sharing the scope so bindings persist
    context.push(undefined, { isolated: true });
    let setupResult = { type: "map", entries: new Map([["passed", toRixInt(1)]]) };

    try {
        context.withSharedBody(setupNode, () => evaluate(setupNode));
    } catch (err) {
        setupResult = { type: "map", entries: new Map([
            ["passed", null],
            ["error", toRixString(err.message)],
        ])};
        passedAll = false;
        stopped = true;
    }

    // Run tests sequentially in the same scope (bindings from setup are visible)
    if (!stopped) {
        for (let i = 0; i < testArgs.length; i++) {
            if (stopped) {
                results.push(makeTestEntry(i + 1, null, null, null, true));
                totalSkipped++;
                continue;
            }

            try {
                const testNode = testArgs[i];
                // Skip HOLE nodes (commas with no expression)
                if (testNode && testNode.fn === "HOLE") {
                    results.push(makeTestEntry(i + 1, null, null, null, true));
                    totalSkipped++;
                    continue;
                }
                // If test is a BLOCK, share the current scope so it can see/mutate setup vars
                let val;
                if (testNode && testNode.fn === "BLOCK") {
                    val = context.withSharedBody(testNode, () => evaluate(testNode));
                } else {
                    val = evaluate(testNode);
                }
                if (isTruthy(val)) {
                    results.push(makeTestEntry(i + 1, true, val, null, false));
                    totalPassed++;
                } else {
                    results.push(makeTestEntry(i + 1, false, val, null, false));
                    totalFailed++;
                    passedAll = false;
                    stopped = true;
                }
            } catch (err) {
                results.push(makeTestEntry(i + 1, false, null, err.message, false));
                totalErrored++;
                passedAll = false;
                stopped = true;
            }
        }

        // Mark remaining as skipped
        if (stopped) {
            for (let i = results.length; i < testArgs.length; i++) {
                results.push(makeTestEntry(i + 1, null, null, null, true));
                totalSkipped++;
            }
        }
    }

    context.pop();

    const summaryEntries = new Map();
    summaryEntries.set("total", toRixInt(testArgs.length));
    summaryEntries.set("passed", toRixInt(totalPassed));
    summaryEntries.set("failed", toRixInt(totalFailed));
    summaryEntries.set("errored", toRixInt(totalErrored));
    summaryEntries.set("skipped", toRixInt(totalSkipped));

    const resultEntries = new Map();
    resultEntries.set("kind", toRixString("test"));
    resultEntries.set("label", toRixString(label));
    resultEntries.set("mode", toRixString("sequential"));
    resultEntries.set("file", toRixString(filePath));
    resultEntries.set("passed", passedAll ? toRixInt(1) : null);
    resultEntries.set("setup", setupResult);
    resultEntries.set("results", { type: "sequence", values: results });
    resultEntries.set("summary", { type: "map", entries: summaryEntries });

    const resultObj = { type: "map", entries: resultEntries };
    diag.addEvent(resultObj);
    diag.registerTestResult(filePath, label, resultObj);
    return resultObj;
}

function runSequentialTestsFromValues(label, setupNode, testValues, filePath, context, evaluate, diag) {
    // Tests are already evaluated - treat non-null as pass, null as fail
    const results = [];
    let passedAll = true;
    let totalPassed = 0;
    let totalFailed = 0;

    // Run setup
    context.push(undefined, { isolated: true });
    try { evaluate(setupNode); } catch { /* ignore */ }

    for (let i = 0; i < testValues.length; i++) {
        const val = testValues[i];
        if (isTruthy(val)) {
            results.push(makeTestEntry(i + 1, true, val, null, false));
            totalPassed++;
        } else {
            results.push(makeTestEntry(i + 1, false, val, null, false));
            totalFailed++;
            passedAll = false;
        }
    }

    context.pop();

    const summaryEntries = new Map();
    summaryEntries.set("total", toRixInt(testValues.length));
    summaryEntries.set("passed", toRixInt(totalPassed));
    summaryEntries.set("failed", toRixInt(totalFailed));
    summaryEntries.set("errored", toRixInt(0));
    summaryEntries.set("skipped", toRixInt(0));

    const resultEntries = new Map();
    resultEntries.set("kind", toRixString("test"));
    resultEntries.set("label", toRixString(label));
    resultEntries.set("mode", toRixString("sequential"));
    resultEntries.set("file", toRixString(filePath));
    resultEntries.set("passed", passedAll ? toRixInt(1) : null);
    resultEntries.set("results", { type: "sequence", values: results });
    resultEntries.set("summary", { type: "map", entries: summaryEntries });

    const resultObj = { type: "map", entries: resultEntries };
    diag.addEvent(resultObj);
    diag.registerTestResult(filePath, label, resultObj);
    return resultObj;
}

function runIsolatedTests(label, setupNode, mapArgs, filePath, context, evaluate, diag) {
    // MAP_OBJ stores args as MAP_PAIR nodes: { fn: "MAP_PAIR", args: [kind, key, valueNode] }
    const testEntries = [];
    for (const arg of mapArgs) {
        if (arg && arg.fn === "MAP_PAIR") {
            const key = arg.args[1]; // key is a string (identifier or string literal name)
            const valNode = arg.args[2]; // value IR node
            testEntries.push({ key: String(key), valNode });
        } else {
            // Fallback: paired key/value format
            throw new Error(".Test map mode requires {= label = expr, ... } map literal");
        }
    }

    return runIsolatedTestEntries(label, setupNode, testEntries, filePath, context, evaluate, diag);
}

function runIsolatedTestsFromValues(label, setupNode, testsMap, filePath, context, evaluate, diag) {
    const testEntries = [];
    for (const [key, val] of testsMap.entries) {
        testEntries.push({ key, value: val });
    }

    const resultMap = new Map();
    let passedAll = true;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalErrored = 0;

    for (const { key, value } of testEntries) {
        if (isTruthy(value)) {
            resultMap.set(key, makeIsolatedEntry(true, value, null));
            totalPassed++;
        } else {
            resultMap.set(key, makeIsolatedEntry(false, value, null));
            totalFailed++;
            passedAll = false;
        }
    }

    return buildIsolatedResult(label, filePath, passedAll, resultMap, testEntries.length,
        totalPassed, totalFailed, totalErrored, diag);
}

function runIsolatedTestEntries(label, setupNode, testEntries, filePath, context, evaluate, diag) {
    const resultMap = new Map();
    let passedAll = true;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalErrored = 0;

    for (const { key, valNode } of testEntries) {
        // Fresh isolated scope for each test — setup bindings live here.
        // The test expression runs in this same scope (via withSharedBody for BLOCKs),
        // so setup vars are directly accessible as `x` (not `@x`).
        // `@x` from inside a test block skips past this scope to the global scope,
        // which is the intended semantics: @ means "outside the test entirely".
        context.push(undefined, { isolated: true });
        try {
            // Run setup fresh, sharing scope so bindings persist into the test scope
            context.withSharedBody(setupNode, () => evaluate(setupNode));

            // Evaluate the test expression in the same isolated scope.
            // BLOCKs share this scope (withSharedBody) so they see setup vars directly.
            // Non-BLOCK expressions evaluate in it directly.
            let val;
            if (valNode && valNode.fn === "BLOCK") {
                val = context.withSharedBody(valNode, () => evaluate(valNode));
            } else {
                val = evaluate(valNode);
            }
            if (isTruthy(val)) {
                resultMap.set(key, makeIsolatedEntry(true, val, null));
                totalPassed++;
            } else {
                resultMap.set(key, makeIsolatedEntry(false, val, null));
                totalFailed++;
                passedAll = false;
            }
        } catch (err) {
            resultMap.set(key, makeIsolatedEntry(false, null, err.message));
            totalErrored++;
            passedAll = false;
        } finally {
            context.pop();
        }
    }

    return buildIsolatedResult(label, filePath, passedAll, resultMap, testEntries.length,
        totalPassed, totalFailed, totalErrored, diag);
}

function buildIsolatedResult(label, filePath, passedAll, resultMap, total, passed, failed, errored, diag) {
    const summaryEntries = new Map();
    summaryEntries.set("total", toRixInt(total));
    summaryEntries.set("passed", toRixInt(passed));
    summaryEntries.set("failed", toRixInt(failed));
    summaryEntries.set("errored", toRixInt(errored));

    const resultEntries = new Map();
    resultEntries.set("kind", toRixString("test"));
    resultEntries.set("label", toRixString(label));
    resultEntries.set("mode", toRixString("isolated"));
    resultEntries.set("file", toRixString(filePath));
    resultEntries.set("passed", passedAll ? toRixInt(1) : null);
    resultEntries.set("results", { type: "map", entries: resultMap });
    resultEntries.set("summary", { type: "map", entries: summaryEntries });

    const resultObj = { type: "map", entries: resultEntries };
    diag.addEvent(resultObj);
    diag.registerTestResult(filePath, label, resultObj);
    return resultObj;
}

function makeTestEntry(index, passed, value, error, skipped) {
    const entries = new Map();
    entries.set("index", toRixInt(index));
    entries.set("passed", passed === true ? toRixInt(1) : null);
    if (value !== null && value !== undefined) entries.set("value", value);
    if (error !== null && error !== undefined) entries.set("error", toRixString(error));
    entries.set("skipped", skipped ? toRixInt(1) : null);
    return { type: "map", entries };
}

function makeIsolatedEntry(passed, value, error) {
    const entries = new Map();
    entries.set("passed", passed ? toRixInt(1) : null);
    if (value !== null && value !== undefined) entries.set("value", value);
    if (error !== null && error !== undefined) entries.set("error", toRixString(error));
    return { type: "map", entries };
}

// --- .Debug ---

export const DEBUG = {
    lazy: true,
    impl(args, context, evaluate) {
        const label = requireString(evaluate(args[0]), ".Debug label");
        const exprNode = args[1];
        const filePath = getCurrentFilePath(context);

        // Capture expression source representation from IR
        const exprSource = irToText(exprNode);

        // Build a simplified AST representation as a RiX string
        const astRepr = irToText(exprNode, { pretty: true });

        // Evaluate the expression (once!)
        let finalValue;
        try {
            finalValue = evaluate(exprNode);
        } catch (err) {
            // Record the error in the debug event
            const dataEntries = new Map();
            dataEntries.set("exprSource", toRixString(exprSource));
            dataEntries.set("ast", toRixString(astRepr));
            dataEntries.set("error", toRixString(err.message));

            const event = createEvent({
                kind: "debug",
                label,
                file: filePath,
                data: { type: "map", entries: dataEntries },
            });

            getDiagnostics(context).addEvent(event);
            throw err;
        }

        // Build debug data payload
        const dataEntries = new Map();
        dataEntries.set("exprSource", toRixString(exprSource));
        dataEntries.set("ast", toRixString(astRepr));
        dataEntries.set("final", finalValue);

        const event = createEvent({
            kind: "debug",
            label,
            file: filePath,
            data: { type: "map", entries: dataEntries },
        });

        getDiagnostics(context).addEvent(event);

        // Return the evaluated value, not the event, so .Debug composes inline
        return finalValue;
    },
    doc: "Debug expression: .Debug(label, expr) — returns expr value, records AST/source",
};

// --- .Trace ---

export const TRACE = {
    lazy: true,
    impl(args, context, evaluate) {
        const label = requireString(evaluate(args[0]), ".Trace label");

        const depthVal = evaluate(args[1]);
        const depth = rixIntValue(depthVal);
        if (depth === null || depth < 0 || !Number.isInteger(depth)) {
            throw new Error(".Trace depth must be a non-negative integer");
        }

        // trackedVars: optional array of strings, default []
        let trackedVars = [];
        let callableNode;

        if (args.length >= 4) {
            const varsVal = evaluate(args[2]);
            if (isRixArray(varsVal)) {
                trackedVars = varsVal.values.map(v => {
                    const s = rixStringValue(v);
                    if (s === null) throw new Error(".Trace trackedVars must be an array of strings");
                    return s;
                });
            } else if (varsVal === null) {
                trackedVars = [];
            } else {
                throw new Error(".Trace trackedVars must be an array of strings");
            }
            callableNode = args[3];
        } else {
            callableNode = args[2];
        }

        const filePath = getCurrentFilePath(context);
        const traceLog = [];

        // Set up trace context in the environment
        const traceContext = {
            depth,
            trackedVars: new Set(trackedVars),
            currentDepth: 0,
            log: traceLog,
            active: true,
        };

        const prevTrace = context.getEnv("__trace_context__");
        context.setEnv("__trace_context__", traceContext);

        let finalValue;
        try {
            // Evaluate the callable and invoke it
            const callable = evaluate(callableNode);
            if (callable && (callable.type === "function" || callable.type === "lambda")) {
                finalValue = callWithConcreteArgs(callable, [], context, evaluate);
            } else if (typeof callable === "function") {
                finalValue = callable();
            } else {
                // Try evaluating as a thunk - the node itself is the expression
                finalValue = callable;
            }
        } finally {
            traceContext.active = false;
            if (prevTrace) {
                context.setEnv("__trace_context__", prevTrace);
            } else {
                context.setEnv("__trace_context__", null);
            }
        }

        // Build trace calls array
        const callEntries = traceLog.map(entry => {
            const m = new Map();
            m.set("event", toRixString(entry.event));
            if (entry.fn) m.set("fn", toRixString(entry.fn));
            if (entry.scope) m.set("scope", toRixString(entry.scope));
            if (entry.depth !== undefined) m.set("depth", toRixInt(entry.depth));
            if (entry.args) m.set("args", { type: "sequence", values: entry.args });
            if (entry.value !== undefined) m.set("value", entry.value);
            if (entry.var) m.set("var", toRixString(entry.var));
            if (entry.old !== undefined) m.set("old", entry.old);
            if (entry.new !== undefined) m.set("new", entry.new);
            if (entry.variantIndex !== undefined) m.set("variantIndex", toRixInt(entry.variantIndex));
            if (entry.variantName) m.set("variantName", toRixString(entry.variantName));
            return { type: "map", entries: m };
        });

        // Build data payload
        const dataEntries = new Map();
        dataEntries.set("depth", toRixInt(depth));
        dataEntries.set("trackedVars", {
            type: "sequence",
            values: trackedVars.map(toRixString),
        });
        dataEntries.set("calls", { type: "sequence", values: callEntries });
        dataEntries.set("final", finalValue);

        const event = createEvent({
            kind: "trace",
            label,
            file: filePath,
            data: { type: "map", entries: dataEntries },
        });

        getDiagnostics(context).addEvent(event);

        // Return the callable's result, not the event
        return finalValue;
    },
    doc: "Trace execution: .Trace(label, depth, trackedVars?, thunkOrCallable)",
};

// --- Shared helpers for .TestError / .TestStop ---

/**
 * Classify a thrown error into a normalized outcome string.
 * Returns { outcome, abort, error } where:
 *   outcome: "error" | "stop" | "runtimeError"
 *   abort:   the RixAbort event map, or undefined
 *   error:   JS error message string, or null
 */
function classifyError(err) {
    if (err instanceof RixAbort) {
        const kind = err.event?.entries?.get("kind")?.value;
        if (kind === "stop") return { outcome: "stop", abort: err.event, error: null };
        return { outcome: "error", abort: err.event, error: null };
    }
    return { outcome: "runtimeError", abort: undefined, error: err.message };
}

function buildAbortTestResult({ label, testKind, filePath, expected,
    setupPassed, setupOutcome, setupValue, setupAbort, setupError,
    exprOutcome, exprValue, exprAbort, exprError, passed }) {

    const setupEntries = new Map();
    setupEntries.set("passed", setupPassed ? toRixInt(1) : null);
    setupEntries.set("outcome", toRixString(setupOutcome));
    if (setupValue !== undefined) setupEntries.set("value", setupValue);
    if (setupAbort !== undefined) setupEntries.set("abort", setupAbort);
    if (setupError !== null && setupError !== undefined) setupEntries.set("error", toRixString(setupError));

    const exprEntries = new Map();
    exprEntries.set("passed", passed ? toRixInt(1) : null);
    exprEntries.set("outcome", toRixString(exprOutcome));
    if (exprValue !== undefined) exprEntries.set("value", exprValue);
    if (exprAbort !== undefined) exprEntries.set("abort", exprAbort);
    if (exprError !== null && exprError !== undefined) exprEntries.set("error", toRixString(exprError));

    const summaryEntries = new Map();
    summaryEntries.set("expected", toRixString(expected));
    summaryEntries.set("setupPassed", setupPassed ? toRixInt(1) : null);
    summaryEntries.set("exprOutcome", toRixString(exprOutcome));

    const resultEntries = new Map();
    resultEntries.set("kind", toRixString("test"));
    resultEntries.set("testKind", toRixString(testKind));
    resultEntries.set("label", toRixString(label));
    resultEntries.set("file", toRixString(filePath));
    resultEntries.set("passed", passed ? toRixInt(1) : null);
    resultEntries.set("expected", toRixString(expected));
    resultEntries.set("setup", { type: "map", entries: setupEntries });
    resultEntries.set("expr", { type: "map", entries: exprEntries });
    resultEntries.set("summary", { type: "map", entries: summaryEntries });

    return { type: "map", entries: resultEntries };
}

function runAbortTest(testKind, args, context, evaluate) {
    const capName = testKind === "error" ? ".TestError" : ".TestStop";
    const label = requireString(evaluate(args[0]), `${capName} label`);
    const setupNode = args[1];
    const exprNode = args[2];
    const filePath = getCurrentFilePath(context);
    const diag = getDiagnostics(context);

    let setupPassed = true;
    let setupOutcome = "returned";
    let setupValue;
    let setupAbort;
    let setupError = null;

    let exprOutcome = "returned";
    let exprValue;
    let exprAbort;
    let exprError = null;
    let passed = false;

    context.push(undefined, { isolated: true });
    try {
        // Run setup
        try {
            setupValue = context.withSharedBody(setupNode, () => evaluate(setupNode));
        } catch (err) {
            setupPassed = false;
            const c = classifyError(err);
            setupOutcome = c.outcome;
            setupAbort = c.abort;
            setupError = c.error;
        }

        // Only run expr if setup passed
        if (setupPassed) {
            try {
                let val;
                if (exprNode && exprNode.fn === "BLOCK") {
                    val = context.withSharedBody(exprNode, () => evaluate(exprNode));
                } else {
                    val = evaluate(exprNode);
                }
                // Returned normally — always a failure for abort tests
                exprOutcome = "returned";
                exprValue = val;
                passed = false;
            } catch (err) {
                const c = classifyError(err);
                exprOutcome = c.outcome;
                exprAbort = c.abort;
                exprError = c.error;
                if (testKind === "error") {
                    passed = exprOutcome === "error" || exprOutcome === "runtimeError";
                } else {
                    passed = exprOutcome === "stop";
                }
            }
        }
    } finally {
        context.pop();
    }

    const overallPassed = setupPassed && passed;
    const result = buildAbortTestResult({
        label, testKind, filePath,
        expected: testKind === "error" ? "error" : "stop",
        setupPassed, setupOutcome, setupValue, setupAbort, setupError,
        exprOutcome, exprValue, exprAbort, exprError, passed: overallPassed,
    });

    diag.addEvent(result);
    diag.registerTestResult(filePath, label, result);
    return result;
}

// --- .TestError ---

export const TEST_ERROR = {
    lazy: true,
    impl(args, context, evaluate) {
        return runAbortTest("error", args, context, evaluate);
    },
    doc: "Abort test: .TestError(label, setup, expr) — passes if expr aborts with .Error() or a runtime error",
};

// --- .TestStop ---

export const TEST_STOP = {
    lazy: true,
    impl(args, context, evaluate) {
        return runAbortTest("stop", args, context, evaluate);
    },
    doc: "Abort test: .TestStop(label, setup, expr) — passes if expr aborts via .Stop()",
};

export const diagnosticFunctions = {
    WARN,
    INFO,
    ERROR,
    STOP,
    TEST,
    TESTERROR: TEST_ERROR,
    TESTSTOP: TEST_STOP,
    DEBUG,
    TRACE,
};
