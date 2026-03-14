import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { installSymbolicBindings } from "../src/functions/symbolic.js";
import { Context } from "../src/context.js";

function systemLookup(name) {
    return { type: "identifier", name };
}

function evalRix(code, context = null) {
    const ctx = context || new Context();
    installSymbolicBindings(ctx);
    const registry = createDefaultRegistry();
    const systemContext = createDefaultSystemContext();
    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry, systemContext);
    }
    return { result, context: ctx };
}

function mapEntry(mapValue, key) {
    expect(mapValue?.type).toBe("map");
    return mapValue.entries.get(key);
}

function tupleValues(value) {
    expect(value?.type).toBe("tuple");
    return value.values;
}

function stringValue(value) {
    if (typeof value === "string") return value;
    expect(value?.type).toBe("string");
    return value.value;
}

describe("System Spec Evaluation", () => {
    test("evaluating {# ... } returns a symbolic spec object", () => {
        const { result } = evalRix("{#x,y,z:p# p = x^2 * y + z };");
        expect(stringValue(mapEntry(result, "kind"))).toBe("systemSpec");
        expect(tupleValues(mapEntry(result, "inputs")).map(stringValue)).toEqual(["x", "y", "z"]);
        expect(tupleValues(mapEntry(result, "outputs")).map(stringValue)).toEqual(["p"]);

        const statements = tupleValues(mapEntry(result, "statements"));
        expect(statements).toHaveLength(1);
        expect(stringValue(mapEntry(statements[0], "kind"))).toBe("assign");
        expect(stringValue(mapEntry(statements[0], "target"))).toBe("p");

        const expr = mapEntry(statements[0], "expr");
        expect(stringValue(mapEntry(expr, "kind"))).toBe("binary");
        expect(stringValue(mapEntry(expr, "op"))).toBe("+");
    });

    test("system specs do not perform runtime assignment while being created", () => {
        const ctx = new Context();
        installSymbolicBindings(ctx);
        evalRix("x = 5; {#p# p = x + 1 };", ctx);
        expect(ctx.get("p")).toBeUndefined();
        expect(ctx.get("x").value).toBe(5n);
    });

    test("outer references are preserved symbolically", () => {
        const { result } = evalRix("{#x:p# p = @scale * x };");
        const expr = mapEntry(tupleValues(mapEntry(result, "statements"))[0], "expr");
        expect(stringValue(mapEntry(expr, "kind"))).toBe("binary");
        const left = mapEntry(expr, "left");
        expect(stringValue(mapEntry(left, "kind"))).toBe("outer");
        expect(stringValue(mapEntry(left, "name"))).toBe("scale");
    });

    test("Poly can consume a single-output polynomial spec", () => {
        const { result } = evalRix("P = {#x,y,z:p# p = x^2 * y + z } |> Poly; P(2,3,4);");
        expect(result.value).toBe(16n);
    });

    test("Deriv returns another spec consumable by Poly", () => {
        const { result } = evalRix(`
            S = {#x,y,z:p# p = x^2 * y + z };
            D = Deriv(S, "x");
            P = Poly(S);
            Px = Poly(D);
            {: P(2,3,4), Px(2,3,4) };
        `);
        expect(result.type).toBe("tuple");
        expect(result.values[0].value).toBe(16n);
        expect(result.values[1].value).toBe(12n);
    });

    test("Poly errors clearly on unsupported symbolic nodes", () => {
        expect(() => evalRix("P = {#x:p# p = .ADD(x, 1) } |> Poly; P(2);")).toThrow(/Poly does not support symbolic node kind 'call'/);
    });
});
