import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer, Rational } from "@ratmath/core";

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
        test("map DOT access", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map([["a", new Integer(42)]]) };
            ctx.set("obj", m);
            const result = evalRix("obj.a;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(42n);
        });

        test("array INDEX access (1-based)", () => {
            const ctx = new Context();
            const arr = { type: "sequence", values: [new Integer(10), new Integer(20), new Integer(30)] };
            ctx.set("arr", arr);
            const result = evalRix("arr[2];", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(20n);
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

        test("EXTALL returns empty map when no ext properties", () => {
            const ctx = new Context();
            const m = { type: "map", entries: new Map() };
            ctx.set("obj", m);
            const result = evalRix("obj..;", ctx);
            expect(result.type).toBe("map");
            expect(result.entries.size).toBe(0);
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
});

