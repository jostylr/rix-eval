import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";

function systemLookup(name) {
    const symbols = {
        SIN: { type: "function", arity: 1 },
        COS: { type: "function", arity: 1 },
        PI: { type: "constant" },
        ADD: { type: "identifier" },
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

function parseRix(code) {
    const tokens = tokenize(code);
    return parse(tokens, systemLookup);
}

describe("Colon-string syntax", () => {
    describe("parser: produces String nodes", () => {
        test(":word produces a string", () => {
            const ast = parseRix(":hello");
            expect(ast[0].type).toBe("String");
            expect(ast[0].value).toBe("hello");
            expect(ast[0].kind).toBe("colon");
        });

        test(":Word uppercase preserves case", () => {
            const ast = parseRix(":World");
            expect(ast[0].type).toBe("String");
            expect(ast[0].value).toBe("World");
        });

        test(":ALL_CAPS preserves case", () => {
            const ast = parseRix(":HELLO");
            expect(ast[0].type).toBe("String");
            expect(ast[0].value).toBe("HELLO");
        });

        test(":123 number produces a string", () => {
            const ast = parseRix(":123");
            expect(ast[0].type).toBe("String");
            expect(ast[0].value).toBe("123");
        });

        test(":word inside parentheses", () => {
            const ast = parseRix("(:foo)");
            // Grouping wraps the inner expression
            const inner = ast[0].expression || ast[0];
            expect(inner.type).toBe("String");
            expect(inner.value).toBe("foo");
        });

        test(":word after comma in array", () => {
            const ast = parseRix("[1, :two, 3]");
            const arr = ast[0];
            expect(arr.elements[1].type).toBe("String");
            expect(arr.elements[1].value).toBe("two");
        });

        test(":word after assignment operator", () => {
            const ast = parseRix("x := :name");
            // := is a BinaryOperation in the AST
            expect(ast[0].type).toBe("BinaryOperation");
            expect(ast[0].right.type).toBe("String");
            expect(ast[0].right.value).toBe("name");
        });
    });

    describe("evaluator: colon-strings evaluate to strings", () => {
        test(":hello evaluates to string", () => {
            const result = evalRix(":hello");
            expect(result).toEqual({ type: "string", value: "hello" });
        });

        test(":World preserves case", () => {
            const result = evalRix(":World");
            expect(result).toEqual({ type: "string", value: "World" });
        });

        test(":123 evaluates to string", () => {
            const result = evalRix(":123");
            expect(result).toEqual({ type: "string", value: "123" });
        });

        test(":word_with_underscores", () => {
            const result = evalRix(":some_key");
            expect(result).toEqual({ type: "string", value: "some_key" });
        });

        test("colon-string assigned to variable", () => {
            const result = evalRix('x := :hello; x');
            expect(result).toEqual({ type: "string", value: "hello" });
        });

        test("colon-string in array", () => {
            const result = evalRix('[1, :two, 3]');
            expect(result.values[1]).toEqual({ type: "string", value: "two" });
        });

        test("colon-string as map key access", () => {
            const result = evalRix('{= name = 5}[:name]');
            expect(result.value).toBe(5n);
        });

        test("colon-string equality with quoted string", () => {
            const result = evalRix(':hello == "hello"');
            expect(result.value).toBe(1n);
        });

        test("colon-string in map literal value", () => {
            const result = evalRix('{= x = :hello}[:x]');
            expect(result).toEqual({ type: "string", value: "hello" });
        });
    });

    describe("interval syntax preserved", () => {
        test("5:3 is tokenized as interval number", () => {
            const ast = parseRix("5:3");
            // 5:3 is a single number token (interval literal)
            expect(ast[0].type).toBe("Number");
            expect(ast[0].value).toBe("5:3");
        });

        test("a:b is still an interval (BinaryOperation)", () => {
            const ast = parseRix("a:b");
            expect(ast[0].type).toBe("BinaryOperation");
            expect(ast[0].operator).toBe(":");
        });

        test("a :b is still an interval (whitespace)", () => {
            const ast = parseRix("a :b");
            expect(ast[0].type).toBe("BinaryOperation");
            expect(ast[0].operator).toBe(":");
        });

        test("(a):b is still an interval", () => {
            const ast = parseRix("(a):b");
            expect(ast[0].type).toBe("BinaryOperation");
            expect(ast[0].operator).toBe(":");
        });

        test("evaluator: a:b with numeric values", () => {
            const result = evalRix("a := 5; b := 3; a:b");
            // Should produce a RationalInterval
            expect(result.toString()).toBe("5:3");
        });

        test("existing [:key] syntax still works", () => {
            const result = evalRix('{= name = 5}[:name]');
            expect(result.value).toBe(5n);
        });
    });
});
