/**
 * Tests for the SystemContext (`.`) capability object.
 *
 * Covers:
 *  - Parser: SystemObject and SystemAccess nodes
 *  - Evaluator: SYS_OBJ, SYS_GET, SYS_CALL, SYS_SET
 *  - SystemContext class: copy, withhold, with, freeze
 *  - @+ operator alias shorthand
 *  - Sandboxing: loaded scripts with restricted contexts
 */

import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { SystemContext } from "../src/system-context.js";
import { Context } from "../src/context.js";
import { Integer } from "@ratmath/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function systemLookup(name) {
    return { type: "identifier" };
}

function evalRix(code, context, systemContext) {
    const ctx = context || new Context();
    const registry = createDefaultRegistry();
    const sys = systemContext || createDefaultSystemContext();
    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry, sys);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Parser: SystemObject and SystemAccess nodes
// ---------------------------------------------------------------------------

describe("Parser — SystemObject / SystemAccess", () => {
    function parseRix(code) {
        const tokens = tokenize(code);
        return parse(tokens, systemLookup);
    }

    test("bare dot produces SystemObject node", () => {
        const ast = parseRix(".");
        expect(ast[0].type).toBe("SystemObject");
    });

    test(".Name produces SystemAccess node", () => {
        const ast = parseRix(".PRINT");
        expect(ast[0].type).toBe("SystemAccess");
        expect(ast[0].property).toBe("PRINT");
    });

    test(".Name normalises case — .RAND_NAME and .rand_name differ by first letter", () => {
        const upper = parseRix(".RAND_NAME")[0];
        const lower_ = parseRix(".rand_name")[0];
        expect(upper.property).toBe("RAND_NAME"); // uppercase first → all upper
        expect(lower_.property).toBe("rand_name"); // lowercase first → all lower
    });

    test(".Name() produces SystemCall node (viaSystemContext)", () => {
        const ast = parseRix(".PRINT(42)");
        expect(ast[0].type).toBe("SystemCall");
        expect(ast[0].name).toBe("PRINT");
        expect(ast[0].viaSystemContext).toBe(true);
    });

    test("@+ produces SystemAccess { property: 'ADD' }", () => {
        const ast = parseRix("@+");
        expect(ast[0].type).toBe("SystemAccess");
        expect(ast[0].property).toBe("ADD");
    });

    test("@* produces SystemAccess { property: 'MUL' }", () => {
        const ast = parseRix("@*");
        expect(ast[0].type).toBe("SystemAccess");
        expect(ast[0].property).toBe("MUL");
    });
});

// ---------------------------------------------------------------------------
// Evaluator: SYS_CALL — calling stdlib via dot syntax
// ---------------------------------------------------------------------------

describe("Evaluator — .Name() system calls", () => {
    test(".RAND_NAME() returns a 10-char string", () => {
        const result = evalRix(".RAND_NAME();");
        expect(result.type).toBe("string");
        expect(result.value.length).toBe(10);
    });

    test(".RAND_NAME(5) returns a 5-char string", () => {
        const result = evalRix(".RAND_NAME(5);");
        expect(result.value.length).toBe(5);
    });

    test(".PRINT returns null/undefined (side-effect only)", () => {
        // Just ensure it doesn't throw
        expect(() => evalRix('.PRINT("hello");')).not.toThrow();
    });

    test("unknown capability throws a helpful error", () => {
        expect(() => evalRix(".NONEXISTENT();")).toThrow("Unknown system capability: NONEXISTENT");
    });

    test("bare RAND_NAME() is an error (no default identifiers)", () => {
        expect(() => evalRix("RAND_NAME();")).toThrow();
    });
});

// ---------------------------------------------------------------------------
// Evaluator: SYS_OBJ — bare dot returns a copy
// ---------------------------------------------------------------------------

describe("Evaluator — bare dot (SYS_OBJ)", () => {
    test(". returns a system_context value", () => {
        const result = evalRix(".");
        expect(result).toBeDefined();
        expect(result.type).toBe("system_context");
    });

    test(". returns a copy (mutable), original remains frozen", () => {
        const sys = createDefaultSystemContext(); // frozen by default
        const result = evalRix(".", new Context(), sys);
        expect(result.type).toBe("system_context");
        // Original still frozen
        expect(sys.frozen).toBe(true);
        // Copy is unfrozen (can be mutated by host)
        expect(result.context.frozen).toBe(false);
    });

    test("copy from . has same capabilities as original", () => {
        const sys = createDefaultSystemContext();
        const result = evalRix(".", new Context(), sys);
        const copy = result.context;
        expect(copy.has("RAND_NAME")).toBe(true);
        expect(copy.has("PRINT")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Evaluator: SYS_GET — .Name in non-call position (capability reference)
// ---------------------------------------------------------------------------

describe("Evaluator — .Name (SYS_GET)", () => {
    test(".ADD returns a sysref", () => {
        const result = evalRix(".ADD");
        expect(result.type).toBe("sysref");
        expect(result.name).toBe("ADD");
    });

    test(".freeze returns 1 when system is frozen", () => {
        const sys = createDefaultSystemContext(); // frozen
        const result = evalRix(".freeze", new Context(), sys);
        expect(result).toBe(1);
    });

    test(".freeze returns 0 when system is unfrozen", () => {
        const sys = createDefaultSystemContext({ frozen: false });
        const result = evalRix(".freeze", new Context(), sys);
        expect(result).toBe(0);
    });

    test("@+ returns sysref to ADD", () => {
        const result = evalRix("@+");
        expect(result.type).toBe("sysref");
        expect(result.name).toBe("ADD");
    });

    test("@* returns sysref to MUL", () => {
        const result = evalRix("@*");
        expect(result.type).toBe("sysref");
        expect(result.name).toBe("MUL");
    });
});

// ---------------------------------------------------------------------------
// Operator alias via @+ as first-class function
// ---------------------------------------------------------------------------

describe("Operator aliases (@+ etc.) as first-class functions", () => {
    test("@+ used as function reference in variable", () => {
        const ctx = new Context();
        evalRix("Add = @+;", ctx);       // Capital-first so Add(x,y) is a call not implicit mul
        const result = evalRix("Add(10, 20);", ctx);
        expect(result.value).toBe(30n);
    });

    test("@* partial application — Double = @*(_1, 2)", () => {
        const ctx = new Context();
        evalRix("Double = @*(_1, 2);", ctx);
        const result = evalRix("Double(5);", ctx);
        expect(result.value).toBe(10n);
    });

    test("@+ and .ADD are equivalent", () => {
        const r1 = evalRix("@+");
        const r2 = evalRix(".ADD");
        expect(r1.type).toBe("sysref");
        expect(r2.type).toBe("sysref");
        expect(r1.name).toBe(r2.name);
    });
});

// ---------------------------------------------------------------------------
// SystemContext class: copy / withhold / with / freeze
// ---------------------------------------------------------------------------

describe("SystemContext class API", () => {
    test("copy() returns mutable clone with same capabilities", () => {
        const sys = createDefaultSystemContext();
        const copy = sys.copy();
        expect(copy.frozen).toBe(false);
        expect(copy.has("RAND_NAME")).toBe(true);
    });

    test("copy() is independent — adding to copy doesn't affect original", () => {
        const sys = createDefaultSystemContext();
        const copy = sys.copy();
        copy.register("CUSTOM", { impl: () => 42, doc: "test" });
        expect(copy.has("CUSTOM")).toBe(true);
        expect(sys.has("CUSTOM")).toBe(false);
    });

    test("withhold() returns frozen copy minus named capabilities", () => {
        const sys = createDefaultSystemContext();
        const restricted = sys.withhold("RAND_NAME", "PRINT");
        expect(restricted.frozen).toBe(true);
        expect(restricted.has("RAND_NAME")).toBe(false);
        expect(restricted.has("PRINT")).toBe(false);
        expect(restricted.has("LEN")).toBe(true); // others still present
    });

    test("with() returns frozen copy plus new capability", () => {
        const sys = createDefaultSystemContext();
        const extended = sys.with("ANSWER", { impl: () => 42, doc: "the answer" });
        expect(extended.frozen).toBe(true);
        expect(extended.has("ANSWER")).toBe(true);
        expect(extended.get("ANSWER").impl()).toBe(42);
    });

    test("freeze() prevents further mutation", () => {
        const sys = new SystemContext();
        sys.freeze();
        expect(() => sys.register("X", { impl: () => 1 })).toThrow("frozen");
        expect(() => sys.delete("X")).toThrow("frozen");
    });

    test("unfrozen context allows mutation", () => {
        const sys = createDefaultSystemContext({ frozen: false });
        expect(sys.frozen).toBe(false);
        expect(() => sys.register("CUSTOM", { impl: () => 99 })).not.toThrow();
        expect(sys.has("CUSTOM")).toBe(true);
    });

    test("getAllNames() returns sorted list", () => {
        const sys = createDefaultSystemContext();
        const names = sys.getAllNames();
        expect(Array.isArray(names)).toBe(true);
        expect(names).toContain("RAND_NAME");
        expect(names).toContain("ADD");
        // sorted
        for (let i = 1; i < names.length; i++) {
            expect(names[i] >= names[i - 1]).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// Sandboxing: restricted system contexts
// ---------------------------------------------------------------------------

describe("Sandboxing — restricted system contexts", () => {
    test("restricted context can't call withheld capability", () => {
        const sys = createDefaultSystemContext();
        const restricted = sys.withhold("RAND_NAME");
        expect(() => evalRix(".RAND_NAME();", new Context(), restricted))
            .toThrow("Unknown system capability: RAND_NAME");
    });

    test("restricted context can still call retained capabilities", () => {
        const sys = createDefaultSystemContext();
        const restricted = sys.withhold("RAND_NAME"); // only RAND_NAME removed
        const result = evalRix(".LEN([1, 2, 3]);", new Context(), restricted);
        expect(result.value).toBe(3n);
    });

    test("host can build custom context with added capability", () => {
        const sys = createDefaultSystemContext({ frozen: false });
        sys.register("ANSWER", { impl: () => new Integer(42n) });
        sys.freeze();
        const result = evalRix(".ANSWER();", new Context(), sys);
        expect(result.value).toBe(42n);
    });

    test("full context works, restricted context blocks capability", () => {
        const sys = createDefaultSystemContext();
        const restricted = sys.withhold("PRINT");

        // Full context can call PRINT
        expect(() => evalRix('.PRINT("ok");', new Context(), sys)).not.toThrow();
        // Restricted cannot
        expect(() => evalRix('.PRINT("ok");', new Context(), restricted))
            .toThrow("Unknown system capability: PRINT");
    });
});
