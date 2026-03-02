import { test, expect } from "bun:test";
import { parseAndEvaluate } from "../src/evaluator.js";
import { Integer, Rational, RationalInterval } from "@ratmath/core";

function evalRiX(code) {
    return parseAndEvaluate(code);
}

test("Symbolic Algebra: Set Operations", () => {
    // Union (\\/ in JS string for \/ in RiX)
    const u = evalRiX("{|1, 2|} \\/ {|2, 3|}");
    expect(u.type).toBe("set");
    expect(u.values.length).toBe(3);

    // Intersection (/\\ in RiX, so /\\\\ in JS string)
    const i = evalRiX("{|1, 2|} /\\ {|2, 3|}");
    expect(i.type).toBe("set");
    expect(i.values.length).toBe(1);
    expect(i.values[0].toString()).toBe("2");

    // Difference (\ in RiX, so \\ in JS string)
    const d = evalRiX("{|1, 2, 3|} \\ {|2|}");
    expect(d.type).toBe("set");
    expect(d.values.length).toBe(2);

    // Symmetric Difference
    const sd = evalRiX("{|1, 2|} <> {|2, 3|}");
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

    expect(evalRiX("5 ? {|1, 5, 10|}")).not.toBe(null);
    expect(evalRiX("7 ? {|1, 5, 10|}")).toBe(null);

    expect(evalRiX("5 !? 1:10")).toBe(null);
    expect(evalRiX("15 !? 1:10")).not.toBe(null);
});

test("Symbolic Algebra: Intersects", () => {
    expect(evalRiX("1:5 ?& 3:10")).not.toBe(null);
    expect(evalRiX("1:5 ?& 6:10")).toBe(null);
});

test("Symbolic Algebra: Cartesian Product", () => {
    const p = evalRiX("{|1, 2|} ** {| \"a\", \"b\" |}");
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

test("Word Operators as Identifiers", () => {
    // AND, OR, NOT should now be identifiers/functions
    const r1 = evalRiX("AND(1, 0)");
    expect(r1.toString()).toBe("0");

    const r2 = evalRiX("NOT(_)");
    expect(r2).not.toBe(null);

    // Since AND is an identifier, `1 AND 0` parses as `1 * AND(0)`.
    // It shouldn't work as infix. We check its actual output to reflect this behaviour.
    expect(evalRiX("1 AND 0").toString()).toBe("0");
});

test("Logic symbolic operators", () => {
    expect(evalRiX("1 && _")).toBe(null);
    expect(evalRiX("_ || 1")).not.toBe(null);
    expect(evalRiX("!_")).not.toBe(null);
});
