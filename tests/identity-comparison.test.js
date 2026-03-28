import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer } from "@ratmath/core";

const defaultSystemContext = createDefaultSystemContext();

function evalRiX(code, ctx) {
    const context = ctx || new Context();
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens, () => ({ type: "identifier" }));
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, context, registry, defaultSystemContext);
    }
    return result;
}

function unboxInt(v) {
    if (v && v.constructor && v.constructor.name === "Integer") return Number(v.value);
    return v;
}

// --- Comparison parsing ---

describe("Comparison parsing", () => {
    test("a == b works", () => {
        const result = evalRiX("x := 5; y := 5; x == y");
        expect(unboxInt(result)).toBe(1);
    });

    test("a === b works (same cell)", () => {
        const result = evalRiX("x := 5; y = x; x === y");
        expect(unboxInt(result)).toBe(1);
    });

    test("a ?= b as expression comparison is rejected", () => {
        expect(() => evalRiX("a := 5; b := 5; a ?= b")).toThrow(/not a comparison operator/);
    });

    test("a ?< b is rejected (no longer a valid token sequence)", () => {
        // ?< is no longer tokenized, so ? and < are separate tokens
        // This should fail in parsing or evaluation
        expect(() => evalRiX("a := 5; b := 3; a ?< b")).toThrow();
    });

    test("a ?> b is rejected", () => {
        expect(() => evalRiX("a := 5; b := 3; a ?> b")).toThrow();
    });

    test("a ?<= b is rejected", () => {
        expect(() => evalRiX("a := 5; b := 3; a ?<= b")).toThrow();
    });

    test("a ?>= b is rejected", () => {
        expect(() => evalRiX("a := 5; b := 3; a ?>= b")).toThrow();
    });
});

// --- Identity semantics ---

describe("Identity comparison (===)", () => {
    test("x := 5; y = x; x === y is truthy (alias shares cell)", () => {
        const result = evalRiX("x := 5; y = x; x === y");
        expect(unboxInt(result)).toBe(1);
    });

    test("x := 5; y := x; x == y is truthy (same value)", () => {
        const result = evalRiX("x := 5; y := x; x == y");
        expect(unboxInt(result)).toBe(1);
    });

    test("x := 5; y := x; x === y is null (different cells)", () => {
        const result = evalRiX("x := 5; y := x; x === y");
        expect(result).toBe(null);
    });

    test("mutable collection alias: xs := [1,2]; ys = xs; xs === ys is truthy", () => {
        const result = evalRiX("xs := [1,2]; ys = xs; xs === ys");
        expect(unboxInt(result)).toBe(1);
    });

    test("mutable collection copy: xs := [1,2]; ys := xs; xs === ys is null (different cells)", () => {
        const result = evalRiX("xs := [1,2]; ys := xs; xs === ys");
        expect(result).toBe(null);
    });

    test("=== with non-variable expressions returns null", () => {
        // Literal expressions don't have cells
        const result = evalRiX("5 === 5");
        expect(result).toBe(null);
    });
});

// --- Parameter defaults with ?= ---

describe("Parameter defaults (?=)", () => {
    test("F := (x ?= 2, a) -> a ^ x; F(, 7) -> 49", () => {
        const result = evalRiX("F := (x ?= 2, a) -> a ^ x; F(, 7)");
        expect(unboxInt(result)).toBe(49);
    });

    test("F(3, 7) -> 343", () => {
        const result = evalRiX("F := (x ?= 2, a) -> a ^ x; F(3, 7)");
        expect(unboxInt(result)).toBe(343);
    });

    test("F(0, 7) -> 1", () => {
        const result = evalRiX("F := (x ?= 2, a) -> a ^ x; F(0, 7)");
        expect(unboxInt(result)).toBe(1);
    });

    test("F(_, 7) fails — null is not a hole, so x=null, and _ ^ 7 errors", () => {
        expect(() => evalRiX("F := (x ?= 2, a) -> a ^ x; F(_, 7)")).toThrow();
    });

    test("F() fails for missing required a", () => {
        expect(() => evalRiX("F := (x ?= 2, a) -> a ^ x; F()")).toThrow();
    });

    test("F(, ) defaults x but still fails for missing required a", () => {
        // Both args are holes. x gets default 2, but a has no default so it's a hole.
        // a ^ x with a=hole should throw.
        expect(() => evalRiX("F := (x ?= 2, a) -> a ^ x; F(,)")).toThrow();
    });
});

// --- Expression-level hole coalescing ---

describe("Expression-level hole coalescing (?|)", () => {
    test("[1,,3][2] ?| 9 -> 9", () => {
        const result = evalRiX("[1,,3][2] ?| 9");
        expect(unboxInt(result)).toBe(9);
    });

    test("[1,,3][1] ?| 9 -> 1", () => {
        const result = evalRiX("[1,,3][1] ?| 9");
        expect(unboxInt(result)).toBe(1);
    });

    test("right side remains lazy", () => {
        const ctx = new Context();
        evalRiX("a := 5", ctx);
        // b is unbound; if right side were evaluated it would throw
        const result = evalRiX("a ?| b", ctx);
        expect(unboxInt(result)).toBe(5);
    });
});

// --- Regression tests ---

describe("Regression: := still behaves as fresh-copy assignment", () => {
    test(":= creates independent copy", () => {
        const ctx = new Context();
        evalRiX("x := 5; y := x; x ~= 10", ctx);
        const y = evalRiX("y", ctx);
        expect(unboxInt(y)).toBe(5); // y is independent from x
    });

    test("= creates alias (shared cell)", () => {
        const ctx = new Context();
        evalRiX("x := 5; y = x; x ~= 10", ctx);
        const y = evalRiX("y", ctx);
        expect(unboxInt(y)).toBe(10); // y shares cell with x
    });
});

describe("Regression: no accidental interaction between ?= and normal assignment", () => {
    test(":= still works normally", () => {
        const result = evalRiX("x := 42; x");
        expect(unboxInt(result)).toBe(42);
    });

    test("= still works normally", () => {
        const result = evalRiX("x := 42; y = x; y");
        expect(unboxInt(result)).toBe(42);
    });

    test("?= in expression context throws helpful error", () => {
        expect(() => evalRiX("5 ?= 5")).toThrow(/not a comparison operator/);
    });

    test("?= works only in parameter default position", () => {
        const result = evalRiX("F := (x ?= 10) -> x + 1; F()");
        expect(unboxInt(result)).toBe(11);
    });
});
