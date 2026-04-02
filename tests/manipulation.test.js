import { describe, expect, test } from "bun:test";
import { parseAndEvaluate } from "../src/evaluator.js";

describe("Collection Manipulation (SWAP, MOVE) and Improved Slicing", () => {
    function evalExpr(input) {
        return parseAndEvaluate(input);
    }

    function toSimpleArray(seq) {
        if (!seq || !seq.values) return seq;
        return seq.values.map(v => {
            if (v === null || v === undefined) return v;
            if (v.__rix_hole__) return null;
            if (v && typeof v.value === 'bigint') return Number(v.value);
            if (v && v.type === "string") return v.value;
            if (typeof v === "number" || typeof v === "bigint") return Number(v);
            return v.value !== undefined ? v.value : v;
        });
    }

    test("Sequence slicing with interval literals (no spaces)", () => {
        const res1 = evalExpr('a := [10, 20, 30, 40, 50]; a[2:4]');
        expect(toSimpleArray(res1)).toEqual([20, 30, 40]);

        const res2 = evalExpr('a := [10, 20, 30, 40, 50]; a[4:2]');
        expect(toSimpleArray(res2)).toEqual([40, 30, 20]);

        const res3 = evalExpr('a := [10, 20, 30, 40, 50]; a[-2:-1]'); // 40, 50
        expect(toSimpleArray(res3)).toEqual([40, 50]);
    });

    test("SWAP! method", () => {
        const res = evalExpr('a := [10, 20, 30]; a.SWAP!(1, 3); a');
        expect(toSimpleArray(res)).toEqual([30, 20, 10]);
    });

    test("MOVE! with positive index (insert before)", () => {
        const res = evalExpr('a := [1, 2, 3, 4, 5, 6, 7]; a.MOVE!(4:6, 2); a');
        expect(toSimpleArray(res)).toEqual([1, 4, 5, 6, 2, 3, 7]);
    });

    test("MOVE! with negative index (insert after)", () => {
        const res1 = evalExpr('a := [1, 2, 3, 4]; a.MOVE!(1, -1); a');
        expect(toSimpleArray(res1)).toEqual([2, 3, 4, 1]);

        const res2 = evalExpr('b := [1, 2, 3, 4]; b.MOVE!(2, -2); b');
        expect(toSimpleArray(res2)).toEqual([1, 3, 2, 4]);
    });

    test("MOVE! boundary cases", () => {
        expect(toSimpleArray(evalExpr('a := [1, 2, 3]; a.MOVE!(3, 1); a'))).toEqual([3, 1, 2]);
        expect(toSimpleArray(evalExpr('a := [1, 2, 3]; a.MOVE!(1, -1); a'))).toEqual([2, 3, 1]);
        expect(toSimpleArray(evalExpr('a := [1, 2, 3]; a.MOVE!(2, 2); a'))).toEqual([1, 2, 3]);
    });

    test("MOVE! with holes", () => {
        const res = evalExpr('a := [1, , 2]; a.MOVE!(1, -1); a');
        const simple = toSimpleArray(res);
        expect(simple[0]).toBeNull();
        expect(simple[1]).toBe(2);
        expect(simple[2]).toBe(1);
    });

    test("Immutable MOVE and SWAP", () => {
        const res1 = evalExpr('a := [1, 2, 3]; b := a.MOVE(1, -1); [a, b]');
        const [a, b] = res1.values;
        expect(toSimpleArray(a)).toEqual([1, 2, 3]);
        expect(toSimpleArray(b)).toEqual([2, 3, 1]);

        const res2 = evalExpr('c := [10, 20]; d := c.SWAP(1, 2); [c, d]');
        const [c, d] = res2.values;
        expect(toSimpleArray(c)).toEqual([10, 20]);
        expect(toSimpleArray(d)).toEqual([20, 10]);
    });
});
