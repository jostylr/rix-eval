/**
 * Tests for locator-aware collection pipe callbacks and map pipe support.
 *
 * Goal 1: Every collection-traversing pipe passes (val, locator, src) to callbacks.
 *   - Sequences/strings: locator is 1-based Integer position
 *   - Maps: locator is the canonical key as a RiX string
 *
 * Goal 2: Maps are supported by |>>, |>?, |>&&, |>||, |>:, |:> init >: fn.
 *   Maps are NOT supported by |>/|, |>#|, |<>.
 */

import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer } from "@ratmath/core";

function systemLookup(name) {
    return { type: "identifier" };
}

const defaultSystemContext = createDefaultSystemContext();

function evalRiX(code, ctx) {
    const context = ctx || new Context();
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, context, registry, defaultSystemContext);
    }
    return result;
}

function unbox(result) {
    if (result === null || result === undefined) return null;
    if (result && result.type === "string") return result.value;
    if (result && result.constructor && result.constructor.name === "Integer") return Number(result.value);
    if (result && result.constructor && result.constructor.name === "Rational") return Number(result.numerator) / Number(result.denominator);
    if (result && (result.type === "sequence" || result.type === "array" || result.type === "tuple" || result.type === "set")) {
        return result.values.map(unbox);
    }
    if (result && result.type === "map" && result.entries instanceof Map) {
        const obj = {};
        for (const [k, v] of result.entries) {
            obj[k] = unbox(v);
        }
        return obj;
    }
    return result;
}

// ─── PMAP ────────────────────────────────────────────────────────────────────

describe("PMAP locator-aware callbacks", () => {
    test("Array map receives (val, locator, src) — build tuple of all three", () => {
        // [10,20,30] |>> (v,k,s) -> {: v, k, .LEN(s) }
        // Each element should produce a tuple of (value, 1-based-loc, length-of-src)
        const result = evalRiX(`[10, 20, 30] |>> (v, k, s) -> {: v, k, .LEN(s) }`);
        expect(result.type).toBe("sequence");
        expect(result.values.length).toBe(3);
        // First element: (10, 1, 3)
        expect(unbox(result.values[0])).toEqual([10, 1, 3]);
        // Second element: (20, 2, 3)
        expect(unbox(result.values[1])).toEqual([20, 2, 3]);
        // Third element: (30, 3, 3)
        expect(unbox(result.values[2])).toEqual([30, 3, 3]);
    });

    test("Array map — single-arg callback still works (backward compat)", () => {
        const result = evalRiX(`[1, 2, 3] |>> (x) -> x * 2`);
        expect(unbox(result)).toEqual([2, 4, 6]);
    });

    test("Array map — locator is 1-based integer", () => {
        // Build [locator] for each element to verify 1-based indices
        const result = evalRiX(`[10, 20, 30] |>> (v, k) -> k`);
        expect(result.type).toBe("sequence");
        expect(unbox(result.values[0])).toBe(1);
        expect(unbox(result.values[1])).toBe(2);
        expect(unbox(result.values[2])).toBe(3);
    });

    test("String map receives 1-based code point positions", () => {
        // Each char mapped to its 1-based position; result is not single-chars so returns array
        const result = evalRiX(`"abc" |>> (v, k) -> k`);
        expect(result.type).toBe("sequence");
        expect(unbox(result.values[0])).toBe(1);
        expect(unbox(result.values[1])).toBe(2);
        expect(unbox(result.values[2])).toBe(3);
    });

    test("String with emoji — positions are Unicode code point positions", () => {
        // "😀a😃" has 3 code points; indices should be 1, 2, 3
        const result = evalRiX(`"😀a😃" |>> (v, k) -> k`);
        expect(result.type).toBe("sequence");
        expect(unbox(result.values[0])).toBe(1);
        expect(unbox(result.values[1])).toBe(2);
        expect(unbox(result.values[2])).toBe(3);
    });
});

// ─── PMAP on maps ────────────────────────────────────────────────────────────

describe("PMAP on maps", () => {
    test("Transform values, preserve original keys", () => {
        const result = evalRiX(`{= a=2, b=3 } |>> (v, k) -> v * 10`);
        expect(result.type).toBe("map");
        const m = result.entries;
        expect(unbox(m.get("a"))).toBe(20);
        expect(unbox(m.get("b"))).toBe(30);
    });

    test("Callback can read the key", () => {
        // Map each value to its key string by returning k
        const result = evalRiX(`{= a=2, b=3 } |>> (v, k) -> k`);
        expect(result.type).toBe("map");
        expect(unbox(result.entries.get("a"))).toBe("a");
        expect(unbox(result.entries.get("b"))).toBe("b");
    });

    test("Callback can read the source map via src", () => {
        // s[k] should equal v — test that src is the original map
        const result = evalRiX(`{= a=5, b=9 } |>> (v, k, s) -> s[k] == v`);
        expect(result.type).toBe("map");
        // Every value should be 1 (truthy — the equality holds)
        for (const [, val] of result.entries) {
            expect(unbox(val)).toBe(1);
        }
    });

    test("Map |>> does not allow key replacement — return value becomes new value only", () => {
        // Even if callback does complex work, result map has same keys
        const result = evalRiX(`{= x=1, y=2 } |>> (v, k) -> v + 100`);
        expect(result.type).toBe("map");
        expect([...result.entries.keys()].sort()).toEqual(["x", "y"]);
        expect(unbox(result.entries.get("x"))).toBe(101);
        expect(unbox(result.entries.get("y"))).toBe(102);
    });

    test("Source map is not mutated by |>>", () => {
        const ctx = new Context();
        evalRiX(`m = {= a=1, b=2 }`, ctx);
        evalRiX(`m |>> (v) -> v * 99`, ctx);
        const m = evalRiX(`m`, ctx);
        expect(unbox(m.entries.get("a"))).toBe(1);
        expect(unbox(m.entries.get("b"))).toBe(2);
    });

    test("Map key as canonical string — integer key (1) becomes '1'", () => {
        const result = evalRiX(`{= (1)=2, (2)=3 } |>> (v, k) -> k`);
        expect(result.type).toBe("map");
        // keys should be "1" and "2" as RiX strings
        expect(unbox(result.entries.get("1"))).toBe("1");
        expect(unbox(result.entries.get("2"))).toBe("2");
    });
});

// ─── PFILTER ─────────────────────────────────────────────────────────────────

describe("PFILTER locator-aware callbacks", () => {
    test("Array filter by locator — keep even-indexed elements", () => {
        // [10,20,30,40] |>? (v,k) -> k % 2 == 0  → elements at positions 2 and 4
        const result = evalRiX(`[10, 20, 30, 40] |>? (v, k) -> k % 2 == 0`);
        expect(unbox(result)).toEqual([20, 40]);
    });

    test("Array filter — single-arg callback still works (backward compat)", () => {
        const result = evalRiX(`[1, 2, 3, 4] |>? (x) -> x % 2 == 0`);
        expect(unbox(result)).toEqual([2, 4]);
    });

    test("Map filter by value", () => {
        const result = evalRiX(`{= a=2, b=7, c=1 } |>? (v, k) -> v > 1`);
        expect(result.type).toBe("map");
        expect(result.entries.has("a")).toBe(true);
        expect(result.entries.has("b")).toBe(true);
        expect(result.entries.has("c")).toBe(false);
        expect(unbox(result.entries.get("a"))).toBe(2);
        expect(unbox(result.entries.get("b"))).toBe(7);
    });

    test("Map filter by key", () => {
        const result = evalRiX(`{= a=2, b=7, c=1 } |>? (v, k) -> k == "b"`);
        expect(result.type).toBe("map");
        expect(result.entries.size).toBe(1);
        expect(result.entries.has("b")).toBe(true);
        expect(unbox(result.entries.get("b"))).toBe(7);
    });

    test("Map filter — empty result is an empty map", () => {
        const result = evalRiX(`{= a=1, b=2 } |>? (v) -> v > 100`);
        expect(result.type).toBe("map");
        expect(result.entries.size).toBe(0);
    });
});

// ─── PALL ────────────────────────────────────────────────────────────────────

describe("PALL locator-aware callbacks", () => {
    test("Array all — uses locator in predicate", () => {
        // All positions are > 0 (positions are 1-based, always > 0)
        const result = evalRiX(`[10, 20, 30] |>&& (v, k) -> k > 0`);
        expect(unbox(result)).toBe(30); // last element
    });

    test("Array all — fails when predicate fails", () => {
        // Fail if locator > 2 — so the third element fails
        const result = evalRiX(`[10, 20, 30] |>&& (v, k) -> k <= 2`);
        expect(result).toBe(null);
    });

    test("Array all — single-arg callback still works (backward compat)", () => {
        const result = evalRiX(`[1, 2, 3] |>&& (x) -> x > 0`);
        expect(unbox(result)).toBe(3);
    });

    test("Map all — passes when all values meet predicate", () => {
        const result = evalRiX(`{= a=5, b=9 } |>&& (v) -> v > 0`);
        // Returns last value traversed (not null)
        expect(result).not.toBe(null);
    });

    test("Map all — fails when a value fails predicate", () => {
        const result = evalRiX(`{= a=5, b=9 } |>&& (v) -> v > 6`);
        // a=5 fails v > 6
        expect(result).toBe(null);
    });

    test("Map all — fails when predicate tests key", () => {
        const result = evalRiX(`{= a=5, b=9, c=2 } |>&& (v, k) -> k == "a"`);
        // Only "a" passes — short-circuits on "b"
        expect(result).toBe(null);
    });

    test("Map all — empty map returns null", () => {
        const result = evalRiX(`{= a=1 } |>? (v) -> v > 100 |>&& (v) -> v > 0`);
        expect(result).toBe(null);
    });
});

// ─── PANY ────────────────────────────────────────────────────────────────────

describe("PANY locator-aware callbacks", () => {
    test("Array any — uses locator in predicate", () => {
        // Find first element at position 2
        const result = evalRiX(`[10, 20, 30] |>|| (v, k) -> k == 2`);
        expect(unbox(result)).toBe(20);
    });

    test("Array any — returns null if none pass", () => {
        const result = evalRiX(`[1, 2, 3] |>|| (v) -> v > 10`);
        expect(result).toBe(null);
    });

    test("Array any — single-arg callback still works (backward compat)", () => {
        const result = evalRiX(`[1, 2, 3] |>|| (x) -> x == 2`);
        expect(unbox(result)).toBe(2);
    });

    test("Map any — returns first passing value", () => {
        const result = evalRiX(`{= a=2, b=7, c=1 } |>|| (v) -> v > 5`);
        expect(unbox(result)).toBe(7);
    });

    test("Map any — returns null if none pass", () => {
        const result = evalRiX(`{= a=2, b=3 } |>|| (v) -> v > 100`);
        expect(result).toBe(null);
    });

    test("Map any — can find by key", () => {
        const result = evalRiX(`{= a=2, b=7 } |>|| (v, k) -> k == "b"`);
        expect(unbox(result)).toBe(7);
    });
});

// ─── PREDUCE ─────────────────────────────────────────────────────────────────

describe("PREDUCE locator-aware callbacks", () => {
    test("Implicit-init reduce — callback receives (acc, val, locator, src)", () => {
        // Accumulate locators to verify they are 1-based
        // First element (val=10, loc=1) becomes acc; then:
        //   acc=10,  val=20, loc=2 -> acc = acc + loc = 10+2 = 12
        //   acc=12,  val=30, loc=3 -> acc = 12 + 3 = 15
        const result = evalRiX(`[10, 20, 30] |>: (acc, v, k) -> acc + k`);
        expect(unbox(result)).toBe(15); // 10 + 2 + 3
    });

    test("Explicit-init reduce — callback receives (acc, val, locator, src)", () => {
        // [1,2,3] |:> 0 >: (acc, v, k) -> acc + k   — sum of locators
        const result = evalRiX(`[1, 2, 3] |:> 0 >: (acc, v, k) -> acc + k`);
        expect(unbox(result)).toBe(6); // 0+1+2+3
    });

    test("Implicit-init — first element is initial accumulator (unchanged behavior)", () => {
        const result = evalRiX(`[1, 2, 3, 4] |>: (acc, v) -> acc + v`);
        expect(unbox(result)).toBe(10); // 1+2+3+4
    });

    test("Explicit-init — explicit initial value (unchanged behavior)", () => {
        const result = evalRiX(`[1, 2, 3] |:> 100 >: (acc, v) -> acc + v`);
        expect(unbox(result)).toBe(106); // 100+1+2+3
    });

    test("Two-arg reducer still works (backward compat)", () => {
        const result = evalRiX(`[1, 2, 3] |>: @+(_1, _2)`);
        expect(unbox(result)).toBe(6);
    });

    test("Map reduce — explicit init over values", () => {
        const result = evalRiX(`{= a=2, b=7 } |:> 0 >: (acc, v, k) -> acc + v`);
        expect(unbox(result)).toBe(9); // 0+2+7
    });

    test("Map reduce — reduce using keys (string concatenation)", () => {
        // Use single-char empty string init and concat keys
        const result = evalRiX(`{= a=2, b=7 } |:> "x" >: (acc, v, k) -> k`);
        // Last key wins when callback just returns k
        const val = unbox(result);
        expect(typeof val).toBe("string");
    });

    test("Map reduce — implicit-init uses first value as accumulator", () => {
        // With just one entry, should return that value unchanged
        const result = evalRiX(`{= x=42 } |>: (acc, v) -> acc + v`);
        expect(unbox(result)).toBe(42);
    });

    test("Map reduce — two-arg reducer still works (backward compat)", () => {
        const result = evalRiX(`{= a=3, b=4 } |:> 0 >: (acc, v) -> acc + v`);
        expect(unbox(result)).toBe(7);
    });
});

// ─── PSPLIT predicate ─────────────────────────────────────────────────────────

describe("PSPLIT predicate — locator-aware callbacks", () => {
    test("Predicate receives (val, locator, src) — split on even position", () => {
        // Split [1,2,3,4,5,6] at even positions (loc 2, 4, 6)
        const result = evalRiX(`[1, 2, 3, 4, 5, 6] |>/| (v, k) -> k % 2 == 0`);
        expect(unbox(result)).toEqual([[1], [3], [5], []]);
    });

    test("Predicate still works with value as first arg (backward compat)", () => {
        // Old-style: (x) -> x == 0 — still receives value as first arg
        const result = evalRiX(`[1, 2, 0, 0, 3, 0, 4] |>/| (x) -> x == 0`);
        expect(unbox(result)).toEqual([[1, 2], [3], [4]]);
    });

    test("Non-predicate split is unchanged", () => {
        const result = evalRiX(`[1, 0, 2, 5, 0, 0, 3] |>/| 0`);
        expect(unbox(result)).toEqual([[1], [2, 5], [], [3]]);
    });

    test("Map with PSPLIT throws an error", () => {
        expect(() => evalRiX(`{= a=1 } |>/| ","`) ).toThrow();
    });
});

// ─── PCHUNK predicate ─────────────────────────────────────────────────────────

describe("PCHUNK predicate — locator-aware callbacks", () => {
    test("Predicate receives (val, locator, src) — chunk by position", () => {
        // Boundary after every 3rd position (loc % 3 == 0)
        const result = evalRiX(`[1, 2, 3, 4, 5, 6] |>#| (v, k) -> k % 3 == 0`);
        expect(unbox(result)).toEqual([[1, 2, 3], [4, 5, 6]]);
    });

    test("Integer-size chunking is unchanged", () => {
        const result = evalRiX(`[1, 2, 3, 4] |>#| 3`);
        expect(unbox(result)).toEqual([[1, 2, 3], [4]]);
    });

    test("Map with PCHUNK throws an error", () => {
        expect(() => evalRiX(`{= a=1 } |>#| 2`)).toThrow();
    });
});

// ─── PSORT on maps ─────────────────────────────────────────────────────────────

describe("PSORT rejects maps", () => {
    test("Map with |<> throws an error", () => {
        expect(() => evalRiX(`{= a=1, b=2 } |<> (x, y) -> x - y`)).toThrow();
    });

    test("Sort comparator remains (a, b) — no locator args", () => {
        // Sort array descending — comparator only gets a, b
        const result = evalRiX(`[3, 1, 2] |<> (a, b) -> b - a`);
        expect(unbox(result)).toEqual([3, 2, 1]);
    });
});

// ─── Compatibility tests ──────────────────────────────────────────────────────

describe("Backward compatibility", () => {
    test("Partial @+(_1, 10) with |>> — extra locator/src args are appended but ignored", () => {
        const result = evalRiX(`[1, 2, 3] |>> @+(_1, 10)`);
        expect(unbox(result)).toEqual([11, 12, 13]);
    });

    test("Partial @+(_1, _2) with |>: — extra locator/src are appended but ignored", () => {
        const result = evalRiX(`[1, 2, 3] |>: @+(_1, _2)`);
        expect(unbox(result)).toBe(6);
    });

    test("One-arg lambda with |>> still works", () => {
        const result = evalRiX(`[1, 2, 3] |>> (x) -> x * x`);
        expect(unbox(result)).toEqual([1, 4, 9]);
    });

    test("One-arg lambda with |>? still works", () => {
        const result = evalRiX(`[1, 2, 3, 4] |>? (x) -> x % 2 == 0`);
        expect(unbox(result)).toEqual([2, 4]);
    });

    test("Two-arg reducer (acc, val) still works", () => {
        const result = evalRiX(`[1, 2, 3] |:> 0 >: (acc, v) -> acc + v`);
        expect(unbox(result)).toBe(6);
    });

    test("Sort comparator (a, b) still works — not affected by locator feature", () => {
        const result = evalRiX(`[3, 1, 2] |<> (a, b) -> a - b`);
        expect(unbox(result)).toEqual([1, 2, 3]);
    });
});

// ─── Negative / guardrail tests ────────────────────────────────────────────────

describe("Guardrail tests", () => {
    test("Map locator is key-based, not position-based", () => {
        // Use the key in a callback and verify it's a string key, not an integer position
        const result = evalRiX(`{= foo=1, bar=2 } |>> (v, k) -> k`);
        expect(result.type).toBe("map");
        // keys should still be "foo" and "bar"
        expect(unbox(result.entries.get("foo"))).toBe("foo");
        expect(unbox(result.entries.get("bar"))).toBe("bar");
    });

    test("Source collection passed to callback is the original, not a partial result", () => {
        // LEN(s) in callback should match original collection length throughout
        const ctx = new Context();
        const result = evalRiX(`[1, 2, 3] |>> (v, k, s) -> .LEN(s)`, ctx);
        // Every element should report LEN = 3 (the original collection)
        expect(unbox(result)).toEqual([3, 3, 3]);
    });

    test("Map |>> output is a new map — source unchanged", () => {
        const ctx = new Context();
        evalRiX(`original = {= a=1, b=2 }`, ctx);
        evalRiX(`mapped = original |>> (v) -> v * 100`, ctx);
        const orig = evalRiX(`original`, ctx);
        expect(unbox(orig.entries.get("a"))).toBe(1);
        expect(unbox(orig.entries.get("b"))).toBe(2);
    });

    test("Map any — locator is key string, not iteration index", () => {
        // If locator were a number, k == "a" would never pass
        const result = evalRiX(`{= a=10, b=20 } |>|| (v, k) -> k == "a"`);
        expect(unbox(result)).toBe(10); // value at key "a"
    });
});
