import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { getDiagnostics, isRixAbort, RixAbort } from "../src/diagnostics.js";
import { installSymbolicBindings } from "../src/functions/symbolic.js";
import { Integer } from "@ratmath/core";

const defaultSystemContext = createDefaultSystemContext();

function evalRix(code, context) {
    const ctx = context || new Context();
    installSymbolicBindings(ctx);
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry, defaultSystemContext);
    }
    return result;
}

function evalRixWithDiag(code) {
    const ctx = new Context();
    installSymbolicBindings(ctx);
    ctx.setEnv("__current_file__", "<test>");
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens);
    const irNodes = lower(ast);

    let result = null;
    let error = null;
    try {
        for (const irNode of irNodes) {
            result = evaluate(irNode, ctx, registry, defaultSystemContext);
        }
    } catch (err) {
        error = err;
    }
    return { result, error, diag: getDiagnostics(ctx), ctx };
}

function mapGet(rixMap, key) {
    if (!rixMap || !rixMap.entries) return undefined;
    return rixMap.entries.get(key);
}

function intVal(v) {
    if (v instanceof Integer) return Number(v.value);
    return v;
}

// --- .Warn tests ---

describe(".Warn", () => {
    test("emits warn event with empty data map default", () => {
        const { result, diag } = evalRixWithDiag('.Warn("w")');
        expect(mapGet(result, "kind")?.value).toBe("warn");
        expect(mapGet(result, "label")?.value).toBe("w");
        expect(mapGet(result, "data")?.entries?.size).toBe(0);
        expect(diag.events.length).toBe(1);
        expect(mapGet(diag.events[0], "kind")?.value).toBe("warn");
    });

    test("emits warn event with data map", () => {
        const { result } = evalRixWithDiag('.Warn("caution", {= x = 1 })');
        expect(mapGet(result, "kind")?.value).toBe("warn");
        const data = mapGet(result, "data");
        expect(intVal(data.entries.get("x"))).toBe(1);
    });

    test("returns the event object", () => {
        const { result } = evalRixWithDiag('.Warn("test")');
        expect(result.type).toBe("map");
        expect(mapGet(result, "kind")?.value).toBe("warn");
    });
});

// --- .Info tests ---

describe(".Info", () => {
    test("defaults level to 1 and empty data map", () => {
        const { result } = evalRixWithDiag('.Info("i")');
        expect(mapGet(result, "kind")?.value).toBe("info");
        expect(intVal(mapGet(result, "level"))).toBe(1);
        expect(mapGet(result, "data")?.entries?.size).toBe(0);
    });

    test("accepts explicit level", () => {
        const { result } = evalRixWithDiag('.Info("i", 3)');
        expect(intVal(mapGet(result, "level"))).toBe(3);
    });

    test("accepts level and data map", () => {
        const { result } = evalRixWithDiag('.Info("i", 2, {= msg = "hello" })');
        expect(intVal(mapGet(result, "level"))).toBe(2);
        const data = mapGet(result, "data");
        expect(data.entries.get("msg")?.value).toBe("hello");
    });
});

// --- .Error tests ---

describe(".Error", () => {
    test("emits event then aborts", () => {
        const { result, error, diag } = evalRixWithDiag('.Error("e")');
        expect(error).not.toBeNull();
        expect(isRixAbort(error)).toBe(true);
        expect(diag.events.length).toBe(1);
        expect(mapGet(diag.events[0], "kind")?.value).toBe("error");
        expect(mapGet(diag.events[0], "label")?.value).toBe("e");
    });

    test("error aborts evaluation - later code does not run", () => {
        const { error, diag } = evalRixWithDiag(`
            .Error("boom");
            .Warn("should not run")
        `);
        expect(isRixAbort(error)).toBe(true);
        expect(diag.events.length).toBe(1);
        expect(mapGet(diag.events[0], "kind")?.value).toBe("error");
    });
});

// --- .Stop tests ---

describe(".Stop", () => {
    test("does nothing and returns null when condition is null", () => {
        const { result, error, diag } = evalRixWithDiag('.Stop("s", _)');
        expect(error).toBeNull();
        expect(result).toBeNull();
        expect(diag.events.length).toBe(0);
    });

    test("emits stop event and aborts when condition is non-null", () => {
        const { error, diag } = evalRixWithDiag('.Stop("s", 1)');
        expect(isRixAbort(error)).toBe(true);
        expect(diag.events.length).toBe(1);
        expect(mapGet(diag.events[0], "kind")?.value).toBe("stop");
        const data = mapGet(diag.events[0], "data");
        expect(intVal(data.entries.get("condition"))).toBe(1);
    });

    test("stop with data map", () => {
        const { error, diag } = evalRixWithDiag('.Stop("halt", 1, {= reason = "bad" })');
        expect(isRixAbort(error)).toBe(true);
        const data = mapGet(diag.events[0], "data");
        expect(data.entries.get("reason")?.value).toBe("bad");
    });
});

// --- .Test sequential mode ---

describe(".Test sequential mode", () => {
    test("setup runs once, tests pass", () => {
        const { result } = evalRixWithDiag(`
            .Test("basic", {; x := 1 }, [
                x == 1,
                {; x ~= x + 1; x == 2 }
            ])
        `);
        expect(mapGet(result, "kind")?.value).toBe("test");
        expect(mapGet(result, "mode")?.value).toBe("sequential");
        expect(intVal(mapGet(result, "passed"))).toBe(1);
        const summary = mapGet(result, "summary");
        expect(intVal(summary.entries.get("total"))).toBe(2);
        expect(intVal(summary.entries.get("passed"))).toBe(2);
    });

    test("later tests see earlier test mutations", () => {
        const { result } = evalRixWithDiag(`
            .Test("shared", {; x := 1 }, [
                {; x ~= 10; x == 10 },
                x == 10
            ])
        `);
        expect(intVal(mapGet(result, "passed"))).toBe(1);
    });

    test("null result fails and stops remaining tests", () => {
        const { result } = evalRixWithDiag(`
            .Test("fail", {; }, [
                1,
                _,
                1
            ])
        `);
        expect(mapGet(result, "passed")).toBeNull();
        const summary = mapGet(result, "summary");
        expect(intVal(summary.entries.get("passed"))).toBe(1);
        expect(intVal(summary.entries.get("failed"))).toBe(1);
        expect(intVal(summary.entries.get("skipped"))).toBe(1);
    });

    test("runtime error fails and stops remaining tests", () => {
        const { result } = evalRixWithDiag(`
            .Test("error", {; }, [
                1,
                {; .Error("boom") },
                1
            ])
        `);
        expect(mapGet(result, "passed")).toBeNull();
        const summary = mapGet(result, "summary");
        expect(intVal(summary.entries.get("errored"))).toBe(1);
        expect(intVal(summary.entries.get("skipped"))).toBe(1);
    });

    test("rich result shape is returned and registered", () => {
        const { result, diag } = evalRixWithDiag(`
            .Test("shape", {; }, [1, 1])
        `);
        expect(result.type).toBe("map");
        expect(mapGet(result, "kind")?.value).toBe("test");
        expect(mapGet(result, "label")?.value).toBe("shape");
        expect(mapGet(result, "file")?.value).toBe("<test>");
        // Check registered in diagnostics
        const fileResults = diag.getFileResults("<test>");
        expect(fileResults.has("shape")).toBe(true);
    });

    test("duplicate group label in same file errors", () => {
        const { error } = evalRixWithDiag(`
            .Test("dup", {; }, [1]);
            .Test("dup", {; }, [1])
        `);
        expect(error).not.toBeNull();
        expect(error.message).toContain("Duplicate test group label");
    });
});

// --- .Test isolated mode ---

describe(".Test isolated mode", () => {
    test("setup reruns freshly per labeled test", () => {
        const { result } = evalRixWithDiag(`
            .Test("iso", {; x := 0 }, {=
                first = {; x ~= x + 1; x == 1 },
                second = {; x ~= x + 1; x == 1 }
            })
        `);
        expect(mapGet(result, "mode")?.value).toBe("isolated");
        expect(intVal(mapGet(result, "passed"))).toBe(1);
    });

    test("all labeled tests are attempted even if some fail", () => {
        const { result } = evalRixWithDiag(`
            .Test("iso-fail", {; }, {=
                a = 1,
                b = _,
                c = 1
            })
        `);
        const summary = mapGet(result, "summary");
        expect(intVal(summary.entries.get("total"))).toBe(3);
        expect(intVal(summary.entries.get("passed"))).toBe(2);
        expect(intVal(summary.entries.get("failed"))).toBe(1);
    });

    test("null counts as failure", () => {
        const { result } = evalRixWithDiag(`
            .Test("null-fail", {; }, {= t = _ })
        `);
        expect(mapGet(result, "passed")).toBeNull();
        const results = mapGet(result, "results");
        const tResult = results.entries.get("t");
        expect(mapGet(tResult, "passed")).toBeNull();
    });

    test("runtime error counts as error", () => {
        const { result } = evalRixWithDiag(`
            .Test("err", {; }, {=
                ok = 1,
                bad = {; .Error("fail") }
            })
        `);
        expect(mapGet(result, "passed")).toBeNull();
        const summary = mapGet(result, "summary");
        expect(intVal(summary.entries.get("errored"))).toBe(1);
        expect(intVal(summary.entries.get("passed"))).toBe(1);
    });

    test("result map structure is returned and registered", () => {
        const { result, diag } = evalRixWithDiag(`
            .Test("struct", {; }, {= a = 1 })
        `);
        expect(result.type).toBe("map");
        expect(mapGet(result, "kind")?.value).toBe("test");
        expect(mapGet(result, "results")?.entries?.has("a")).toBe(true);
        expect(diag.getFileResults("<test>").has("struct")).toBe(true);
    });
});

// --- .Debug ---

describe(".Debug", () => {
    test("returns final value of expression", () => {
        const { result } = evalRixWithDiag('.Debug("sum", 1 + 2)');
        expect(intVal(result)).toBe(3);
    });

    test("records AST/source info", () => {
        const { diag } = evalRixWithDiag('.Debug("check", 1 + 2)');
        expect(diag.events.length).toBe(1);
        const event = diag.events[0];
        expect(mapGet(event, "kind")?.value).toBe("debug");
        const data = mapGet(event, "data");
        expect(data.entries.has("exprSource")).toBe(true);
        expect(data.entries.has("ast")).toBe(true);
        expect(data.entries.has("final")).toBe(true);
    });

    test("works inline in larger expressions", () => {
        const { result } = evalRixWithDiag(`
            x := .Debug("val", 5);
            x + 1
        `);
        expect(intVal(result)).toBe(6);
    });

    test("does not evaluate expression twice", () => {
        // Verify only one debug event is recorded (expression evaluated once)
        const { result, diag } = evalRixWithDiag('.Debug("once", 2 + 3)');
        expect(intVal(result)).toBe(5);
        expect(diag.events.length).toBe(1);
        // The final value in the data should match the returned value
        const data = mapGet(diag.events[0], "data");
        expect(intVal(data.entries.get("final"))).toBe(5);
    });
});

// --- .Trace ---

describe(".Trace", () => {
    test("returns wrapped callable's result", () => {
        const { result } = evalRixWithDiag('.Trace("t", 1, [], () -> 42)');
        expect(intVal(result)).toBe(42);
    });

    test("records trace event", () => {
        const { diag } = evalRixWithDiag('.Trace("t", 1, [], () -> 42)');
        expect(diag.events.length).toBe(1);
        const event = diag.events[0];
        expect(mapGet(event, "kind")?.value).toBe("trace");
        const data = mapGet(event, "data");
        expect(data.entries.has("calls")).toBe(true);
        expect(data.entries.has("final")).toBe(true);
    });

    test("respects depth limit", () => {
        const { result } = evalRixWithDiag('.Trace("deep", 0, [], () -> 99)');
        expect(intVal(result)).toBe(99);
    });

    test("empty tracked var list still records structure", () => {
        const { diag } = evalRixWithDiag('.Trace("empty", 1, [], () -> 1)');
        const data = mapGet(diag.events[0], "data");
        const trackedVars = data.entries.get("trackedVars");
        expect(trackedVars.values.length).toBe(0);
    });

    test("works without explicit tracked vars (3 args)", () => {
        const { result } = evalRixWithDiag('.Trace("no-vars", 1, () -> 7)');
        expect(intVal(result)).toBe(7);
    });

    test("tracks function enter and exit", () => {
        const { diag } = evalRixWithDiag('.Trace("t", 1, [], () -> 42)');
        const calls = mapGet(diag.events[0], "data").entries.get("calls").values;
        expect(calls.length).toBe(2);
        expect(mapGet(calls[0], "event")?.value).toBe("enter");
        expect(mapGet(calls[1], "event")?.value).toBe("exit");
        expect(intVal(mapGet(calls[1], "value"))).toBe(42);
    });

    test("tracks variable assignments when tracked", () => {
        const { diag } = evalRixWithDiag('.Trace("t", 1, ["x"], () -> {; x = 1; x += 2; })');
        const calls = mapGet(diag.events[0], "data").entries.get("calls").values;
        // enter lambda, x=1, x+=2, exit lambda
        expect(calls.length).toBe(4);
        
        const write1 = calls[1];
        expect(mapGet(write1, "event")?.value).toBe("write");
        expect(mapGet(write1, "var")?.value).toBe("x");
        expect(intVal(mapGet(write1, "new"))).toBe(1);

        const write2 = calls[2];
        expect(mapGet(write2, "event")?.value).toBe("write");
        expect(mapGet(write2, "var")?.value).toBe("x");
        expect(intVal(mapGet(write2, "old"))).toBe(1);
        expect(intVal(mapGet(write2, "new"))).toBe(3);
    });
});

// --- Uppercase alias tests ---

describe("Uppercase aliases", () => {
    test(".WARN works as alias for .Warn", () => {
        const { result } = evalRixWithDiag('.WARN("w")');
        expect(mapGet(result, "kind")?.value).toBe("warn");
    });

    test(".INFO works", () => {
        const { result } = evalRixWithDiag('.INFO("i")');
        expect(mapGet(result, "kind")?.value).toBe("info");
    });

    test(".ERROR aborts", () => {
        const { error } = evalRixWithDiag('.ERROR("e")');
        expect(isRixAbort(error)).toBe(true);
    });
});

// --- CLI tests ---

import { spawnSync } from "child_process";
import path from "path";

const rixTool = path.resolve(import.meta.dir, "../../tools/rix.js");
const sampleTestFile = path.resolve(import.meta.dir, "sample.test.rix");

describe("CLI rix test", () => {
    test("discovers recursive .test.rix files", () => {
        const result = spawnSync("bun", [rixTool, "test"], {
            cwd: path.resolve(import.meta.dir, "../.."),
            encoding: "utf-8",
        });
        expect(result.stdout).toContain("Discovered");
        expect(result.stdout).toContain("sample.test.rix");
    });

    test("filters file set by keyword", () => {
        const result = spawnSync("bun", [rixTool, "test", "sample"], {
            cwd: path.resolve(import.meta.dir, "../.."),
            encoding: "utf-8",
        });
        expect(result.stdout).toContain("sample.test.rix");
        expect(result.status).toBe(0);
    });

    test("exit code is nonzero when no files match filter", () => {
        const result = spawnSync("bun", [rixTool, "test", "zzz_nonexistent_zzz"], {
            cwd: path.resolve(import.meta.dir, "../.."),
            encoding: "utf-8",
        });
        expect(result.status).not.toBe(0);
    });

    test("summaries reflect structured registry results", () => {
        const result = spawnSync("bun", [rixTool, "test", "sample"], {
            cwd: path.resolve(import.meta.dir, "../.."),
            encoding: "utf-8",
        });
        expect(result.stdout).toContain("PASS");
        expect(result.stdout).toContain("arithmetic");
        expect(result.stdout).toContain("isolated checks");
    });
});
