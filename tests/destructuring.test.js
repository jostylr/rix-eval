import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer, Rational } from "@ratmath/core";
import { isHole } from "../src/hole.js";
import { forEachTensorCell, isTensor } from "../src/tensor.js";

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

function tensorFlat(value) {
    if (!isTensor(value)) {
        throw new Error("Expected tensor");
    }
    const flat = [];
    forEachTensorCell(value, (entry) => flat.push(unbox(entry)));
    return flat;
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

    test("indexed array destructuring performs overlapping extraction from the same source", () => {
        const { context } = evalRiX("{.. a[1:3], b[2:4], c[3], d[3] } = [10, 20, 30, 40, 50];");
        expect(unbox(context.get("a"))).toEqual([10, 20, 30]);
        expect(unbox(context.get("b"))).toEqual([20, 30, 40]);
        expect(unbox(context.get("c"))).toBe(30);
        expect(unbox(context.get("d"))).toBe(30);
    });

    test("indexed array alias syntax {=.. ...} works", () => {
        const { context } = evalRiX("{=.. b[1:2], c[-1:1]} = [1, 2, 3];");
        expect(unbox(context.get("b"))).toEqual([1, 2]);
        expect(unbox(context.get("c"))).toEqual([3, 2, 1]);
    });

    test("indexed nested destructuring can destructure a selected slice without binding the whole result", () => {
        const { context } = evalRiX("{.. [2:4] = [x, y, ...z] } = [10, 20, 30, 40, 50];");
        expect(unbox(context.get("x"))).toBe(20);
        expect(unbox(context.get("y"))).toBe(30);
        expect(unbox(context.get("z"))).toEqual([40]);
    });

    test("indexed nested destructuring can also preserve the whole extracted value", () => {
        const { context } = evalRiX("{.. d[-1:1] = [e, f, ...g] } = [1, 2, 3, 4];");
        expect(unbox(context.get("d"))).toEqual([4, 3, 2, 1]);
        expect(unbox(context.get("e"))).toBe(4);
        expect(unbox(context.get("f"))).toBe(3);
        expect(unbox(context.get("g"))).toEqual([2, 1]);
    });

    test("indexed tuple destructuring returns tuples for slices", () => {
        const { context } = evalRiX("{: a[1:2], b[3] } = {: 5, 6, 7, 8 };");
        expect(unbox(context.get("a"))).toEqual([5, 6]);
        expect(context.get("a")?.type).toBe("tuple");
        expect(unbox(context.get("b"))).toBe(7);
    });

    test("indexed tensor destructuring reuses ordinary tensor slicing rules", () => {
        const { context } = evalRiX("{.. row2[2, 1:3], block[1:2, 1:2] } = {:3x3: 1, 2, 3; 4, 5, 6; 7, 8, 9};");
        expect(tensorFlat(context.get("row2"))).toEqual([4, 5, 6]);
        expect(context.get("row2")?.type).toBe("tensor");
        expect(context.get("block")?.type).toBe("tensor");
    });

    test("tensor alias syntax {=:shape: ...} works", () => {
        const { context } = evalRiX("{=:2x3: row2[2,1:3]} = {:2x3: 1,2,3; 4,5,6};");
        expect(tensorFlat(context.get("row2"))).toEqual([4, 5, 6]);
    });

    test("indexed binding overrides still use ordinary assignment modes", () => {
        const ctx = new Context();
        evalRiX("arr := [[10, 20, 30, 40], [10, 20, 30, 40]];", ctx);
        evalRiX("{.. ==a[1], :=b[1], ~=c[1] } = arr;", ctx);
        evalRiX("arr[1][1] = 99;", ctx);
        expect(unbox(ctx.get("a"))).toEqual([99, 20, 30, 40]);
        expect(unbox(ctx.get("b"))).toEqual([10, 20, 30, 40]);
        expect(unbox(ctx.get("c"))).toEqual([10, 20, 30, 40]);
    });
});
