import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer } from "@ratmath/core";

function systemLookup(name) {
    const symbols = {
        ADD: { type: "identifier" },
        MUL: { type: "identifier" },
        SUB: { type: "identifier" },
        DIV: { type: "identifier" },
        F: { type: "identifier" },
        G: { type: "identifier" },
        H: { type: "identifier" },
    };
    return symbols[name] || { type: "identifier" };
}

function evalRix(code, context) {
    const ctx = context || new Context();
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry);
    }
    return result;
}

describe("Partial Functions and Placeholders", () => {
    test("basic doubling operator with @*", () => {
        const ctx = new Context();
        evalRix("Double = @*(_1, 2);", ctx);
        const result = evalRix("Double(3);", ctx);
        expect(result.value).toBe(6n);
    });

    test("swapping arguments with @-", () => {
        const result = evalRix("(@-(_2, _1))(10, 30);");
        // 30 - 10 = 20
        expect(result.value).toBe(20n);
    });

    test("reordering and duplication", () => {
        const result = evalRix("F(a, b, c) :-> a + b * c; G = F(_2, _1, _1); G(2, 5);");
        // G(2, 5) -> F(5, 2, 2) -> 5 + 2 * 2 = 9
        expect(result.value).toBe(9n);
    });

    test("excess arguments in usual slots", () => {
        const result = evalRix("F(a, b, c) :-> a + b + c; G = F(_2, _1); G(10, 20, 30);");
        // G(10, 20, 30) -> F(20, 10, 30) -> 20 + 10 + 30 = 60
        expect(result.value).toBe(60n);
    });

    test("partial application in mapping |>>", () => {
        const result = evalRix("[1, 2, 3] |>> @+(_1, 10);");
        expect(result.type).toBe("sequence");
        expect(result.values[0].value).toBe(11n);
        expect(result.values[1].value).toBe(12n);
        expect(result.values[2].value).toBe(13n);
    });

    test("partial application in filtering |>?", () => {
        const result = evalRix("[-5, 2, -10, 7] |>? @>( _1, 0);");
        expect(result.type).toBe("sequence");
        expect(result.values.length).toBe(2);
        expect(result.values[0].value).toBe(2n);
        expect(result.values[1].value).toBe(7n);
    });

    test("swapped predicate in filtering", () => {
        // Find numbers where 0 > x (i.e. x < 0)
        const result = evalRix("[-5, 2, -10, 7] |>? @>(0, _1);");
        expect(result.values.length).toBe(2);
        expect(result.values[0].value).toBe(-5n);
        expect(result.values[1].value).toBe(-10n);
    });

    test("nested partial construction in closure", () => {
        const ctx = new Context();
        evalRix("H = (x) -> @*(_1, x);", ctx);
        const result = evalRix("H(3)(4);", ctx);
        // H(3) returns partial @*(_1, 3).
        // Calling it with 4 -> @*(4, 3) -> 12.
        expect(result.value).toBe(12n);
    });

    test("placeholder in user function partial", () => {
        const result = evalRix("Rect(w, h) :-> w * h; Area3 = Rect(_1, 3); Area3(10);");
        expect(result.value).toBe(30n);
    });

    test("calling a partial with another placeholder (nested partials)", () => {
        const ctx = new Context();
        evalRix("F = @+(_1, _2);", ctx); // F is partial ADD(_1, _2)
        evalRix("G = F(_1, 10);", ctx);   // G is partial (partial ADD(_1, _2))(_1, 10) -> partial ADD(_1, 10)
        const result = evalRix("G(5);", ctx);
        expect(result.value).toBe(15n);
    });

    test("mapping with complex partial", () => {
        const code = `
            F(a, b, c) :-> a * b + c;
            [1, 2, 3] |>> F(10, _1, 5);
        `;
        const result = evalRix(code);
        // 10 * 1 + 5 = 15
        // 10 * 2 + 5 = 25
        // 10 * 3 + 5 = 35
        expect(result.values[0].value).toBe(15n);
        expect(result.values[1].value).toBe(25n);
        expect(result.values[2].value).toBe(35n);
    });
});
