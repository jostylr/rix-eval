import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer, Rational } from "@ratmath/core";

function unbox(result) {
    if (result && result.type === "string") return result.value;
    if (result && (result.type === "sequence" || result.type === "array" || result.type === "tuple" || result.type === "set")) {
        return result.values.map(unbox);
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

describe("String Pipes & Code Points", () => {
    test("Strict Slice with emojis", () => {
        // "😀a😃" is length 3 in code points
        expect(evalRiX(`"😀a😃" |>/ 1:2`)).toBe("😀a");
        expect(evalRiX(`"😀a😃" |>/ 2:3`)).toBe("a😃");
        expect(evalRiX(`"😀a😃" |>// 0:10`)).toBe("😀a😃");
    });

    test("Reverse string with emojis", () => {
        expect(evalRiX(`"😀a😃" |><`)).toBe("😃a😀");
    });

    test("Map string code points", () => {
        // mapping each code point to itself
        expect(evalRiX(`"😀a😃" |>> (ch) -> ch`)).toBe("😀a😃");
        // mapping to something not a length-1 code point string yields array
        expect(evalRiX(`"😀a😃" |>> (ch) -> ch + ch`)).toEqual(["😀😀", "aa", "😃😃"]);
    });

    test("Filter string code points", () => {
        expect(evalRiX(`"😀a😃b" |>? (ch) -> ch != "a"`)).toBe("😀😃b");
    });

    test("Reduce string code points", () => {
        // no init
        expect(evalRiX(`"😀a😃" |>: (acc, ch) -> acc + ch`)).toBe("😀a😃"); // string concat
    });

    test("Sort string code points", () => {
        expect(evalRiX(`"cab" |<> _`)).toBe("abc");
        // with emojis, descending sort
        expect(evalRiX(`"b😀a😃" |<> (x, y) -> x < y ?? 1 ?: (x > y ?? -1 ?: 0)`)).toBe("😃😀ba");
        // fallback default code point sort is valid but simple JS sort might misalign surrogates if not split properly. Since we split by Array.from, the string parts are correct, but JS sort on string pieces is code unit wise.
    });

    test("PALL / PANY string", () => {
        expect(evalRiX(`"abc" |>&& (ch) -> ch != "z"`)).toBe("c");
        expect(evalRiX(`"abz" |>&& (ch) -> ch != "z"`)).toBe(null);
        expect(evalRiX(`"abc" |>|| (ch) -> ch == "b"`)).toBe("b");
    });
});

describe("Pipe SPLIT Operator |>/|", () => {
    test("String splitting with string delimiter", () => {
        expect(evalRiX(`"a,,b," |>/| ","`)).toEqual(["a", "", "b", ""]);
        expect(evalRiX(`"abc" |>/| ","`)).toEqual(["abc"]);
        expect(evalRiX(`" " |>? () -> _ |>/| ","`)).toEqual([""]);
        expect(evalRiX(`"😀,,😃," |>/| ","`)).toEqual(["😀", "", "😃", ""]);
    });

    test("String splitting with regex delimiter", () => {
        expect(evalRiX(`"a  b   c" |>/| {/\\s+/}`)).toEqual(["a", "b", "c"]);
        expect(evalRiX(`"  a" |>/| {/\\s+/}`)).toEqual(["", "a"]);
        expect(evalRiX(`"a  " |>/| {/\\s+/}`)).toEqual(["a", ""]);
    });

    test("String splitting with predicate", () => {
        expect(evalRiX(`"a  b   c" |>/| (ch) -> ch == " "`)).toEqual(["a", "b", "c"]);
        expect(evalRiX(`"  a" |>/| (ch) -> ch == " "`)).toEqual(["", "a"]);
        expect(evalRiX(`"a  " |>/| (ch) -> ch == " "`)).toEqual(["a", ""]);
        expect(evalRiX(`"  " |>/| (ch) -> ch == " "`)).toEqual(["", ""]);
        expect(evalRiX(`"ab" |>/| (ch) -> ch == " "`)).toEqual(["ab"]);
    });

    test("Array splitting", () => {
        expect(evalRiX(`[1, 0, 2, 5, 0, 0, 3] |>/| 0`)).toEqual([[1], [2, 5], [], [3]]);
        expect(evalRiX(`[0, 1] |>/| 0`)).toEqual([[], [1]]);
        expect(evalRiX(`[1, 0] |>/| 0`)).toEqual([[1], []]);
        expect(evalRiX(`[1, 2, 3] |>/| 0`)).toEqual([[1, 2, 3]]);
        expect(evalRiX(`[] |>/| 0`)).toEqual([[]]);
    });

    test("Array splitting with predicate", () => {
        expect(evalRiX(`[1, 2, 0, 0, 3, 0, 4] |>/| (x) -> x == 0`)).toEqual([[1, 2], [3], [4]]);
    });
});

describe("Pipe CHUNK Operator |>#|", () => {
    test("String chunking by integer", () => {
        expect(evalRiX(`"abcdef" |>#| 3`)).toEqual(["abc", "def"]);
        expect(evalRiX(`"abcd" |>#| 3`)).toEqual(["abc", "d"]);
        expect(evalRiX(`" " |>? () -> _ |>#| 3`)).toEqual([]);
    });

    test("Array chunking by integer", () => {
        expect(evalRiX(`[1, 2, 3, 4] |>#| 3`)).toEqual([[1, 2, 3], [4]]);
        expect(evalRiX(`[] |>#| 3`)).toEqual([]);
    });

    test("String chunking by predicate", () => {
        // Predicate now receives (val, locator, src); use locator (2nd param) for position-based chunking.
        expect(evalRiX(`"abcdef" |>#| (v, i) -> i % 3 == 0`)).toEqual(["abc", "def"]);
        expect(evalRiX(`"abcd" |>#| (v, i) -> i % 3 == 0`)).toEqual(["abc", "d"]);
    });

    test("Array chunking by predicate", () => {
        // Predicate now receives (val, locator, src); use locator (2nd param) for position-based chunking.
        expect(evalRiX(`[1, 2, 3, 4] |>#| (v, i) -> i % 3 == 0`)).toEqual([[1, 2, 3], [4]]);
        expect(evalRiX(`[1, 2, 3, 4] |>#| (v, i) -> i == 1`)).toEqual([[1], [2, 3, 4]]); // True at locator=1 means first chunk closed at len 1
    });
});
