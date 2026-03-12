import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { formatValue } from "../src/format.js";
import { isHole } from "../src/hole.js";
import { forEachTensorCell, isTensor } from "../src/tensor.js";

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

function unbox(value) {
    if (value === null || value === undefined) return value;
    if (isHole(value)) return "__HOLE__";
    if (value && value.type === "string") return value.value;
    if (value && (value.type === "sequence" || value.type === "array" || value.type === "tuple" || value.type === "set")) {
        return value.values.map(unbox);
    }
    if (value && value.constructor && value.constructor.name === "Integer") return Number(value.value);
    if (value && value.constructor && value.constructor.name === "Rational") {
        return Number(value.numerator) / Number(value.denominator);
    }
    return value;
}

function tensorSnapshot(tensor) {
    if (!isTensor(tensor)) {
        throw new Error("Expected a tensor");
    }

    const flat = [];
    forEachTensorCell(tensor, (value) => {
        flat.push(unbox(value));
    });

    return {
        shape: [...tensor.shape],
        flat,
    };
}

describe("Tensor literals and indexing", () => {
    test("tensor literal stores row-major flat data", () => {
        const result = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m");
        expect(tensorSnapshot(result)).toEqual({
            shape: [2, 3],
            flat: [1, 2, 3, 4, 5, 6],
        });
    });

    test("rank-3 tensor literal uses rows, columns, then depth slices", () => {
        const result = evalRiX("t := {:2x3x2: 1, 2, 3; 4, 5, 6 ;; 7, 8, 9; 10, 11, 12}; t");
        expect(tensorSnapshot(result)).toEqual({
            shape: [2, 3, 2],
            flat: [1, 7, 2, 8, 3, 9, 4, 10, 5, 11, 6, 12],
        });
    });

    test("rank-3 tensor formatting preserves rows, columns, then depth slices", () => {
        const result = evalRiX("t := {:2x3x2: 1, 2, 3; 4, 5, 6 ;; 7, 8, 9; 10, 11, 12}; t");
        expect(formatValue(result)).toBe("{:2x3x2: 1, 2, 3; 4, 5, 6 ;; 7, 8, 9; 10, 11, 12 }");
    });

    test("tensor scalar indexing uses 1-based indices", () => {
        const result = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m[2, 3]");
        expect(unbox(result)).toBe(6);
    });

    test("tensor indexing accepts a tuple locator", () => {
        const result = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; idx := (2, 3); m[idx]");
        expect(unbox(result)).toBe(6);
    });

    test("tensor slices return views with the sliced shape", () => {
        const row = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m[1, ::]");
        expect(tensorSnapshot(row)).toEqual({
            shape: [3],
            flat: [1, 2, 3],
        });

        const col = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m[::, 2]");
        expect(tensorSnapshot(col)).toEqual({
            shape: [2],
            flat: [2, 5],
        });
    });

    test("tensor slices support reverse endpoints and negative indices", () => {
        const result = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m[-1:1, ::]");
        expect(tensorSnapshot(result)).toEqual({
            shape: [2, 3],
            flat: [4, 5, 6, 1, 2, 3],
        });
    });

    test("tensor indexing is strict about bounds", () => {
        expect(() => evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m[3, 1]"))
            .toThrow("out of range");
    });

    test("tensor literal rejects a body whose row and column structure does not match the shape", () => {
        expect(() => evalRiX("t := {:2x3x2: 1, 2; 3, 4; 5, 6 ;; 7, 8; 9, 10; 11, 12}"))
            .toThrow("expects 3 columns per row");
    });
});

describe("Tensor views and assignment", () => {
    test("transpose produces a rank-2 tensor view", () => {
        const transposed = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m^^");
        expect(tensorSnapshot(transposed)).toEqual({
            shape: [3, 2],
            flat: [1, 4, 2, 5, 3, 6],
        });
    });

    test("transposed view reindexes elements correctly", () => {
        const result = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; mt := m^^; {: mt[1, 2], mt[2, 1] }");
        expect(unbox(result)).toEqual([4, 2]);
    });

    test("tensor scalar and slice assignment mutate the backing tensor", () => {
        const result = evalRiX("m := {:2x3:}; m[1, 2] = 9; m[::, 1] = 7; m");
        expect(tensorSnapshot(result)).toEqual({
            shape: [2, 3],
            flat: [7, 9, "__HOLE__", 7, "__HOLE__", "__HOLE__"],
        });
    });
});

describe("Tensor-aware pipes", () => {
    test("PMAP on an empty tensor can fill by index tuple", () => {
        const result = evalRiX("{:2x3:} |>> (v, idx) -> idx[1] * 10 + idx[2]");
        expect(tensorSnapshot(result)).toEqual({
            shape: [2, 3],
            flat: [11, 12, 13, 21, 22, 23],
        });
    });

    test("PFILTER on a tensor returns value/index tuples", () => {
        const result = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m |>? (v, idx) -> idx[2] == 2");
        expect(unbox(result)).toEqual([
            [2, [1, 2]],
            [5, [2, 2]],
        ]);
    });

    test("PREDUCE on a tensor receives index tuples", () => {
        const result = evalRiX("m := {:2x3: 1, 2, 3; 4, 5, 6}; m |:> 0 >: (acc, v, idx) -> acc + idx[1]");
        expect(unbox(result)).toBe(9);
    });

    test("zero-sized tensor mapping preserves the shape", () => {
        const result = evalRiX("{:0x3:} |>> (v, idx) -> 7");
        expect(tensorSnapshot(result)).toEqual({
            shape: [0, 3],
            flat: [],
        });
    });
});

describe("Tensor generation helper", () => {
    test(".TGEN builds a tensor from a shape tuple and index callback", () => {
        const result = evalRiX('.TGEN({: 2, 3 }, (idx) -> idx[1] * 10 + idx[2])');
        expect(tensorSnapshot(result)).toEqual({
            shape: [2, 3],
            flat: [11, 12, 13, 21, 22, 23],
        });
    });
});
