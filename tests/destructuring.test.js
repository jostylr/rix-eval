import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer, Rational } from "@ratmath/core";
import { isHole } from "../src/hole.js";

const defaultSystemContext = createDefaultSystemContext();

function evalRiX(code, ctx = new Context()) {
    const registry = createDefaultRegistry();
    const ast = parse(tokenize(code), () => ({ type: "identifier" }));
    const irNodes = lower(ast);
    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry, defaultSystemContext);
    }
    return { result, context: ctx };
}

function unbox(value) {
    if (value === null || value === undefined) return value;
    if (isHole(value)) return "__HOLE__";
    if (value instanceof Integer) return Number(value.value);
    if (value instanceof Rational) return `${value.numerator}/${value.denominator}`;
    if (value?.type === "string") return value.value;
    if (value?.type === "sequence" || value?.type === "tuple") {
        return value.values.map(unbox);
    }
    if (value?.type === "map") {
        return Object.fromEntries(Array.from(value.entries.entries(), ([k, v]) => [k, unbox(v)]));
    }
    return value;
}

describe("RiX destructuring assignment", () => {
    test("array destructuring binds holes and rest", () => {
        const { context } = evalRiX("[a, b, ...c] = [1, 2, 3, 4];");
        expect(unbox(context.get("a"))).toBe(1);
        expect(unbox(context.get("b"))).toBe(2);
        expect(unbox(context.get("c"))).toEqual([3, 4]);
    });

    test("array destructuring missing simple entry binds hole", () => {
        const { context } = evalRiX("[a, b] = [1];");
        expect(unbox(context.get("a"))).toBe(1);
        expect(unbox(context.get("b"))).toBe("__HOLE__");
    });

    test("nested array destructuring requires structure", () => {
        expect(() => evalRiX("[a, [b, c]] = [1];")).toThrow(/Missing required nested structure/);
    });

    test("tuple destructuring supports rest", () => {
        const { context } = evalRiX("{: a, b, ...c } = {: 1, 2, 3, 4 };");
        expect(unbox(context.get("a"))).toBe(1);
        expect(unbox(context.get("b"))).toBe(2);
        expect(unbox(context.get("c"))).toEqual([3, 4]);
    });

    test("map destructuring supports rename, nested extraction, and rest", () => {
        const { context } = evalRiX("{= pair[:a] = [x, y], b[:q], ...g } = {= a = [2, 3], q = 9, z = 10 };");
        expect(unbox(context.get("pair"))).toEqual([2, 3]);
        expect(unbox(context.get("x"))).toBe(2);
        expect(unbox(context.get("y"))).toBe(3);
        expect(unbox(context.get("b"))).toBe(9);
        expect(unbox(context.get("g"))).toEqual({ z: 10 });
    });

    test("map destructuring missing simple key binds hole", () => {
        const { context } = evalRiX("{= a, b } = {= a = 5 };");
        expect(unbox(context.get("a"))).toBe(5);
        expect(unbox(context.get("b"))).toBe("__HOLE__");
    });

    test("map destructuring missing nested key errors", () => {
        expect(() => evalRiX("{= a = [x, y] } = {= };")).toThrow(/Missing required nested structure/);
    });

    test("semantic target wrapper converts rational values", () => {
        const { context } = evalRiX("[{^ /::rational/ x}] = [2];");
        expect(context.get("x")).toBeInstanceOf(Rational);
        expect(unbox(context.get("x"))).toBe("2/1");
    });

    test("semantic target wrapper rejects impossible conversion", () => {
        expect(() => evalRiX('[{^ /::rational/ x}] = ["bad"];')).toThrow(/Cannot convert value to semantic type rational/);
    });

    test("trait-required targets check the source value", () => {
        expect(() => evalRiX('[{^ /:meters/ x}] = [2];')).toThrow(/Trait required by destructuring header not satisfied: meters/);
    });

    test("tensor destructuring checks shape", () => {
        const { context } = evalRiX("{:2x2: [a, b], [c, d]} = {:2x2: 1, 2; 3, 4};");
        expect(unbox(context.get("a"))).toBe(1);
        expect(unbox(context.get("d"))).toBe(4);
        expect(() => evalRiX("{:2x2: [a, b], [c, d]} = {:2x3: 1, 2, 3; 4, 5, 6};")).toThrow(/shape mismatch/);
    });
});
