import { describe, expect, test } from "bun:test";
import { parseAndEvaluate } from "../src/evaluator.js";

describe("Slice Operations", () => {
    function evalExpr(input) {
        return parseAndEvaluate(input);
    }

    test("STRICT slice string", () => {
        const evalStr = (expr) => evalExpr(expr).value;
        expect(evalStr('"ABCDE" |>/ 2:4')).toBe("BCD");
        expect(evalStr('"ABCDE" |>/ 4:2')).toBe("DCB");
        expect(evalStr('"ABCDE" |>/ -1:2')).toBe("EDCB");
        expect(evalExpr('"ABCDE" |>/ 1:6')).toBeNull();
        expect(evalExpr('"ABCDE" |>/ 0:3')).toBeNull();
        expect(evalStr('"ABCDE" |>/ 2:2')).toBe("B");
        expect(evalExpr('"ABCDE" |>/ 2.3:4.7')).toBeNull();
        expect(evalExpr('"ABCDE" |>/ 2:4.3')).toBeNull();
        expect(evalExpr('"ABCDE" |>/ 2:3.7')).toBeNull();
    });

    test("STRICT slice array", () => {
        const res = evalExpr('[10, 20, 30, 40, 50] |>/ 2:4');
        expect(res.values.length).toBe(3);
        expect(res.values.map(v => Number(v.value || v))).toEqual([20, 30, 40]);

        const res2 = evalExpr('[10, 20, 30] |>/ 4:2');
        expect(res2).toBeNull();
    });

    test("STRICT slicing empty or null returns null", () => {
        expect(evalExpr('[] |>/ 1:1')).toBeNull();
        expect(evalExpr('_ |>/ 1:2')).toBeNull(); // _ is null
    });

    test("CLAMPED slice string", () => {
        const evalStr = (expr) => evalExpr(expr).value;
        expect(evalStr('"ABCDE" |>// 1:6')).toBe("ABCDE");
        expect(evalStr('"ABCDE" |>// -10:2')).toBe("AB");
        expect(evalStr('"ABCDE" |>// 10:2')).toBe("EDCB");
        expect(evalExpr('_ |>// 1:6').values).toEqual([]); // _ clamped slice is empty sequence
    });

    test("CLAMPED slice array", () => {
        const res = evalExpr('[10, 20, 30, 40, 50] |>// -10:2');
        expect(res.values.map(v => Number(v.value || v))).toEqual([10, 20]);

        const res2 = evalExpr('[] |>// 1:6');
        expect(res2.values).toEqual([]);

        const res3 = evalExpr('_ |>// 1:6');
        expect(res3.values).toEqual([]);
    });

    test("CLAMPED slice 0 logic", () => {
        const evalStr = (expr) => evalExpr(expr).value;
        // 0 with positive other
        expect(evalStr('"ABCDE" |>// 0:3')).toBe("ABC"); // 1:3
        // 0 with negative other
        expect(evalStr('"ABCDE" |>// 0:-2')).toBe("ED"); // -1:-2 -> 5..4
        expect(evalStr('"ABCDE" |>// -2:0')).toBe("DE"); // -2:-1 -> 4..5
        expect(evalStr('"ABCDE" |>// 6:0')).toBe("EDCBA"); // 6:1 -> 5..1 -> EDCBA
    });
});
