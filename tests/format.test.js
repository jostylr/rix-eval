import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { formatValue } from "../src/format.js";

function systemLookup(name) {
    const symbols = {
        F: { type: "identifier" },
    };
    return symbols[name] || { type: "identifier" };
}

const defaultSystemContext = createDefaultSystemContext();

function evalRix(code, context = new Context()) {
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

describe("formatValue callable previews", () => {
    test("named function includes name, params, prep, and body preview", () => {
        const ctx = new Context();
        evalRix("F(x, y) ?- [x < 0, y > 0] -> x + y;", ctx);
        const fn = evalRix("F;", ctx);
        const text = formatValue(fn);

        expect(text).toContain("Function F:");
        expect(text).toContain("(x, y)");
        expect(text).toContain("?- [x < 0, y > 0]");
        expect(text).toContain("-> x + y");
    });

    test("block body gets abbreviated preview", () => {
        const ctx = new Context();
        evalRix("F(x, y) -> { z = x + y; z *= 2; z };", ctx);
        const fn = evalRix("F;", ctx);
        const text = formatValue(fn);

        expect(text).toContain("Function F:");
        expect(text).toContain("{ z = x + y;");
        expect(text).toContain("z = z * 2");
    });

    test("named lambda variant shows its explicit variant name", () => {
        const value = evalRix("(x) /Rational/ -> x + 1;");
        const text = formatValue(value);

        expect(text).toContain("Lambda Rational:");
        expect(text).toContain("(x)");
        expect(text).toContain("-> x + 1");
    });

    test("multifunction preview shows variants instead of plain array formatting", () => {
        const ctx = new Context();
        const multifn = evalRix(`
            F = [
              (x) ?- [x > 0] /Pos/ -> x,
              (x) /Base/ -> -x
            ];
            F;
        `, ctx);
        const text = formatValue(multifn);

        expect(text).toContain("Multifunction F:");
        expect(text).toContain("/Pos/ (x) ?- [x > 0] -> x,");
        expect(text).toContain("/Base/ (x) -> -x,");
        expect(text).toContain("\n");
        expect(text.startsWith("[Multifunction")).toBe(true);
    });
});
