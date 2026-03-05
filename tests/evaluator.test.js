import { describe, test, expect, beforeEach } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer, Rational, BaseSystem } from "@ratmath/core";

function systemLookup(name) {
    const symbols = {
        SIN: { type: "function", arity: 1 },
        COS: { type: "function", arity: 1 },
        PI: { type: "constant" },
        E: { type: "constant" },
        AND: {
            type: "operator",
            precedence: 40,
            associativity: "left",
            operatorType: "infix",
        },
        OR: {
            type: "operator",
            precedence: 30,
            associativity: "left",
            operatorType: "infix",
        },
        NOT: { type: "operator", precedence: 110, operatorType: "prefix" },
        IF: { type: "identifier" },
        HELP: { type: "identifier" },
        LOAD: { type: "identifier" },
        F: { type: "identifier" },
        G: { type: "identifier" },
        ADD: { type: "identifier" },
        DOUBLE: { type: "identifier" },
        SQUARE: { type: "identifier" },
        ISPOSITIVE: { type: "identifier" },
    };
    return symbols[name] || { type: "identifier" };
}

function evalRix(code, context) {
    const ctx = context || new Context();
    const registry = createDefaultRegistry();
    const tokens = tokenize(code);
    const ast = parse(tokens, systemLookup);
    const irNodes = lower(ast);

    let result = null;
    for (const irNode of irNodes) {
        result = evaluate(irNode, ctx, registry);
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
        result = evaluate(irNode, ctx, registry);
    }
    return { result, context: ctx };
}

describe("RiX Evaluator", () => {
    describe("Literals", () => {
        beforeEach(() => {
            for (const p of ["A"]) BaseSystem.unregisterPrefix(p);
        });

        test("integer literal", () => {
            const result = evalRix("42;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(42n);
        });

        test("negative integer", () => {
            const result = evalRix("-7;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(-7n);
        });

        test("rational literal", () => {
            const result = evalRix("3/4;");
            expect(result).toBeInstanceOf(Rational);
            expect(result.numerator).toBe(3n);
            expect(result.denominator).toBe(4n);
        });

        test("hex literal", () => {
            const result = evalRix("0xFF;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(255n);
        });

        test("binary literal", () => {
            const result = evalRix("0b1010;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(10n);
        });

        test("string literal", () => {
            const result = evalRix('"hello";');
            expect(result.type).toBe("string");
            expect(result.value).toBe("hello");
        });

        test("null literal", () => {
            const result = evalRix("_;");
            expect(result).toBeNull();
        });

        test("uppercase prefixed quoted literal", () => {
            const ctx = new Context();
            evalRix('0A = "0123456789ABCDEF";', ctx);
            const result = evalRix('0A"4A.F";', ctx);
            expect(result).toBeInstanceOf(Rational);
            expect(result.toString()).toBe("1199/16");
        });

        test("prefixed continued fraction literal", () => {
            const result = evalRix("0b101.~11~10;");
            expect(result).toBeInstanceOf(Rational);
            expect(result.toString()).toBe("37/7");
        });

        test("explicit prefixed continued fraction literal", () => {
            const result = evalRix("~0b101.~11~10;");
            expect(result).toBeInstanceOf(Rational);
            expect(result.toString()).toBe("37/7");
        });

        test("radix shift allows grouped separators before _^", () => {
            const result = evalRix("1.234_4_^10;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(12344000000n);
        });
    });

    describe("Base conversion operators", () => {
        beforeEach(() => {
            for (const p of ["B", "O", "W", "Z"]) BaseSystem.unregisterPrefix(p);
        });

        test("define base prefix and format with _>", () => {
            const ctx = new Context();
            evalRix('0Z = "0123456789ABCDEF";', ctx);
            const result = evalRix("74 _> 0Z;", ctx);
            expect(result.type).toBe("string");
            expect(result.value).toBe("4A");
        });

        test("uppercase definitions do not conflict with lowercase builtins", () => {
            const ctx = new Context();
            const bRes = evalRix('0B = "01";', ctx);
            expect(bRes).toBeInstanceOf(Integer);
            expect(bRes.value).toBe(1n);
            const oRes = evalRix('0O = "01234567";', ctx);
            expect(oRes).toBeInstanceOf(Integer);
            expect(oRes.value).toBe(1n);
        });

        test("parse with <_", () => {
            const result = evalRix('"101" <_ 0b;');
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(5n);
        });

        test("mode aliases", () => {
            const mixed = evalRix('1.#3 _> "..";');
            expect(mixed.type).toBe("string");
            expect(mixed.value).toBe("1..1/3");

            const repeat = evalRix('4/3 _> ".";');
            expect(repeat.type).toBe("string");
            expect(repeat.value).toBe("1.#3");
        });

        test("radix and shifted modes group fractional digits", () => {
            const repeat = evalRix('1231234.2134213421 _> ".";');
            expect(repeat.type).toBe("string");
            expect(repeat.value).toContain("1_231_234.213_421_342_1");

            const shifted = evalRix('1231234.2134213421 _> "^";');
            expect(shifted.type).toBe("string");
            expect(shifted.value).toContain("1.231_234_213_421_342_1");
            expect(shifted.value).toMatch(/_\^6$/);
        });

        test("mode limits with .N and ^N", () => {
            const radixLimited = evalRix('1/97 _> ".50";');
            expect(radixLimited.type).toBe("string");
            expect(radixLimited.value).toContain("...");

            const shiftedLimited = evalRix('1/97 _> "^50";');
            expect(shiftedLimited.type).toBe("string");
            expect(shiftedLimited.value).toContain("...");
        });

        test("shifted output has a single radix point", () => {
            const shifted = evalRix('~12341234.~234324~123 _> "^";');
            expect(shifted.type).toBe("string");
            const mantissa = shifted.value.split("_^")[0].replace(/\.\.\./g, "");
            const radixPoints = Array.from(mantissa).filter((ch) => ch === ".").length;
            expect(radixPoints).toBe(1);
            expect(shifted.value).toContain("_^7");
        });

        test("tuple mode accepts named base prefix tokens", () => {
            const withBuiltin = evalRix('-9/7 _> (0b, "~");');
            expect(withBuiltin.type).toBe("string");
            expect(withBuiltin.value).toBe("~-10.~1~10~10");

            const ctx = new Context();
            evalRix('0W = "01";', ctx);
            const withCustom = evalRix('-9/7 _> (0W, "~");', ctx);
            expect(withCustom.type).toBe("string");
            expect(withCustom.value).toBe("~-10.~1~10~10");
        });
    });

    describe("Arithmetic", () => {
        test("addition: 2 + 3 = 5", () => {
            const result = evalRix("2 + 3;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(5n);
        });

        test("n-ary addition: {+ 1, 2, 3, 4} = 10", () => {
            const result = evalRix("{+ 1, 2, 3, 4};");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(10n);
        });


        test("subtraction: 10 - 4 = 6", () => {
            const result = evalRix("10 - 4;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(6n);
        });

        test("multiplication: 3 * 7 = 21", () => {
            const result = evalRix("3 * 7;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(21n);
        });

        test("n-ary multiplication: {* 2, 3, 4} = 24", () => {
            const result = evalRix("{* 2, 3, 4};");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(24n);
        });

        test("division: 10 / 3 = 10/3", () => {
            const result = evalRix("10 / 3;");
            expect(result).toBeInstanceOf(Rational);
            expect(result.numerator).toBe(10n);
            expect(result.denominator).toBe(3n);
        });

        test("division: 6 / 2 = 3", () => {
            const result = evalRix("6 / 2;");
            // Integer / Integer that divides evenly should be Integer or Rational(3,1)
            expect(Number(result.toString())).toBe(3);
        });

        test("exponentiation: 2 ^ 10 = 1024", () => {
            const result = evalRix("2 ^ 10;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1024n);
        });

        test("negation: -42", () => {
            const result = evalRix("-42;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(-42n);
        });

        test("precedence: 2 + 3 * 4 = 14", () => {
            const result = evalRix("2 + 3 * 4;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(14n);
        });

        test("modulo: 10 % 3 = 1", () => {
            const result = evalRix("10 % 3;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1n);
        });

        test("integer division: 10 // 3 = 3", () => {
            const result = evalRix("10 // 3;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(3n);
        });

        test("complex expression: (2 + 3) * (4 - 1) = 15", () => {
            const result = evalRix("(2 + 3) * (4 - 1);");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(15n);
        });
    });

    describe("Variables", () => {
        test("assign and retrieve", () => {
            const ctx = new Context();
            evalRix("x = 42;", ctx);
            const result = evalRix("x;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(42n);
        });

        test("assign expression result", () => {
            const ctx = new Context();
            evalRix("x = 2 + 3;", ctx);
            const result = evalRix("x;", ctx);
            expect(result.value).toBe(5n);
        });

        test("snake_case variable coexistence with _ as null", () => {
            const ctx = new Context();
            // _ is null, snake_case is a variable
            evalRix("my_var = 10;", ctx);
            evalRix("other_var = _;", ctx);
            const resultMy = evalRix("my_var;", ctx);
            const resultOther = evalRix("other_var;", ctx);
            const resultLiteral = evalRix("_;", ctx);

            expect(resultMy).toBeInstanceOf(Integer);
            expect(resultMy.value).toBe(10n);
            expect(resultOther).toBeNull();
            expect(resultLiteral).toBeNull();
        });

        test("@_ function alongside snake_case and _", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = `
                my_var = 5;
                val = @_ADD(my_var, 5);
                val;
            `;
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(10n);
        });

        test("multiple variables", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = "x = 10; y = 20; x + y;";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(30n);
        });

        test("reassignment", () => {
            const ctx = new Context();
            evalRix("x = 5;", ctx);
            evalRix("x = x + 1;", ctx);
            const result = evalRix("x;", ctx);
            expect(result.value).toBe(6n);
        });

        test("combo assignments", () => {
            const ctx = new Context();
            evalRix("x = 5;", ctx);
            evalRix("x += 3;", ctx);
            let result = evalRix("x;", ctx);
            expect(result.value).toBe(8n);

            evalRix("x *= 2;", ctx);
            result = evalRix("x;", ctx);
            expect(result.value).toBe(16n);
        });

        test("@ outer scope variable mutation", () => {
            const code = `
                times = 0;
                [1, 2, 3] |>> (x) -> {;
                    @times += 1;
                    x * 2;
                };
            `;
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            for (const ir of irNodes) {
                evaluate(ir, ctx, registry);
            }
            // `times` should be 3 because it was mutated in the outer scope
            const timesResult = evalRix("times;", ctx);
            expect(timesResult.value).toBe(3n);
        });

        test("@ outer scope assignment fails if not exist", () => {
            expect(() => evalRix("@nope = 5;")).toThrow("Cannot assign to outer variable '@nope'");
        });

        test("undefined variable throws", () => {
            expect(() => evalRix("undeclared;")).toThrow("Undefined variable");
        });
    });

    describe("Comparison", () => {
        test("3 > 2 = 1 (true)", () => {
            const result = evalRix("3 > 2;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1n);
        });

        test("2 > 3 = null (false)", () => {
            const result = evalRix("2 > 3;");
            expect(result).toBeNull();
        });

        test("5 == 5 = 1 (true)", () => {
            const result = evalRix("5 == 5;");
            expect(result.value).toBe(1n);
        });

        test("5 == 6 = null (false)", () => {
            const result = evalRix("5 == 6;");
            expect(result).toBeNull();
        });

        test("3 < 5 = 1", () => {
            const result = evalRix("3 < 5;");
            expect(result.value).toBe(1n);
        });

        test("5 <= 5 = 1", () => {
            const result = evalRix("5 <= 5;");
            expect(result.value).toBe(1n);
        });

        test("5 >= 6 = null", () => {
            const result = evalRix("5 >= 6;");
            expect(result).toBeNull();
        });

        test("5 != 6 = 1", () => {
            const result = evalRix("5 != 6;");
            expect(result.value).toBe(1n);
        });
    });

    describe("Logic", () => {
        test("1 AND 1 = 1", () => {
            const result = evalRix("1 AND 1;");
            expect(result.value).toBe(1n);
        });

        test("1 AND 0 returns 0 (0 is truthy)", () => {
            const result = evalRix("1 AND 0;");
            expect(result.value).toBe(0n);
        });

        test("0 OR 1 returns 0 (0 is truthy, returned by OR)", () => {
            const result = evalRix("0 OR 1;");
            expect(result.value).toBe(0n);
        });

        test("_ OR 1 returns 1 (null is falsy)", () => {
            const result = evalRix("_ OR 1;");
            expect(result.value).toBe(1n);
        });

        test("_ OR 0 returns 0", () => {
            const result = evalRix("_ OR 0;");
            expect(result.value).toBe(0n);
        });

        test("_ OR _ = null", () => {
            const result = evalRix("_ OR _;");
            expect(result).toBeNull();
        });

        test("short-circuit AND with null", () => {
            const ctx = new Context();
            // null is falsy, so undeclared is not evaluated
            const result = evalRix("_ AND undeclared;", ctx);
            expect(result).toBeNull();
        });

        test("short-circuit OR", () => {
            const ctx = new Context();
            // undeclared is not evaluated because 1 is truthy
            const result = evalRix("1 OR undeclared;", ctx);
            expect(result.value).toBe(1n);
        });

        test("n-ary {&& 1, 1, _} = null (short-circuits)", () => {
            const result = evalRix("{&& 1, 1, _};");
            expect(result).toBeNull();
        });

        test("n-ary {|| _, _, 1} = 1", () => {
            const result = evalRix("{|| _, _, 1};");
            expect(result.value).toBe(1n);
        });

        test("NOT null = 1 (null is falsy)", () => {
            const ctx = new Context();
            evalRix("n = _;", ctx);
            evalRix("x = NOT n;", ctx);
            const result = evalRix("x;", ctx);
            expect(result.value).toBe(1n);
        });

        test("NOT 1 = null", () => {
            const ctx = new Context();
            evalRix("x = NOT 1;", ctx);
            const result = evalRix("x;", ctx);
            expect(result).toBeNull();
        });

        test("NOT 0 = null (0 is truthy)", () => {
            const ctx = new Context();
            evalRix("x = NOT 0;", ctx);
            const result = evalRix("x;", ctx);
            expect(result).toBeNull();
        });
    });

    describe("Control Flow", () => {
        test("ternary: true branch", () => {
            const result = evalRix("1 > 0 ?? 10 ?: 20;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(10n);
        });

        test("ternary: false branch", () => {
            const result = evalRix("0 > 1 ?? 10 ?: 20;");
            expect(result.value).toBe(20n);
        });

        test("block returns last value", () => {
            const result = evalRix("{; 1; 2; 3 };");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(3n);
        });

        test("block with assignment", () => {
            const ctx = new Context();
            const result = evalRix("{; a = 10; b = 20; a + b };", ctx);
            expect(result.value).toBe(30n);
        });
    });

    describe("Functions", () => {
        test("define and call function", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            // Define: F(x) :-> x + 1
            const defCode = "F(x) :-> x + 1;";
            const defTokens = tokenize(defCode);
            const defAst = parse(defTokens, systemLookup);
            const defIr = lower(defAst);
            for (const ir of defIr) {
                evaluate(ir, ctx, registry);
            }

            // Call: F(5) should be 6
            const callCode = "F(5);";
            const callTokens = tokenize(callCode);
            const callAst = parse(callTokens, systemLookup);
            const callIr = lower(callAst);
            let result;
            for (const ir of callIr) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(6n);
        });

        test("function with multiple args", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();

            const code = "ADD(a, b) :-> a + b; ADD(3, 7);";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(10n);
        });

        test("lambda", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();

            const code = "f = (x) -> x * 2;";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.type).toBe("lambda");
        });

        test("@+ system function retrieval", () => {
            const result = evalRix("F = @+; F(10, 20);");
            expect(result.value).toBe(30n);
        });
    });

    describe("Collections", () => {
        test("array literal", () => {
            const result = evalRix("[1, 2, 3];");
            expect(result.type).toBe("sequence");
            expect(result.values.length).toBe(3);
            expect(result.values[0]).toBeInstanceOf(Integer);
            expect(result.values[0].value).toBe(1n);
        });

        test("set literal with |} closer", () => {
            const result = evalRix("{| 1, 2, 3 |};");
            expect(result.type).toBe("set");
            expect(result.values.length).toBe(3);
        });

        test("set literal with } closer", () => {
            const result = evalRix("{| 1, 2, 3 };");
            expect(result.type).toBe("set");
            expect(result.values.length).toBe(3);
        });

        test("tuple literal", () => {
            const result = evalRix("{: 1, 2, 3 };");
            expect(result.type).toBe("tuple");
            expect(result.values.length).toBe(3);
        });

        test("betweenness: 2:3:5 = 1", () => {
            const result = evalRix("2:3:5;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1n);
        });

        test("betweenness: 5:3:2 = 1 (descending)", () => {
            const result = evalRix("5:3:2;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1n);
        });

        test("betweenness: 2:4:3 = null", () => {
            const result = evalRix("2:4:3;");
            expect(result).toBeNull();
        });

        test("betweenness: 3:3:4 = 1 (inclusive)", () => {
            const result = evalRix("3:3:4;");
            expect(result.value).toBe(1n);
        });

        test("betweenness with sets: 2:{|3, 4|}:5 = 1", () => {
            const result = evalRix("2:{|3, 4|}:5;");
            expect(result.value).toBe(1n);
        });

        test("betweenness with sets failure: 2:{|3, 6|}:5 = null", () => {
            const result = evalRix("2:{|3, 6|}:5;");
            expect(result).toBeNull();
        });

        test("n-ary betweenness: 2:3:5:7:9 = 1", () => {
            const result = evalRix("2:3:5:7:9;");
            expect(result.value).toBe(1n);
        });

        test("n-ary betweenness descending: 9:7:5:3:1 = 1", () => {
            const result = evalRix("9:7:5:3:1;");
            expect(result.value).toBe(1n);
        });

        test("n-ary betweenness failure: 2:3:5:9:7 = null", () => {
            const result = evalRix("2:3:5:9:7;");
            expect(result).toBeNull();
        });

        test("nested interval betweenness: 2:(3:4):5 = 1", () => {
            const result = evalRix("2:(3:4):5;");
            expect(result.value).toBe(1n);
        });

        test("nested interval betweenness failure: 2:(3:6):5 = null", () => {
            const result = evalRix("2:(3:6):5;");
            expect(result).toBeNull();
        });

        test("betweenness with set of intervals: 2:{|3:4, 4.1:4.5|}:5 = 1", () => {
            const result = evalRix("2:{|3:4, 4.1:4.5|}:5;");
            expect(result.value).toBe(1n);
        });
    });

    describe("Implicit Multiplication", () => {
        test("f(x) is multiplication for lowercase", () => {
            const ctx = new Context();
            ctx.set("f", new Integer(3));
            ctx.set("x", new Integer(5));
            const result = evalRix("f(x);", ctx);
            expect(result.value).toBe(15n);
        });
    });

    describe("Integration", () => {
        test("multiline: variable + arithmetic + comparison", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = "x = 10; y = 3; z = x + y; z > 10;";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(1n); // 13 > 10 = true
        });

        test("function + block", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = "SQUARE(x) :-> x ^ 2; SQUARE(5);";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(25n);
        });
    });

    describe("Properties", () => {
        test("map [:key] bracket access", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map([["a", new Integer(42)]]) };
            ctx.set("obj", m);
            const result = evalRix("obj[:a];", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(42n);
        });

        test("map [expr] string key access", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map([["version", new Integer(1)]]) };
            ctx.set("m", m);
            const result = evalRix('m["version"];', ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1n);
        });

        test("map numeric and string key forms are equivalent (parenthesized expression key)", () => {
            const ctx = new Context();
            evalRix("a = {= (1)=2 };", ctx);

            expect(evalRix("a[1];", ctx).value).toBe(2n);
            expect(evalRix("a[:1];", ctx).value).toBe(2n);
            expect(evalRix('a["1"];', ctx).value).toBe(2n);

            evalRix('a["1"] = 5;', ctx);
            expect(evalRix("a[1];", ctx).value).toBe(5n);

            evalRix("a[1] = 7;", ctx);
            expect(evalRix('a["1"];', ctx).value).toBe(7n);
            expect(evalRix("a[:1];", ctx).value).toBe(7n);
        });

        test("map string numeric key literal in container normalizes", () => {
            const ctx = new Context();
            evalRix('a = {= ("1")=3 };', ctx);
            expect(evalRix("a[1];", ctx).value).toBe(3n);
            expect(evalRix("a[:1];", ctx).value).toBe(3n);
            expect(evalRix('a["1"];', ctx).value).toBe(3n);
        });

        test("map key expression must be parenthesized in literals", () => {
            expect(() => evalRix("a = {= 1=2 };")).toThrow("Map key expressions must be parenthesized");
        });

        test("object key resolution uses .key meta property", () => {
            const ctx = new Context();
            evalRix("m = {= a=5 };", ctx);
            evalRix('obj = [1]; obj.key = "a";', ctx);
            expect(evalRix("m[obj];", ctx).value).toBe(5n);
        });

        test("KEYOF system function", () => {
            const ctx = new Context();
            const k1 = evalRix('KEYOF("a");', ctx);
            expect(k1.type).toBe("string");
            expect(k1.value).toBe("a");

            const k2 = evalRix("KEYOF(1);", ctx);
            expect(k2.type).toBe("string");
            expect(k2.value).toBe("1");

            evalRix("obj = [1]; obj.key = 7;", ctx);
            const k3 = evalRix("KEYOF(obj);", ctx);
            expect(k3.type).toBe("string");
            expect(k3.value).toBe("7");
        });

        test("KEYOF errors for unsupported keys without .key", () => {
            expect(() => evalRix("KEYOF(3/2);")).toThrow("Value cannot be used as a map key");
            expect(() => evalRix("KEYOF({: 1, 2 });")).toThrow("Value cannot be used as a map key");
        });

        test(".key identity assignment is immutable except idempotent writes", () => {
            const ctx = new Context();
            evalRix("v = [1];", ctx);
            const first = evalRix('v.key = "x";', ctx);
            expect(first.type).toBe("string");
            expect(first.value).toBe("x");

            const same = evalRix('v.key = "x";', ctx);
            expect(same.type).toBe("string");
            expect(same.value).toBe("x");

            const sameCanonical = evalRix("v2 = [1]; v2.key = 1; v2.key = \"1\";", ctx);
            expect(sameCanonical.type).toBe("string");
            expect(sameCanonical.value).toBe("1");

            expect(() => evalRix('v.key = "y";', ctx)).toThrow("Cannot change .key once set");
        });

        test("map literal duplicate keys throw", () => {
            expect(() => evalRix("{= a=1, a=2 };")).toThrow('Duplicate key in map literal: "a"');
            expect(() => evalRix('{= a=1, ("a")=2 };')).toThrow('Duplicate key in map literal: "a"');
            expect(() => evalRix('{= (1)=1, ("1")=2 };')).toThrow('Duplicate key in map literal: "1"');
        });

        test("map existence operator ? uses KEYOF for maps", () => {
            const ctx = new Context();
            evalRix("m = {= a=5, (1)=9 };", ctx);
            expect(evalRix('"a" ? m;', ctx)).toBeInstanceOf(Integer);
            expect(evalRix('"b" ? m;', ctx)).toBeNull();
            expect(evalRix("1 ? m;", ctx)).toBeInstanceOf(Integer);

            evalRix('obj = [1]; obj.key = "a";', ctx);
            expect(evalRix("obj ? m;", ctx)).toBeInstanceOf(Integer);
            expect(evalRix("obj !? m;", ctx)).toBeNull();
        });

        test("array INDEX_GET access (1-based)", () => {
            const ctx = new Context();
            const arr = { type: "sequence", values: [new Integer(10), new Integer(20), new Integer(30)] };
            ctx.set("arr", arr);
            const result = evalRix("arr[2];", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(20n);
        });

        test("sequence negative index (-1 = last)", () => {
            const ctx = new Context();
            const arr = { type: "sequence", values: [new Integer(10), new Integer(20), new Integer(30)] };
            ctx.set("arr", arr);
            const result = evalRix("arr[-1];", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(30n);
        });

        test("meta property returns null when absent", () => {
            const ctx = new Context();
            ctx.set("x", new Integer(5));
            const result = evalRix("x.foo;", ctx);
            expect(result).toBeNull();
        });

        test("META_SET and META_GET roundtrip", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map() };
            ctx.set("obj", m);
            evalRix("obj.tag = 42;", ctx);
            const result = evalRix("obj.tag;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(42n);
        });

        test("KEYS of a map", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map([["x", new Integer(1)], ["y", new Integer(2)]]) };
            ctx.set("obj", m);
            const result = evalRix("obj.|;", ctx);
            expect(result.type).toBe("set");
            expect(result.values).toContain("x");
            expect(result.values).toContain("y");
        });

        test("VALUES of a map", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map([["a", new Integer(5)], ["b", new Integer(10)]]) };
            ctx.set("obj", m);
            const result = evalRix("obj|.;", ctx);
            expect(result.type).toBe("set");
            expect(result.values.length).toBe(2);
        });

        test("META_ALL returns empty map when no meta properties", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map() };
            ctx.set("obj", m);
            const result = evalRix("obj..;", ctx);
            expect(result.type).toBe("map");
            expect(result.entries.size).toBe(0);
        });

        test("set type is not indexable", () => {
            const ctx = new Context();
            ctx.set("s", { type: "set", values: [new Integer(1), new Integer(2)] });
            expect(() => evalRix("s[1];", ctx)).toThrow("not indexable");
        });

        test("out-of-range sequence index returns null", () => {
            const ctx = new Context();
            const arr = { type: "sequence", values: [new Integer(1), new Integer(2)] };
            ctx.set("arr", arr);
            expect(evalRix("arr[5];", ctx)).toBeNull();
            expect(evalRix("arr[-5];", ctx)).toBeNull();
        });

        test("string character access (1-based)", () => {
            const ctx = new Context();
            ctx.set("s", { type: "string", value: "hello" });
            const result = evalRix("s[1];", ctx);
            expect(result.type).toBe("string");
            expect(result.value).toBe("h");
        });

        test("string negative index returns last character", () => {
            const ctx = new Context();
            ctx.set("s", { type: "string", value: "abc" });
            const result = evalRix("s[-1];", ctx);
            expect(result.type).toBe("string");
            expect(result.value).toBe("c");
        });

        test("META_MERGE (.= operator) merges map into meta", () => {
            const ctx = new Context();
            const obj = { type: "map", entries: new Map() };
            ctx.set("obj", obj);
            const updates = { type: "map", entries: new Map([["color", { type: "string", value: "red" }], ["size", new Integer(5)]]) };
            ctx.set("updates", updates);
            evalRix("obj .= updates;", ctx);
            const color = evalRix("obj.color;", ctx);
            expect(color.value).toBe("red");
            const size = evalRix("obj.size;", ctx);
            expect(size.value).toBe(5n);
        });

        test("META_MERGE with null value deletes meta property", () => {
            const ctx = new Context();
            const obj = { type: "map", entries: new Map() };
            obj._ext = new Map([["tag", new Integer(99)]]);
            ctx.set("obj", obj);
            const updates = { type: "map", entries: new Map([["tag", null]]) };
            ctx.set("updates", updates);
            evalRix("obj .= updates;", ctx);
            expect(evalRix("obj.tag;", ctx)).toBeNull();
        });

        test("META_SET immutable flag prevents changes", () => {
            const ctx = new Context();
            const obj = { type: "map", entries: new Map() };
            obj._ext = new Map([["immutable", new Integer(1)]]);
            ctx.set("obj", obj);
            expect(() => evalRix("obj.name = 5;", ctx)).toThrow("immutable");
        });

        test("META_SET frozen flag prevents changes (except unsetting frozen)", () => {
            const ctx = new Context();
            const obj = { type: "map", entries: new Map() };
            obj._ext = new Map([["frozen", new Integer(1)]]);
            ctx.set("obj", obj);
            expect(() => evalRix("obj.name = 5;", ctx)).toThrow("frozen");
        });

        test("INDEX_SET works by default for arrays and maps", () => {
            const ctx = new Context();
            evalRix("arr = [1, 2, 3];", ctx);
            evalRix("arr[1] = 99;", ctx);
            expect(evalRix("arr[1];", ctx).value).toBe(99n);

            evalRix("m = {= a=1 };", ctx);
            evalRix("m[:a] = 2;", ctx);
            expect(evalRix("m[:a];", ctx).value).toBe(2n);
        });

        test("Removing mutable flag locks the object", () => {
            const ctx = new Context();
            evalRix("arr = [1, 2, 3];", ctx);
            evalRix("arr.mutable = _;", ctx);
            expect(() => evalRix("arr[1] = 99;", ctx)).toThrow("mutable");

            evalRix("m = {= a=1 };", ctx);
            evalRix("m.mutable = _;", ctx);
            expect(() => evalRix("m[:a] = 2;", ctx)).toThrow("mutable");
        });

        test("INDEX_SET works when explicitly re-enabled", () => {
            const ctx = new Context();
            evalRix("arr = [1, 2, 3];", ctx);
            evalRix("arr.mutable = _;", ctx);
            evalRix("arr.mutable = 1;", ctx);
            evalRix("arr[1] = 99;", ctx);
            expect(evalRix("arr[1];", ctx).value).toBe(99n);
        });

        test("compound meta assignment (obj.count += 1)", () => {
            const ctx = new Context();
            const obj = { type: "map", entries: new Map() };
            ctx.set("obj", obj);
            evalRix("obj.count = 10;", ctx);
            evalRix("obj.count += 1;", ctx);
            const result = evalRix("obj.count;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(11n);
        });
    });

    describe("Assertions", () => {
        test("ASSERT_LT passes when a < b", () => {
            const result = evalRix("3 :<: 5;");
            expect(result.value).toBe(1n);
        });

        test("ASSERT_LT throws when not a < b", () => {
            expect(() => evalRix("5 :<: 3;")).toThrow("Assertion failed");
        });

        test("ASSERT_GT passes when a > b", () => {
            const result = evalRix("10 :>: 5;");
            expect(result.value).toBe(1n);
        });

        test("ASSERT_GT throws when not a > b", () => {
            expect(() => evalRix("3 :>: 5;")).toThrow("Assertion failed");
        });
    });

    describe("Pipes", () => {
        test("x |> F pipes value into function", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = "DOUBLE(x) :-> x * 2; 5 |> DOUBLE;";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(10n);
        });

        test("[1,2,3] |>> DOUBLE pmap", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = "DOUBLE(x) :-> x * 2; [1, 2, 3] |>> DOUBLE;";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.type).toBe("sequence");
            expect(result.values.length).toBe(3);
            expect(result.values[0].value).toBe(2n);
            expect(result.values[1].value).toBe(4n);
            expect(result.values[2].value).toBe(6n);
        });

        test("[1,2,3,4] |>? ISPOSITIVE pfilter", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = "ISPOSITIVE(x) :-> x > 0; [-1, 2, -3, 4] |>? ISPOSITIVE;";
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.type).toBe("sequence");
            expect(result.values.length).toBe(2);
            expect(result.values[0].value).toBe(2n);
            expect(result.values[1].value).toBe(4n);
        });

        test("[1,2,3] |>: (acc, val) -> acc + val preduce without init", () => {
            const result = evalRix("[1, 2, 3, 4] |>: (acc, val) -> acc + val;");
            expect(result.value).toBe(10n);
        });

        test("[1,2,3] |:> 10 >: (acc, val) -> acc + val preduce with init", () => {
            const result = evalRix("[1, 2, 3, 4] |:> 10 >: (acc, val) -> acc + val;");
            expect(result.value).toBe(20n);
        });

        test("[1,2,3] |>< reverse mapped", () => {
            const result = evalRix("[3, 1, 4] |><;");
            expect(result.type).toBe("sequence");
            expect(result.values[0].value).toBe(4n);
            expect(result.values[1].value).toBe(1n);
            expect(result.values[2].value).toBe(3n);
        });

        test("[3,1,4] |<> sort mapped", () => {
            const result = evalRix("[3, 1, 4] |<> (a, b) -> a - b;");
            expect(result.type).toBe("sequence");
            expect(result.values[0].value).toBe(1n);
            expect(result.values[1].value).toBe(3n);
            expect(result.values[2].value).toBe(4n);
        });

        test("[1,2,3] |>&& (x) -> x > 0 = 3 (all positive, returns last item)", () => {
            const result = evalRix("[1, 2, 3] |>&& (x) -> x > 0;");
            expect(result.value).toBe(3n);
        });

        test("[1,-2,3] |>&& (x) -> x > 0 = null (not all positive)", () => {
            const result = evalRix("[1, -2, 3] |>&& (x) -> x > 0;");
            expect(result).toBeNull();
        });

        test("[] |>&& (x) -> x > 0 = null (empty array)", () => {
            const result = evalRix("[] |>&& (x) -> x > 0;");
            expect(result).toBeNull();
        });

        test("[-1,2,3] |>|| (x) -> x > 0 = 2 (some positive, returns first truthy item)", () => {
            const result = evalRix("[-1, 2, 3] |>|| (x) -> x > 0;");
            expect(result.value).toBe(2n);
        });

        test("[-1,-2,-3] |>|| (x) -> x > 0 = null (none positive)", () => {
            const result = evalRix("[-1, -2, -3] |>|| (x) -> x > 0;");
            expect(result).toBeNull();
        });

        test("[] |>|| (x) -> x > 0 = null (empty array)", () => {
            const result = evalRix("[] |>|| (x) -> x > 0;");
            expect(result).toBeNull();
        });
    });

    describe("Loops and Blocks", () => {
        test("block with multiple statements returns last", () => {
            const result = evalRix("{; 10; 20; 30 };");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(30n);
        });

        test("block with variables", () => {
            const result = evalRix("{; x = 5; y = 10; x * y };");
            expect(result.value).toBe(50n);
        });

        test("nested ternary", () => {
            const ctx = new Context();
            evalRix("x = 15;", ctx);
            const result = evalRix("x > 10 ?? 1 ?: x > 5 ?? 2 ?: 3;", ctx);
            expect(result.value).toBe(1n);
        });
    });

    describe("Recursive Functions", () => {
        test("factorial via recursion", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = `
                F(n) :-> n == 0 ?? 1 ?: n * F(n - 1);
                F(5);
            `;
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(120n);
        });
    });

    describe("Multi-statement Programs", () => {
        test("Fibonacci-style computation", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = `
                a = 1;
                b = 1;
                c = a + b;
                d = b + c;
                e = c + d;
                e;
            `;
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(5n); // 1 1 2 3 5
        });

        test("function composition", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = `
                DOUBLE(x) :-> x * 2;
                SQUARE(x) :-> x ^ 2;
                SQUARE(DOUBLE(3));
            `;
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            expect(result.value).toBe(36n); // (3*2)^2 = 36
        });

        test("rational arithmetic", () => {
            const ctx = new Context();
            const registry = createDefaultRegistry();
            const code = `
                a = 1/3;
                b = 1/6;
                a + b;
            `;
            const tokens = tokenize(code);
            const ast = parse(tokens, systemLookup);
            const irNodes = lower(ast);
            let result;
            for (const ir of irNodes) {
                result = evaluate(ir, ctx, registry);
            }
            // 1/3 + 1/6 = 1/2
            expect(result).toBeInstanceOf(Rational);
            expect(result.numerator).toBe(1n);
            expect(result.denominator).toBe(2n);
        });
    });

    describe("RAND_NAME", () => {
        test("default length is 10", () => {
            const result = evalRix("RAND_NAME();");
            expect(result.type).toBe("string");
            expect(result.value.length).toBe(10);
        });

        test("custom length works", () => {
            const result = evalRix("RAND_NAME(3);");
            expect(result.type).toBe("string");
            expect(result.value.length).toBe(3);
        });

        test("alphabet restriction works", () => {
            const result = evalRix('RAND_NAME(50, "ab");');
            expect(result.type).toBe("string");
            for (const ch of result.value) {
                expect(ch === "a" || ch === "b").toBe(true);
            }
        });

        test("validation errors", () => {
            expect(() => evalRix("RAND_NAME(0);")).toThrow("RAND_NAME len must be a positive integer");
            expect(() => evalRix("RAND_NAME(3, 5);")).toThrow("RAND_NAME alphabet must be a non-empty string");
        });
    });

    describe("Regex Literals", () => {
        test("ONE mode (default) execution", () => {
            const result = evalRix('F = {/a(b)c/}; F("xyz_abc_def");');
            expect(result.type).toBe("map");
            const textMatch = result.entries.get("text");
            expect(textMatch.value).toBe("abc");
            const groups = result.entries.get("groups");
            expect(groups.type).toBe("sequence");
            expect(groups.values[1].value).toBe("b"); // 0-based index 1 is group 1
        });

        test("TEST mode (?) execution", () => {
            const result = evalRix('F = {/abc/?}; F("xyz_abc_def");');
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1n);

            const result2 = evalRix('F = {/abc/?}; F("xyz_def");');
            expect(result2).toBeNull();
        });

        test("ALL mode (*) execution", () => {
            const result = evalRix('F = {/a./*}; F("ab_ac_ad");');
            expect(result.type).toBe("sequence");
            expect(result.values.length).toBe(3);
            expect(result.values[0].entries.get("text").value).toBe("ab");
            expect(result.values[1].entries.get("text").value).toBe("ac");
            expect(result.values[2].entries.get("text").value).toBe("ad");
        });

        test("ITER mode (:) execution", () => {
            const result1 = evalRix('F = {/a./:}; M = F("ab_ac_ad"); RES = M(); RES[:text];');
            expect(result1.value).toBe("ab");

            const result2 = evalRix('F = {/a./:}; M = F("ab_ac_ad"); M(); M(); RES = M(); RES[:text];');
            expect(result2.value).toBe("ad");

            const result3 = evalRix('F = {/a./:}; M = F("ab_ac_ad"); M(); M(); M(); RES = M(); RES;');
            expect(result3).toBeNull();

            // Random access:
            const resultRandom = evalRix('F = {/a./:}; M = F("ab_ac_ad"); M(2)[:text];');
            expect(resultRandom.value).toBe("ac");

            const resultRandomOOB = evalRix('F = {/a./:}; M = F("ab_ac_ad"); M(5);');
            expect(resultRandomOOB).toBeNull();
        });
    });
});
