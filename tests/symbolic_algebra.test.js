import { test, expect } from "bun:test";
import { parseAndEvaluate } from "../src/evaluator.js";
import { Integer, Rational, RationalInterval } from "@ratmath/core";

function evalRiX(code) {
    return parseAndEvaluate(code);
}

test("Symbolic Algebra: Set Operations", () => {
    // Union (\\/ in JS string for \/ in RiX)
    const u = evalRiX("{| 1, 2 |} \\/ {| 2, 3 |}");
    expect(u.type).toBe("set");
    expect(u.values.length).toBe(3);

    // Intersection (/\\ in RiX, so /\\\\ in JS string)
    const i = evalRiX("{| 1, 2 |} /\\ {| 2, 3 |}");
    expect(i.type).toBe("set");
    expect(i.values.length).toBe(1);
    expect(i.values[0].toString()).toBe("2");

    // Difference (\ in RiX, so \\ in JS string)
    const d = evalRiX("{| 1, 2, 3 |} \\ {| 2 |}");
    expect(d.type).toBe("set");
    expect(d.values.length).toBe(2);

    // Symmetric Difference
    const sd = evalRiX("{| 1, 2 |} <> {| 2, 3 |}");
    expect(sd.type).toBe("set");
    expect(sd.values.length).toBe(2);
});

test("Symbolic Algebra: Interval Operations", () => {
    // Hull
    const h = evalRiX("1:5 \\/ 3:10");
    expect(h instanceof RationalInterval).toBe(true);
    expect(h.start.toString()).toBe("1");
    expect(h.end.toString()).toBe("10");

    // Intersect
    const i = evalRiX("1:5 /\\ 3:10");
    expect(i instanceof RationalInterval).toBe(true);
    expect(i.start.toString()).toBe("3");
    expect(i.end.toString()).toBe("5");

    // Non-intersect
    const ni = evalRiX("1:5 /\\ 6:10");
    expect(ni).toBe(null);
});

test("Symbolic Algebra: Membership", () => {
    expect(evalRiX("5 ? 1:10")).not.toBe(null);
    expect(evalRiX("15 ? 1:10")).toBe(null);

    expect(evalRiX("5 ? {| 1, 5, 10 |}")).not.toBe(null);
    expect(evalRiX("7 ? {| 1, 5, 10 |}")).toBe(null);

    expect(evalRiX("5 !? 1:10")).toBe(null);
    expect(evalRiX("15 !? 1:10")).not.toBe(null);
});

test("Symbolic Algebra: Intersects", () => {
    expect(evalRiX("1:5 ?& 3:10")).not.toBe(null);
    expect(evalRiX("1:5 ?& 6:10")).toBe(null);
});

test("Symbolic Algebra: Cartesian Product", () => {
    const p = evalRiX("{| 1, 2 |} ** {| \"a\", \"b\" |}");
    expect(p.type).toBe("set");
    expect(p.values.length).toBe(4);
});

test("Symbolic Algebra: Concatenation", () => {
    const c1 = evalRiX("[1, 2] ++ [3, 4]");
    expect(c1.type).toBe("sequence");
    expect(c1.values.length).toBe(4);

    const c2 = evalRiX("\"abc\" ++ \"def\"");
    expect(c2.type).toBe("string");
    expect(c2.value).toBe("abcdef");

    const c3 = evalRiX("{= a=1 } ++ {= b=2 }");
    expect(c3.type).toBe("map");
    expect(c3.entries.size).toBe(2);
});

test("N-ary brace union/intersection", () => {
    const idU = evalRiX("{\\/ {| 1,2 |} }");
    expect(idU.type).toBe("set");
    expect(idU.values.map((v) => v.toString())).toEqual(["1", "2"]);

    const idI = evalRiX("{/\\ 2:8 }");
    expect(idI instanceof RationalInterval).toBe(true);
    expect(idI.start.toString()).toBe("2");
    expect(idI.end.toString()).toBe("8");

    const eU = evalRiX("{\\/ }");
    expect(eU.type).toBe("set");
    expect(eU.values).toEqual([]);

    const eI = evalRiX("{/\\ }");
    expect(eI.type).toBe("set");
    expect(eI.values).toEqual([]);

    const su = evalRiX("{\\/ {| 1 |}, {| 1,2 |}, {| 3 |} }");
    expect(su.type).toBe("set");
    expect(su.values.map((v) => v.toString())).toEqual(["1", "2", "3"]);

    const si = evalRiX("{/\\ {| 1,2,3 |}, {| 2,3,4 |}, {| 3,5 |} }");
    expect(si.type).toBe("set");
    expect(si.values.map((v) => v.toString())).toEqual(["3"]);

    const iu = evalRiX("{\\/ 2:3, 10:12, 4:5 }");
    expect(iu instanceof RationalInterval).toBe(true);
    expect(iu.start.toString()).toBe("2");
    expect(iu.end.toString()).toBe("12");

    const ii = evalRiX("{/\\ 2:8, 4:10, 1:5 }");
    expect(ii instanceof RationalInterval).toBe(true);
    expect(ii.start.toString()).toBe("4");
    expect(ii.end.toString()).toBe("5");

    const inull = evalRiX("{/\\ 2:3, 10:12, 4:5 }");
    expect(inull).toBe(null);
});

test("N-ary brace concat", () => {
    const idC = evalRiX("{++ [1,2] }");
    expect(idC.type).toBe("sequence");
    expect(idC.values.map((v) => v.toString())).toEqual(["1", "2"]);

    const c1 = evalRiX("{++ [1,2], [3], [4,5] }");
    expect(c1.type).toBe("sequence");
    expect(c1.values.map((v) => v.toString())).toEqual(["1", "2", "3", "4", "5"]);

    const c2 = evalRiX('{++ "ab", "cd", "ef" }');
    expect(c2.type).toBe("string");
    expect(c2.value).toBe("abcdef");

    const c3 = evalRiX("{++ {: 1,2}, {: 3} }");
    expect(c3.type).toBe("tuple");
    expect(c3.values.map((v) => v.toString())).toEqual(["1", "2", "3"]);

    const c4 = evalRiX("{++ {= a=3, b=7}, {= b=5, c=7}, {= b=8, d=4} }");
    expect(c4.type).toBe("map");
    expect(c4.entries.get("a").toString()).toBe("3");
    expect(c4.entries.get("b").toString()).toBe("8");
    expect(c4.entries.get("c").toString()).toBe("7");
    expect(c4.entries.get("d").toString()).toBe("4");
});

test("N-ary brace min/max", () => {
    const idMn = evalRiX("{<< 9 }");
    expect(idMn instanceof Integer).toBe(true);
    expect(idMn.value).toBe(9n);

    const idMx = evalRiX("{>> -5 }");
    expect(idMx instanceof Integer).toBe(true);
    expect(idMx.value).toBe(-5n);

    const nullSkipMin = evalRiX("{<< _, 5, _, 2 }");
    expect(nullSkipMin instanceof Integer).toBe(true);
    expect(nullSkipMin.value).toBe(2n);

    const nullSkipMax = evalRiX("{>> _, 5, _, 2 }");
    expect(nullSkipMax instanceof Integer).toBe(true);
    expect(nullSkipMax.value).toBe(5n);

    const mn = evalRiX("{<< 5, 2, 9, -3 }");
    expect(mn instanceof Integer).toBe(true);
    expect(mn.value).toBe(-3n);

    const mx = evalRiX("{>> 5, 2, 9, -3 }");
    expect(mx instanceof Integer).toBe(true);
    expect(mx.value).toBe(9n);
});

test("N-ary brace arity/type errors", () => {
    expect(() => evalRiX("{++ }")).toThrow(/NARY_CONCAT requires at least one argument/);
    expect(() => evalRiX("{<< }")).toThrow(/MIN requires at least one non-null comparable argument/);
    expect(() => evalRiX("{>> }")).toThrow(/MAX requires at least one non-null comparable argument/);
    expect(() => evalRiX("{<< _, _ }")).toThrow(/MIN requires at least one non-null comparable argument/);
    expect(() => evalRiX("{>> _, _ }")).toThrow(/MAX requires at least one non-null comparable argument/);
    expect(() => evalRiX("{\\/ {| 1 |}, 2:3 }")).toThrow(/NARY_UNION operands must all be sets or all be intervals/);
    expect(() => evalRiX("{/\\ {| 1 |}, 2:3 }")).toThrow(/NARY_INTERSECT operands must all be sets or all be intervals/);
});

test("Word Operators as Identifiers", () => {
    // AND, OR, NOT are now only accessible via dot syntax (system context)
    const r1 = evalRiX(".AND(1, 0)");
    expect(r1.toString()).toBe("0");

    const r2 = evalRiX(".NOT(_)");
    expect(r2).not.toBe(null);

    // Bare AND(1, 0) should now throw — system capabilities require dot syntax
    expect(() => evalRiX("AND(1, 0)")).toThrow();
});

test("Logic symbolic operators", () => {
    expect(evalRiX("1 && _")).toBe(null);
    expect(evalRiX("_ || 1")).not.toBe(null);
    expect(evalRiX("!_")).not.toBe(null);
});
