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

        test("2 > 3 = 0 (false)", () => {
            const result = evalRix("2 > 3;");
            expect(result.value).toBe(0n);
        });

        test("5 == 5 = 1 (true)", () => {
            const result = evalRix("5 == 5;");
            expect(result.value).toBe(1n);
        });

        test("5 == 6 = 0 (false)", () => {
            const result = evalRix("5 == 6;");
            expect(result.value).toBe(0n);
        });

        test("3 < 5 = 1", () => {
            const result = evalRix("3 < 5;");
            expect(result.value).toBe(1n);
        });

        test("5 <= 5 = 1", () => {
            const result = evalRix("5 <= 5;");
            expect(result.value).toBe(1n);
        });

        test("5 >= 6 = 0", () => {
            const result = evalRix("5 >= 6;");
            expect(result.value).toBe(0n);
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

        test("1 AND 0 = 0", () => {
            const result = evalRix("1 AND 0;");
            expect(result.value).toBe(0n);
        });

        test("0 OR 1 = 1", () => {
            const result = evalRix("0 OR 1;");
            expect(result.value).toBe(1n);
        });

        test("0 OR 0 = 0", () => {
            const result = evalRix("0 OR 0;");
            expect(result.value).toBe(0n);
        });

        test("NOT 0 = 1", () => {
            // Use in expression context so NOT is parsed as prefix operator
            const ctx = new Context();
            evalRix("x = NOT 0;", ctx);
            const result = evalRix("x;", ctx);
            expect(result.value).toBe(1n);
        });

        test("NOT 1 = 0", () => {
            const ctx = new Context();
            evalRix("x = NOT 1;", ctx);
            const result = evalRix("x;", ctx);
            expect(result.value).toBe(0n);
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
    });

    describe("Collections", () => {
        test("array literal", () => {
            const result = evalRix("[1, 2, 3];");
            expect(result.type).toBe("sequence");
            expect(result.values.length).toBe(3);
            expect(result.values[0]).toBeInstanceOf(Integer);
            expect(result.values[0].value).toBe(1n);
        });

        test("set literal", () => {
            const result = evalRix("{| 1, 2, 3 };");
            expect(result.type).toBe("set");
            expect(result.values.length).toBe(3);
        });

        test("tuple literal", () => {
            const result = evalRix("{: 1, 2, 3 };");
            expect(result.type).toBe("tuple");
            expect(result.values.length).toBe(3);
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
});
