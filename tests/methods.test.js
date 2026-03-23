import { describe, test, expect } from "bun:test";
import { Integer, Rational } from "@ratmath/core";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
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
    if (value instanceof Integer) return Number(value.value);
    if (value instanceof Rational) return `${value.numerator}/${value.denominator}`;
    if (value?.type === "string") return value.value;
    if (value?.type === "sequence" || value?.type === "tuple" || value?.type === "set") {
        return value.values.map(unbox);
    }
    if (value?.type === "map") {
        return Object.fromEntries(Array.from(value.entries.entries()).map(([key, entry]) => [key, unbox(entry)]));
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

describe("Built-in array methods", () => {
    test("read-only and paired array methods work without mutating the receiver", () => {
        const result = evalRiX("{: [1, 2, 2].Len(), [1, 2, 2].Includes(2), [1, 2, 2].IndexOf(2), [1, 2, 2].LastIndexOf(2), [1, 2, 2].Distinct(), [1, 2, 3].DropFirst(), [1, 2, 3].DropLast(), [1, [2, 3]].Flatten() }");
        expect(unbox(result)).toEqual([3, 1, 2, 3, [1, 2], [2, 3], [1, 2], [1, 2, 3]]);
    });

    test("mutating extractor and in-place array methods behave as documented", () => {
        const ctx = new Context();
        const popped = evalRiX("a := [1, 2, 3]; p := a.Pop!(); afterPop := a.Concat(); s := a.Shift!(); afterShift := a.Concat(); a.RemoveAt!(1); {: p, afterPop, s, afterShift, a }", ctx);
        expect(unbox(popped)).toEqual([3, [1, 2], 1, [2], ["__HOLE__"]]);

        const emptyPop = evalRiX("a := []; a.Pop!()", ctx);
        expect(isHole(emptyPop)).toBe(true);
    });

    test("array Reduce defaults to an empty mutable array ready for filling", () => {
        const result = evalRiX("[1, 2, 3].Reduce((acc, v) -> acc.Push!(v * 10))");
        expect(unbox(result)).toEqual([10, 20, 30]);
    });

    test("array higher-order methods use value, index, source", () => {
        const result = evalRiX("{: [1,2,3].Map((v, k) -> v + k), [1,2,3,4].Filter((v) -> v > 2), [1,2,3].Any((v) -> v == 2), [1,2,3].All((v) -> v > 0), [1,2,3,4].Count((v) -> v > 2), [1,2,3].Find((v) -> v == 2), [1,2,3].FindIndex((v) -> v == 2) }");
        expect(unbox(result)).toEqual([[2, 4, 6], [3, 4], 1, 1, 2, 2, 2]);
    });
});

describe("Built-in map methods", () => {
    test("map methods cover lookup, update, filtering, and reducers", () => {
        const result = evalRiX(`
            m := {= a=1, b=2 };
            {:
                m.Len(),
                m.Has("a"),
                m.Get("b"),
                m.Keys(),
                m.Entries(),
                m.MapValues((v, k) -> v * 10),
                m.Filter((v, k) -> k == "b"),
                m.ReduceKeys((acc, k, v) -> acc.Push!({: k, v }), []),
                m.Reduce((acc, v, k) -> acc.Set!(k, v + 1))
            }
        `);
        expect(unbox(result)).toEqual([
            2,
            1,
            2,
            ["a", "b"],
            [["a", 1], ["b", 2]],
            { a: 10, b: 20 },
            { b: 2 },
            [["a", 1], ["b", 2]],
            { a: 2, b: 3 },
        ]);
    });

    test("paired map mutations update the receiver and default missing values safely", () => {
        const result = evalRiX(`
            m := {= a=1 };
            m.Default!("a", 9);
            m.Default!("b", 2);
            m.Update!("a", (v) -> v + 4);
            m.Merge!({= c=7 });
            m.Remove!("b");
            m
        `);
        expect(unbox(result)).toEqual({ a: 5, c: 7 });
    });
});

describe("Built-in set methods", () => {
    test("set algebra methods are available as receiver-first methods", () => {
        const result = evalRiX(`
            s := {| 1, 2 |};
            {:
                s.Add(3),
                s.Union({| 2, 3 |}),
                s.Intersect({| 2, 3 |}),
                s.Diff({| 2 |}),
                s.SymDiff({| 2, 4 |}),
                s.SubsetOf({| 1, 2, 3 |}),
                s.SupersetOf({| 1 |}),
                s.Disjoint({| 3, 4 |}),
                s.Filter((v) -> v > 1),
                s.Count((v) -> v > 1)
            }
        `);
        expect(unbox(result)).toEqual([
            [1, 2, 3],
            [1, 2, 3],
            [2],
            [1],
            [1, 4],
            1,
            1,
            1,
            [2],
            1,
        ]);
    });

    test("set Reduce defaults to an empty mutable set", () => {
        const result = evalRiX('{| 1, 2, 2, 3 |}.Reduce((acc, v) -> acc.Add!(v * 10))');
        expect(unbox(result)).toEqual([10, 20, 30]);
    });
});

describe("Built-in string and tuple methods", () => {
    test("string methods cover indexing, transforms, and Reduce", () => {
        const result = evalRiX(`
            s := "  abca  ";
            sep := ",";
            {:
                s.Trim(),
                s.TrimStart(),
                s.TrimEnd(),
                "abc".Get(2),
                "abc".Slice(2),
                "abc".Includes("b"),
                "abc".StartsWith("a"),
                "abc".EndsWith("c"),
                "abca".IndexOf("a"),
                "abca".LastIndexOf("a"),
                "a,b,c".Split(sep),
                "abc".Upper(),
                "ABC".Lower(),
                "banana".Replace("na", "x"),
                "banana".ReplaceAll("na", "x"),
                "7".PadLeft(3, "0"),
                "7".PadRight(3, "0"),
                "ha".Repeat(3),
                "ab".Reduce((acc, ch) -> acc.Concat(ch.Upper()))
            }
        `);
        expect(unbox(result)).toEqual([
            "abca",
            "abca  ",
            "  abca",
            "b",
            "bc",
            1,
            1,
            1,
            1,
            4,
            ["a", "b", "c"],
            "ABC",
            "abc",
            "baxna",
            "baxx",
            "007",
            "700",
            "hahaha",
            "AB",
        ]);
    });

    test("tuple methods support slicing, setting, array conversion, and Reduce defaults", () => {
        const result = evalRiX(`
            t := {: 4, 5, 6 };
            {:
                t.Len(),
                t.First(),
                t.Last(),
                t.Slice(2),
                t.Set(2, 9),
                t.ToArray(),
                t.Reduce((acc, v, k) -> acc.Set(k, v * 2))
            }
        `);
        expect(unbox(result)).toEqual([3, 4, 6, [5, 6], [4, 9, 6], [4, 5, 6], [8, 10, 12]]);
    });
});

describe("Built-in tensor methods", () => {
    test("tensor shape and mapping methods work through method dispatch", () => {
        const result = evalRiX(`
            m := {:2x2: 1, 2; 3, 4 };
            {:
                m.Shape(),
                m.Rank(),
                m.Size(),
                m.Get(2, 1),
                m.Map((v, idx) -> v * idx[1]),
                m.Flatten(),
                m.Transpose(),
                m.Permute({: 2, 1 }),
                m.Reduce((acc, v, idx) -> acc.Set!(idx, v * 10))
            }
        `);
        const values = result.values;
        expect(unbox(values[0])).toEqual([2, 2]);
        expect(unbox(values[1])).toBe(2);
        expect(unbox(values[2])).toBe(4);
        expect(unbox(values[3])).toBe(3);
        expect(tensorSnapshot(values[4])).toEqual({ shape: [2, 2], flat: [1, 2, 6, 8] });
        expect(tensorSnapshot(values[5])).toEqual({ shape: [4], flat: [1, 2, 3, 4] });
        expect(tensorSnapshot(values[6])).toEqual({ shape: [2, 2], flat: [1, 3, 2, 4] });
        expect(tensorSnapshot(values[7])).toEqual({ shape: [2, 2], flat: [1, 3, 2, 4] });
        expect(tensorSnapshot(values[8])).toEqual({ shape: [2, 2], flat: [10, 20, 30, 40] });
    });

    test("tensor mutation and numeric methods cover Set!, Fill!, Sum, Mean, Dot, and MatMul", () => {
        const ctx = new Context();
        const result = evalRiX(`
            a := {:2x2: 1, 2; 3, 4 };
            a.Set!(1, 2, 9);
            a.Fill!(5);
            {:
                a,
                a.Sum(),
                a.Mean(),
                {:3: 1, 2, 3 }.Dot({:3: 4, 5, 6 }),
                {:2x3: 1, 2, 3; 4, 5, 6 }.MatMul({:3x2: 7, 8; 9, 10; 11, 12 })
            }
        `, ctx);
        const values = result.values;
        expect(tensorSnapshot(values[0])).toEqual({ shape: [2, 2], flat: [5, 5, 5, 5] });
        expect(unbox(values[1])).toBe(20);
        expect(unbox(values[2])).toBe(5);
        expect(unbox(values[3])).toBe(32);
        expect(tensorSnapshot(values[4])).toEqual({ shape: [2, 2], flat: [58, 64, 139, 154] });
    });
});
