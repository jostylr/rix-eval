import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { HOLE, isHole } from "../src/hole.js";
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

function unboxSeq(v) {
    if (v && (v.type === "sequence" || v.type === "array")) {
        return v.values.map(item => isHole(item) ? HOLE : unboxInt(item));
    }
    return v;
}

// --- HOLE sentinel ---

describe("HOLE sentinel", () => {
    test("HOLE is a distinct object, not null or undefined", () => {
        expect(HOLE).not.toBe(null);
        expect(HOLE).not.toBe(undefined);
        expect(isHole(HOLE)).toBe(true);
        expect(isHole(null)).toBe(false);
        expect(isHole(undefined)).toBe(false);
        expect(isHole(0)).toBe(false);
    });
});

// --- Array hole syntax ---

describe("Array hole syntax [1,,3]", () => {
    test("[1,,3] has hole at index 2", () => {
        const result = evalRiX("[1,,3]");
        const vals = result.values;
        expect(unboxInt(vals[0])).toBe(1);
        expect(isHole(vals[1])).toBe(true);
        expect(unboxInt(vals[2])).toBe(3);
    });

    test("[,1] has leading hole", () => {
        const result = evalRiX("[,1]");
        const vals = result.values;
        expect(isHole(vals[0])).toBe(true);
        expect(unboxInt(vals[1])).toBe(1);
    });

    test("[1,] has trailing hole", () => {
        const result = evalRiX("[1,]");
        const vals = result.values;
        expect(unboxInt(vals[0])).toBe(1);
        expect(isHole(vals[1])).toBe(true);
    });

    test("[,] has two holes", () => {
        const result = evalRiX("[,]");
        const vals = result.values;
        expect(vals.length).toBe(2);
        expect(isHole(vals[0])).toBe(true);
        expect(isHole(vals[1])).toBe(true);
    });

    test("[,,] has three holes", () => {
        const result = evalRiX("[,,]");
        const vals = result.values;
        expect(vals.length).toBe(3);
        expect(isHole(vals[0])).toBe(true);
        expect(isHole(vals[1])).toBe(true);
        expect(isHole(vals[2])).toBe(true);
    });

    test("[1,,3][1] returns 1", () => {
        const result = evalRiX("[1,,3][1]");
        expect(unboxInt(result)).toBe(1);
    });

    test("[1,,3][2] returns HOLE", () => {
        const result = evalRiX("[1,,3][2]");
        expect(isHole(result)).toBe(true);
    });

    test("[1,,3][3] returns 3", () => {
        const result = evalRiX("[1,,3][3]");
        expect(unboxInt(result)).toBe(3);
    });
});

// --- ?| hole-coalescing operator ---

describe("?| hole-coalescing operator", () => {
    test("hole ?| 9 returns 9", () => {
        const result = evalRiX("a := [1,,3]; a[2] ?| 9");
        expect(unboxInt(result)).toBe(9);
    });

    test("non-hole ?| 9 returns the value", () => {
        const result = evalRiX("a := [1,,3]; a[1] ?| 9");
        expect(unboxInt(result)).toBe(1);
    });

    test("null ?| 9 returns null (null is not a hole)", () => {
        const result = evalRiX("_ ?| 9");
        expect(result).toBe(null);
    });

    test("chained ?|: first non-hole wins", () => {
        const result = evalRiX("a := [,,,4]; a[1] ?| a[2] ?| a[3] ?| a[4]");
        expect(unboxInt(result)).toBe(4);
    });

    test("?| is lazy — right side not evaluated when left is non-hole", () => {
        // b is unbound; if right side were evaluated it would throw
        const ctx = new Context();
        evalRiX("a := 5", ctx);
        const result = evalRiX("a ?| b", ctx);
        expect(unboxInt(result)).toBe(5);
    });
});

// --- Parameter defaults with ?| ---

describe("Parameter holeDefault (?|)", () => {
    test("F(,7) uses holeDefault for first param", () => {
        const result = evalRiX("F := (x ?| 2, a) -> a ^ x; F(,7)");
        expect(unboxInt(result)).toBe(49); // 7^2
    });

    test("F(3,7) uses explicit arg, ignores holeDefault", () => {
        const result = evalRiX("F := (x ?| 2, a) -> a ^ x; F(3,7)");
        expect(unboxInt(result)).toBe(343); // 7^3
    });

    test("F(,7) with no holeDefault passes HOLE through", () => {
        // x has no default, so passing hole yields hole in body
        const result = evalRiX("G := (x, a) -> x; G(,7)");
        expect(isHole(result)).toBe(true);
    });

    test("holeDefault does not apply for regular args", () => {
        // Passing 0 (not a hole) should use 0, not the holeDefault
        const result = evalRiX("F := (x ?| 2, a) -> a ^ x; F(0, 7)");
        expect(unboxInt(result)).toBe(1); // 7^0 = 1
    });
});

// --- Holes cause errors in standard ops ---

describe("Holes cause errors in standard operations", () => {
    test("[1,,3][2] + 1 throws", () => {
        expect(() => evalRiX("[1,,3][2] + 1")).toThrow("Cannot use undefined/hole");
    });

    test("1 + hole throws", () => {
        expect(() => evalRiX("a := [,,]; a[1] + 1")).toThrow("Cannot use undefined/hole");
    });

    test("hole used in multiplication throws", () => {
        expect(() => evalRiX("a := [,,]; a[1] * 2")).toThrow("Cannot use undefined/hole");
    });

    test("a + 1 where a is unbound throws Undefined variable", () => {
        expect(() => evalRiX("a + 1")).toThrow("Undefined variable");
    });

    test("[1,a,3] where a is unbound throws Undefined variable", () => {
        expect(() => evalRiX("[1,a,3]")).toThrow("Undefined variable");
    });
});

// --- Pipe with holes ---

describe("Pipes with holes", () => {
    test("[,,] |>> (x -> x ?| 0 + 1) maps holes to 1", () => {
        const result = evalRiX("[,,] |>> (x -> (x ?| 0) + 1)");
        const vals = result.values;
        expect(vals.length).toBe(3);
        expect(unboxInt(vals[0])).toBe(1);
        expect(unboxInt(vals[1])).toBe(1);
        expect(unboxInt(vals[2])).toBe(1);
    });

    test("[1,,3] |>: @+[2] throws on hole", () => {
        expect(() => evalRiX("[1,,3] |>: @+[2]")).toThrow();
    });
});

// --- Omitted call args ---

describe("Omitted call args in function calls", () => {
    test("F(,7) passes hole as first arg", () => {
        const result = evalRiX("F := (x ?| 2, a) -> a ^ x; F(,7)");
        expect(unboxInt(result)).toBe(49);
    });

    test("F(1,,3) passes hole as second arg", () => {
        const result = evalRiX("F := (a, b ?| 10, c) -> a + b + c; F(1,,3)");
        expect(unboxInt(result)).toBe(14); // 1 + 10 + 3
    });

    test("F(,) passes two holes", () => {
        const result = evalRiX("F := (a ?| 2, b ?| 3) -> a + b; F(,)");
        expect(unboxInt(result)).toBe(5); // 2 + 3
    });

    test("single-param lambda with holeDefault: (x ?| 2) -> 5 ^ x", () => {
        const result = evalRiX("F := (x ?| 2) -> 5 ^ x; F(,7)");
        expect(unboxInt(result)).toBe(25); // hole → x=2, 5^2
    });
});
