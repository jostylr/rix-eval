import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer, Rational } from "@ratmath/core";

function unbox(result) {
    if (result === null || result === undefined) return result;
    if (result && result.type === "string") return result.value;
    if (result && (result.type === "sequence" || result.type === "array" || result.type === "tuple")) {
        return result.values.map(unbox);
    }
    if (result && result.type === "map") {
        const out = {};
        for (const [k, v] of result.entries) out[k] = unbox(v);
        return out;
    }
    if (result && result.constructor && result.constructor.name === "Integer") return Number(result.value);
    if (result && result.constructor && result.constructor.name === "Rational") return Number(result.numerator) / Number(result.denominator);
    return result;
}

const defaultSystemContext = createDefaultSystemContext();

function evalRiX(code) {
    const ctx = new Context();
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens, () => ({ type: "identifier" }));
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry, defaultSystemContext);
    }
    return unbox(result);
}

describe("Arity-cap fn[n] — basic callable behavior", () => {
    test("Binary sysref capped at 2 ignores extra args", () => {
        // @+[2](1, 2, 3, 4) → ADD(1, 2) → 3  (extra args 3 and 4 are dropped)
        expect(evalRiX(`G := @+[2]; G(1, 2, 3, 4)`)).toBe(3);
    });

    test("Unary user function capped at 1 ignores extras", () => {
        // double capped at 1: only first arg forwarded
        expect(evalRiX(`double := (x) -> x * 2; G := double[1]; G(7, 8, 9)`)).toBe(14);
    });

    test("Zero-arity cap ignores all inputs", () => {
        // fn[0]: called with any args → called with none
        expect(evalRiX(`const_42 := () -> 42; G := const_42[0]; G(1, 2, 3)`)).toBe(42);
    });

    test("Fewer args than cap pass through unchanged", () => {
        // @+[2](5) → ADD(5) → 5  (only 1 arg, cap allows up to 2, no change)
        expect(evalRiX(`G := @+[2]; G(5)`)).toBe(5);
    });

    test("Cap applied directly in call expression", () => {
        // (@+)[2](1, 2, 3) → ADD(1, 2) → 3
        expect(evalRiX(`(@+)[2](1, 2, 3)`)).toBe(3);
    });

    test("Cap on lambda", () => {
        expect(evalRiX(`((x, y) -> x + y)[2](10, 20, 30)`)).toBe(30);
    });
});

describe("Arity-cap fn[n] — pipe convenience", () => {
    test("Reduce with bare sysref via cap (implicit init)", () => {
        // [1, 2, 3] |>: @+[2]  — reduce receives (acc, val, loc, src), cap drops loc+src
        expect(evalRiX(`[1, 2, 3] |>: @+[2]`)).toBe(6);
    });

    test("Reduce with bare sysref via cap (explicit init)", () => {
        expect(evalRiX(`[1, 2, 3] |:> 0 >: @+[2]`)).toBe(6);
    });

    test("Reduce product with cap", () => {
        expect(evalRiX(`[1, 2, 3, 4] |>: @*[2]`)).toBe(24);
    });

    test("Map with user function capped at 1", () => {
        // double capped at 1: locator and src are dropped from map callback
        expect(evalRiX(`double := (x) -> x * 2; [1, 2, 3] |>> double[1]`)).toEqual([2, 4, 6]);
    });

    test("Filter with user predicate capped at 1", () => {
        // isEven capped at 1: only value forwarded, locator/src ignored
        expect(evalRiX(`isEven := (x) -> x % 2 == 0; [1, 2, 3, 4] |>? isEven[1]`)).toEqual([2, 4]);
    });

    test("PALL with user predicate capped at 1", () => {
        expect(evalRiX(`isPos := (x) -> x > 0; [2, 4, 6] |>&& isPos[1]`)).toBe(6);
        expect(evalRiX(`isPos := (x) -> x > 0; [2, -1, 6] |>&& isPos[1]`)).toBe(null);
    });

    test("PANY with user predicate capped at 1", () => {
        expect(evalRiX(`isEven := (x) -> x % 2 == 0; [1, 3, 4] |>|| isEven[1]`)).toBe(4);
    });

    test("Map-on-map with user function capped at 1", () => {
        // Only value forwarded; key/src dropped
        const result = evalRiX(`double := (x) -> x * 2; {= a=2, b=3 } |>> double[1]`);
        expect(result).toEqual({ a: 4, b: 6 });
    });

    test("Filter-on-map with predicate capped at 1", () => {
        const result = evalRiX(`isPos := (x) -> x > 0; {= a=2, b=-1, c=5 } |>? isPos[1]`);
        expect(result).toEqual({ a: 2, c: 5 });
    });
});

describe("Arity-cap fn[n] — placeholder compatibility", () => {
    test("Placeholder callback @+(_1, _2) still works in reduce", () => {
        // Existing behavior must be preserved
        expect(evalRiX(`[1, 2, 3] |>: @+(_1, _2)`)).toBe(6);
    });

    test("Placeholder reorder still works independently", () => {
        expect(evalRiX(`[10, 20, 30] |>> @+(_1, _2)`)).toEqual([11, 22, 33]);
    });

    test("Capped sysref and placeholder produce same sum result", () => {
        const a = evalRiX(`[1, 2, 3, 4, 5] |>: @+[2]`);
        const b = evalRiX(`[1, 2, 3, 4, 5] |>: @+(_1, _2)`);
        expect(a).toBe(b);
    });
});

describe("Arity-cap fn[n] — nesting / composition", () => {
    test("Nested arity cap: outer cap wins (lower cap)", () => {
        // fn[3][2](1,2,3,4) → fn[2] effectively: first cap passes (a1,a2,a3), outer cap further reduces to (a1,a2)
        // @+[3][2](1,2,3,4) → @+[3] sees (1,2,3,4) → passes (1,2,3) → @+[2] inner ... wait
        // Actually: callWithConcreteArgs(arityCap(arityCap(@+,3),2), [1,2,3,4])
        //   → callWithConcreteArgs(arityCap(@+,3), [1,2]) → callWithConcreteArgs(@+, [1,2]) → 3
        expect(evalRiX(`G := @+[3][2]; G(1, 2, 3, 4)`)).toBe(3);
    });

    test("Nested arity cap: inner cap is tighter (inner wins)", () => {
        // @+[2][3](1,2,3,4) → outer cap passes (1,2,3) to @+[2] → @+[2] passes (1,2) → 3
        expect(evalRiX(`G := @+[2][3]; G(1, 2, 3, 4)`)).toBe(3);
    });

    test("Assign capped function to variable and call", () => {
        // Use uppercase name so it's treated as a callable, not implicit multiplication
        expect(evalRiX(`G := @+[2]; G(10, 20, 99, 99)`)).toBe(30);
    });
});

describe("Arity-cap fn[n] — guardrail / error cases", () => {
    test("Indexing a sequence still works (no regression)", () => {
        expect(evalRiX(`[10, 20, 30][2]`)).toBe(20);
    });

    test("Indexing a map still works (no regression)", () => {
        expect(evalRiX(`{= a=5, b=7 }["a"]`)).toBe(5);
    });

    test("Indexing a string still works (no regression)", () => {
        expect(evalRiX(`"abc"[2]`)).toBe("b");
    });

    test("Non-callable non-indexable type errors", () => {
        expect(() => evalRiX(`42[1]`)).toThrow();
    });

    test("Non-integer cap errors", () => {
        // String key on a callable → error
        expect(() => evalRiX(`@+["a"]`)).toThrow();
    });

    test("Negative cap errors", () => {
        expect(() => evalRiX(`@+[-1]`)).toThrow();
    });
});
