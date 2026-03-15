import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer } from "@ratmath/core";

function systemLookup(name) {
    const symbols = {
        AND: { type: "operator", precedence: 40, associativity: "left", operatorType: "infix" },
        OR: { type: "operator", precedence: 30, associativity: "left", operatorType: "infix" },
        NOT: { type: "operator", precedence: 110, operatorType: "prefix" },
        F: { type: "identifier" },
        G: { type: "identifier" },
        ADD: { type: "identifier" },
        DOUBLE: { type: "identifier" },
    };
    return symbols[name] || { type: "identifier" };
}

const defaultSystemContext = createDefaultSystemContext();

function evalRix(code, context) {
    const ctx = context || new Context();
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);
    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry, defaultSystemContext);
    }
    return result;
}

function evalRixWithContext(code) {
    const ctx = new Context();
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);
    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry, defaultSystemContext);
    }
    return { result, context: ctx };
}

describe("Cell Assignment Semantics", () => {

    // ─── A. Basic rebinding / aliasing ───────────────────────────────

    describe("= (alias/rebind)", () => {
        test("= with variable rhs creates alias — both see mutations", () => {
            const result = evalRix("x := 5; y = x; x += 1; y;");
            expect(result.value).toBe(6n);
        });

        test("= with variable rhs — alias in same scope", () => {
            const { result, context } = evalRixWithContext("x := 5; y = x; x += 1;");
            expect(evalRix("x;", context).value).toBe(6n);
            expect(evalRix("y;", context).value).toBe(6n);
        });

        test("= with expression rhs creates fresh binding", () => {
            const result = evalRix("x := 5; y = x + 1; x += 1; y;");
            expect(result.value).toBe(6n); // y got x+1=6, x then becomes 6 too, but y is independent
        });

        test("= with expression rhs — x changes don't affect y", () => {
            const { result, context } = evalRixWithContext("x := 5; y = x + 0; x += 1;");
            expect(evalRix("x;", context).value).toBe(6n);
            expect(evalRix("y;", context).value).toBe(5n); // y is independent
        });

        test("= with literal rhs creates fresh binding", () => {
            const result = evalRix("x := 5; y = 10; x += 1; y;");
            expect(result.value).toBe(10n);
        });

        test("= rebinds — stops referencing old cell", () => {
            const result = evalRix("x := 5; y = x; y = 99; x;");
            expect(result.value).toBe(5n); // rebinding y doesn't affect x
        });
    });

    // ─── B. Fresh copy with := ───────────────────────────────────────

    describe(":= (fresh copy)", () => {
        test(":= creates independent copy", () => {
            const result = evalRix("x := 5; y := x; x += 1; y;");
            expect(result.value).toBe(5n);
        });

        test(":= with x changed — y stays", () => {
            const { result, context } = evalRixWithContext("x := 5; y := x; x += 1;");
            expect(evalRix("x;", context).value).toBe(6n);
            expect(evalRix("y;", context).value).toBe(5n);
        });

        test(":= copies array shallowly", () => {
            const result = evalRix("x := [1, 2, 3]; y := x; x[1] = 99; y[1];");
            expect(result.value).toBe(1n); // y has its own array
        });

        test(":= copies map shallowly", () => {
            const result = evalRix("x := {= a = 1, b = 2 }; y := x; x[:a] = 99; y[:a];");
            expect(result.value).toBe(1n);
        });

        test(":= copies all meta", () => {
            const result = evalRix(`
                x := [1,2];
                x.key = "alpha";
                x._spec = "orig";
                x.__units = "C";
                y := x;
                [y.key, y._spec, y.__units];
            `);
            expect(result.values[0].value).toBe("alpha");
            expect(result.values[1].value).toBe("orig");
            expect(result.values[2].value).toBe("C");
        });

        test(":= copy is independent from source meta changes", () => {
            const result = evalRix(`
                x := [1,2];
                x.__units = "C";
                y := x;
                x.__units = "F";
                y.__units;
            `);
            expect(result.value).toBe("C");
        });
    });

    // ─── C. ~= preserves cell identity for aliases ──────────────────

    describe("~= (in-place value replacement)", () => {
        test("~= updates value, aliases see change", () => {
            const result = evalRix("x := 5; y = x; x ~= 9; y;");
            expect(result.value).toBe(9n);
        });

        test("~= with undefined lhs creates fresh binding", () => {
            const result = evalRix("z ~= 42; z;");
            expect(result.value).toBe(42n);
        });

        test("~= shallow copies the rhs value", () => {
            const result = evalRix("a := [1,2]; b := [3,4]; x = a; a ~= b; a[1];");
            expect(result.value).toBe(3n);
        });
    });

    // ─── D. Ordinary meta preserved on ~= ────────────────────────────

    describe("~= meta: ordinary preserved", () => {
        test(".key survives ~=", () => {
            const result = evalRix(`
                t := [0];
                t.key = "temperature";
                t ~= [21];
                t.key;
            `);
            expect(result.value).toBe("temperature");
        });

        test(".mutable preserved on ~=", () => {
            const result = evalRix(`
                t := [0];
                t.mutable;
            `);
            // Arrays default to mutable=1
            expect(result.value).toBe(1n);
        });

        test("ordinary meta from rhs NOT copied to lhs on ~=", () => {
            const result = evalRix(`
                a := [1];
                a.key = "alpha";
                b := [2];
                b.key = "beta";
                a ~= b;
                a.key;
            `);
            expect(result.value).toBe("alpha"); // keeps lhs ordinary meta
        });
    });

    // ─── E. Ephemeral meta (_) replaced wholesale on ~= ─────────────

    describe("~= meta: ephemeral replaced wholesale", () => {
        test("lhs _spec removed when rhs lacks it", () => {
            const result = evalRix(`
                f := [0];
                f._spec = "old spec";
                f ~= 7;
                f._spec;
            `);
            expect(result).toBeNull();
        });

        test("lhs _spec replaced when rhs has it", () => {
            const result = evalRix(`
                f := [0];
                f._spec = "old";
                g := [0];
                g._spec = "new";
                f ~= g;
                f._spec;
            `);
            expect(result.value).toBe("new");
        });

        test("rhs _deriv copied even if lhs had no _deriv", () => {
            const result = evalRix(`
                a := [0];
                b := [0];
                b._deriv = "gradient";
                a ~= b;
                a._deriv;
            `);
            expect(result.value).toBe("gradient");
        });
    });

    // ─── F. Sticky meta (__) preserved unless overwritten on ~= ──────

    describe("~= meta: sticky preserved unless overwritten", () => {
        test("lhs __units preserved when rhs lacks it", () => {
            const result = evalRix(`
                t := [0];
                t.__units = "C";
                t ~= [21];
                t.__units;
            `);
            expect(result.value).toBe("C");
        });

        test("lhs __units overwritten when rhs supplies it", () => {
            const result = evalRix(`
                a := [0];
                a.__units = "C";
                b := [0];
                b.__units = "F";
                a ~= b;
                a.__units;
            `);
            expect(result.value).toBe("F");
        });

        test("multiple sticky keys — only overwritten ones change", () => {
            const result = evalRix(`
                a := [0];
                a.__units = "C";
                a.__format = "decimal";
                b := [0];
                b.__units = "F";
                a ~= b;
                [a.__units, a.__format];
            `);
            expect(result.values[0].value).toBe("F");
            expect(result.values[1].value).toBe("decimal");
        });
    });

    // ─── G. := copies all meta classes ───────────────────────────────

    describe(":= copies all meta", () => {
        test(":= copies ordinary, ephemeral, and sticky meta", () => {
            const result = evalRix(`
                x := [1,2];
                x.key = "alpha";
                x._spec = "orig";
                x.__units = "C";
                y := x;
                [y.key, y._spec, y.__units];
            `);
            expect(result.values[0].value).toBe("alpha");
            expect(result.values[1].value).toBe("orig");
            expect(result.values[2].value).toBe("C");
        });

        test(":= copy meta is independent from source", () => {
            const result = evalRix(`
                x := [1];
                x._spec = "orig";
                y := x;
                x._spec = "changed";
                y._spec;
            `);
            expect(result.value).toBe("orig");
        });
    });

    // ─── H. Deep copy behavior ───────────────────────────────────────

    describe("::= and ~~= (deep copy)", () => {
        test("::= deep copies nested arrays", () => {
            const result = evalRix(`
                inner := [10, 20];
                x := [inner, 2];
                y ::= x;
                inner[1] = 99;
                y[1][1];
            `);
            expect(result.value).toBe(10n); // deep copy, inner change doesn't affect y
        });

        test(":= shallow copies — inner mutation shared", () => {
            const result = evalRix(`
                inner := [10, 20];
                x := [inner, 2];
                y := x;
                inner[1] = 99;
                y[1][1];
            `);
            expect(result.value).toBe(99n); // shallow: inner is same reference
        });

        test("~~= deep updates with meta preservation", () => {
            const result = evalRix(`
                inner := [10, 20];
                a := [inner, 2];
                a.key = "data";
                a.__units = "m";

                newInner := [30, 40];
                b := [newInner, 3];
                b.__units = "km";

                a ~~= b;
                newInner[1] = 999;
                [a[1][1], a.key, a.__units];
            `);
            expect(result.values[0].value).toBe(30n); // deep copy, mutation doesn't affect
            expect(result.values[1].value).toBe("data"); // ordinary meta preserved
            expect(result.values[2].value).toBe("km"); // sticky overwritten by rhs
        });

        test("::= copies all meta deeply", () => {
            const result = evalRix(`
                x := [1];
                x.__units = "C";
                x._spec = "test";
                y ::= x;
                [y.__units, y._spec];
            `);
            expect(result.values[0].value).toBe("C");
            expect(result.values[1].value).toBe("test");
        });
    });

    // ─── I. Combo operators desugar to cell-preserving update ────────

    describe("combo operators (+=, *=, etc.)", () => {
        test("+= affects aliases", () => {
            const result = evalRix("x := 5; y = x; x += 1; y;");
            expect(result.value).toBe(6n);
        });

        test("*= affects aliases", () => {
            const result = evalRix("x := 3; y = x; x *= 2; y;");
            expect(result.value).toBe(6n);
        });

        test("-= affects aliases", () => {
            const result = evalRix("x := 10; y = x; x -= 3; y;");
            expect(result.value).toBe(7n);
        });

        test("/= affects aliases", () => {
            const result = evalRix("x := 10; y = x; x /= 2; y;");
            expect(result.value).toBe(5n);
        });

        test("^= affects aliases", () => {
            const result = evalRix("x := 2; y = x; x ^= 3; y;");
            expect(result.value).toBe(8n);
        });

        test("+= preserves ordinary meta", () => {
            const result = evalRix(`
                t := [0];
                t.key = "counter";
                t.__units = "count";
                t ~= 5;
                t += 1;
                [t, t.key, t.__units];
            `);
            expect(result.values[0].value).toBe(6n);
            expect(result.values[1].value).toBe("counter");
            expect(result.values[2].value).toBe("count");
        });

        test("combo op on outer variable writes through", () => {
            const result = evalRix("x := 10; {; <x=> x += 5; x };");
            expect(result.value).toBe(15n);
        });
    });

    // ─── J. Undefined lhs with ~= and ~~= ───────────────────────────

    describe("undefined lhs with ~= / ~~=", () => {
        test("~= on undefined creates fresh binding", () => {
            const result = evalRix("newVar ~= 42; newVar;");
            expect(result.value).toBe(42n);
        });

        test("~~= on undefined creates fresh binding", () => {
            const result = evalRix("newVar ~~= [1, 2, 3]; newVar[2];");
            expect(result.value).toBe(2n);
        });

        test("~= on undefined copies rhs meta (no old meta to preserve)", () => {
            const result = evalRix(`
                src := [1];
                src.__units = "C";
                src._spec = "temp";
                dst ~= src;
                [dst.__units, dst._spec];
            `);
            // With no old meta, all rhs meta is copied as-is
            expect(result.values[0].value).toBe("C");
            expect(result.values[1].value).toBe("temp");
        });
    });

    // ─── K. Locked / frozen / immutable interaction ──────────────────

    describe("locked meta property", () => {
        test("locked prevents ~=", () => {
            expect(() => evalRix(`
                x := [1];
                x.locked = 1;
                x ~= [2];
            `)).toThrow(/locked/i);
        });

        test("locked prevents ~~=", () => {
            expect(() => evalRix(`
                x := [1];
                x.locked = 1;
                x ~~= [2];
            `)).toThrow(/locked/i);
        });

        test("locked prevents +=", () => {
            expect(() => evalRix(`
                x := 5;
                x.locked = 1;
                x += 1;
            `)).toThrow(/locked/i);
        });

        test("locked allows = (rebind)", () => {
            const result = evalRix(`
                x := [1];
                x.locked = 1;
                x = [2];
                x[1];
            `);
            expect(result.value).toBe(2n);
        });

        test("locked allows := (fresh copy)", () => {
            const result = evalRix(`
                x := [1];
                x.locked = 1;
                x := [2];
                x[1];
            `);
            expect(result.value).toBe(2n);
        });

        test("locked allows meta changes", () => {
            const result = evalRix(`
                x := [1];
                x.locked = 1;
                x._spec = "test";
                x._spec;
            `);
            expect(result.value).toBe("test");
        });
    });

    describe("frozen interaction", () => {
        test("frozen prevents ~=", () => {
            expect(() => evalRix(`
                x := [1];
                x.frozen = 1;
                x ~= [2];
            `)).toThrow(/frozen/i);
        });

        test("frozen allows = (rebind)", () => {
            const result = evalRix(`
                x := [1];
                x.frozen = 1;
                x = [2];
                x[1];
            `);
            expect(result.value).toBe(2n);
        });
    });

    describe("immutable interaction", () => {
        test("immutable prevents ~=", () => {
            expect(() => evalRix(`
                x := [1];
                x.immutable = 1;
                x ~= [2];
            `)).toThrow(/immutable/i);
        });

        test("immutable allows = (rebind)", () => {
            const result = evalRix(`
                x := [1];
                x.immutable = 1;
                x = [2];
                x[1];
            `);
            expect(result.value).toBe(2n);
        });
    });

    // ─── Spec examples ──────────────────────────────────────────────

    describe("spec examples", () => {
        test("example 1: shared cell via =", () => {
            const { result, context } = evalRixWithContext("x := 5; y = x; x += 1;");
            expect(evalRix("x;", context).value).toBe(6n);
            expect(evalRix("y;", context).value).toBe(6n);
        });

        test("example 2: independent copy via :=", () => {
            const { result, context } = evalRixWithContext("x := 5; y := x; x += 1;");
            expect(evalRix("x;", context).value).toBe(6n);
            expect(evalRix("y;", context).value).toBe(5n);
        });

        test("example 3: ordinary meta survives, ephemeral does not", () => {
            const result = evalRix(`
                t := [0];
                t.key = "temperature";
                t.__units = "C";
                t._spec = "sensor formula";
                t ~= 21;
                [t.key, t.__units, t._spec];
            `);
            expect(result.values[0].value).toBe("temperature");
            expect(result.values[1].value).toBe("C");
            expect(result.values[2]).toBeNull(); // ephemeral cleared
        });

        test("example 4: sticky meta overwritten when rhs supplies it", () => {
            const result = evalRix(`
                a := [0];
                a.__units = "C";
                b := [0];
                b.__units = "F";
                a ~= b;
                a.__units;
            `);
            expect(result.value).toBe("F");
        });

        test("example 5: rhs ephemeral overwrite", () => {
            const result = evalRix(`
                f := [0];
                f._spec = "old spec";
                g := [0];
                g._spec = "new spec";
                f ~= g;
                f._spec;
            `);
            expect(result.value).toBe("new spec");
        });

        test("example 6: rhs ephemeral absence wipes lhs ephemeral", () => {
            const result = evalRix(`
                f := [0];
                f._spec = "old spec";
                f ~= 7;
                f._spec;
            `);
            expect(result).toBeNull();
        });

        test("example 7: := copies all meta independently", () => {
            const result = evalRix(`
                x := [1,2];
                x.key = "alpha";
                x._spec = "orig";
                x.__units = "C";
                y := x;
                x._spec = "changed";
                x.__units = "F";
                [y.key, y._spec, y.__units];
            `);
            expect(result.values[0].value).toBe("alpha");
            expect(result.values[1].value).toBe("orig");
            expect(result.values[2].value).toBe("C");
        });

        test("example 8: ::= deep copy vs := shallow copy", () => {
            // Shallow: inner mutation is shared
            const shallow = evalRix(`
                inner := [10, 20];
                x := [inner, 2];
                y := x;
                inner[1] = 99;
                y[1][1];
            `);
            expect(shallow.value).toBe(99n);

            // Deep: inner mutation is not shared
            const deep = evalRix(`
                inner := [10, 20];
                x := [inner, 2];
                y ::= x;
                inner[1] = 99;
                y[1][1];
            `);
            expect(deep.value).toBe(10n);
        });
    });

    // ─── Additional edge cases ───────────────────────────────────────

    describe("edge cases", () => {
        test("chained alias: z = y = x all share", () => {
            const result = evalRix("x := 5; y = x; z = y; x += 1; z;");
            expect(result.value).toBe(6n);
        });

        test(":= on Integer (immutable primitive) works", () => {
            const result = evalRix("x := 42; y := x; x += 1; y;");
            expect(result.value).toBe(42n);
        });

        test("~= on string value", () => {
            const result = evalRix(`
                s := "hello";
                s.key = "greeting";
                s ~= "world";
                [s, s.key];
            `);
            expect(result.values[0].value).toBe("world");
            expect(result.values[1].value).toBe("greeting");
        });

        test(":= breaks existing alias", () => {
            const result = evalRix("x := 5; y = x; y := 10; x += 1; y;");
            expect(result.value).toBe(10n); // y is independent after :=
        });

        test("map ~= preserves ordinary meta", () => {
            const result = evalRix(`
                m := {= a = 1 };
                m.key = "config";
                m ~= {= b = 2 };
                [m[:b], m.key];
            `);
            expect(result.values[0].value).toBe(2n);
            expect(result.values[1].value).toBe("config");
        });
    });
});
