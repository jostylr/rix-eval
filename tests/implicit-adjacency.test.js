import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { Integer, Rational } from "@ratmath/core";

function systemLookup(name) {
    const symbols = {
        SIN: { type: "function", arity: 1 },
        COS: { type: "function", arity: 1 },
        PI: { type: "constant" },
        E: { type: "constant" },
        AND: { type: "operator", precedence: 40, associativity: "left", operatorType: "infix" },
        OR: { type: "operator", precedence: 30, associativity: "left", operatorType: "infix" },
        NOT: { type: "operator", precedence: 110, operatorType: "prefix" },
        IF: { type: "identifier" },
        F: { type: "identifier" },
        G: { type: "identifier" },
        H: { type: "identifier" },
        DOUBLE: { type: "identifier" },
        SQUARE: { type: "identifier" },
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

function parseAST(code) {
    const tokens = tokenize(code);
    return parse(tokens, systemLookup);
}

function stripMeta(obj) {
    if (Array.isArray(obj)) return obj.map(stripMeta);
    if (obj && typeof obj === "object") {
        const { pos, original, systemInfo, ...rest } = obj;
        const cleaned = {};
        for (const [k, v] of Object.entries(rest)) {
            cleaned[k] = stripMeta(v);
        }
        return cleaned;
    }
    return obj;
}

function getExpr(ast) {
    const node = ast[0];
    return node.type === "Statement" ? node.expression : node;
}

describe("Implicit Adjacency", () => {

    describe("Basic implicit multiplication", () => {
        test("3a => 21", () => {
            const ctx = new Context();
            evalRix("a := 7;", ctx);
            const result = evalRix("3a;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(21n);
        });

        test("3 a => 21", () => {
            const ctx = new Context();
            evalRix("a := 7;", ctx);
            const result = evalRix("3 a;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(21n);
        });

        test("a b => 63", () => {
            const ctx = new Context();
            evalRix("a := 7;", ctx);
            evalRix("b := 9;", ctx);
            const result = evalRix("a b;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(63n);
        });

        test("3(7+x) => 24 with x=1", () => {
            const ctx = new Context();
            evalRix("x := 1;", ctx);
            const result = evalRix("3(7+x);", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(24n);
        });

        test("(x+1)(x+2) => 20 with x=3", () => {
            const ctx = new Context();
            evalRix("x := 3;", ctx);
            const result = evalRix("(x+1)(x+2);", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(20n);
        });

        test("5 10 => 50 (number times number)", () => {
            const result = evalRix("5 10;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(50n);
        });

        test("3x^2 => 48 with x=4", () => {
            const ctx = new Context();
            evalRix("x := 4;", ctx);
            const result = evalRix("3x^2;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(48n);
        });
    });

    describe("Basic implicit application", () => {
        test("F 3 => 13", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            const result = evalRix("F 3;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(13n);
        });

        test("F x => 11 with x=1", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 1;", ctx);
            const result = evalRix("F x;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(11n);
        });

        test("F 3x => 22 with x=4 (F(3*x))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3x;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(22n);
        });

        test("F 3 x => 22 with x=4 (F(3*x))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3 x;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(22n);
        });

        test("F 3x^2 => 58 with x=4 (F(3*(x^2)))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3x^2;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(58n);
        });

        test("F (3x + 7) => 29 with x=4 (extends arg past chunk)", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F(3x + 7);", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(29n);
        });
    });

    describe("Application tighter than implicit multiplication", () => {
        test("3 F 7 => 51 (3 * F(7))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            const result = evalRix("3 F 7;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(51n);
        });

        test("3 F x => 42 with x=4 (3 * F(x))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("3 F x;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(42n);
        });

        test("3 F 7x => 114 with x=4 (3 * F(7*x))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("3 F 7x;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(114n);
        });

        test("2 G 3 + 1 => 13 (2*G(3) + 1)", () => {
            const ctx = new Context();
            evalRix("G(n) :-> 2 * n;", ctx);
            const result = evalRix("2 G 3 + 1;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(13n);
        });

        test("2 (G 3) + 1 => 13", () => {
            const ctx = new Context();
            evalRix("G(n) :-> 2 * n;", ctx);
            const result = evalRix("2 (G 3) + 1;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(13n);
        });
    });

    describe("Nested callable consumption", () => {
        test("F G 7 => 24 (F(G(7)))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("G(n) :-> 2 * n;", ctx);
            const result = evalRix("F G 7;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(24n);
        });

        test("3 F G 7 => 72 (3 * F(G(7)))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("G(n) :-> 2 * n;", ctx);
            const result = evalRix("3 F G 7;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(72n);
        });

        test("F G x => 18 with x=4 (F(G(4)))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("G(n) :-> 2 * n;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F G x;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(18n);
        });

        test("3 F G 7 H 9 => 366 (3 * F(G(7 * H(9))))", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("G(n) :-> 2 * n;", ctx);
            evalRix("H(n) :-> n - 1;", ctx);
            // H(9) = 8, 7*8 = 56, G(56) = 112, F(112) = 122, 3*122 = 366
            const result = evalRix("3 F G 7 H 9;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(366n);
        });
    });

    describe("Chunk boundary / precedence", () => {
        test("F 3x + 7 => F(3*x) + 7 with x=4", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3x + 7;", ctx);
            // F(12) + 7 = 22 + 7 = 29
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(29n);
        });

        test("F 3x - 7 => F(3*x) - 7 with x=4", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3x - 7;", ctx);
            // F(12) - 7 = 22 - 7 = 15
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(15n);
        });

        test("F 3*x + 7 => F(3*x) + 7 with x=4", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3*x + 7;", ctx);
            // F(12) + 7 = 22 + 7 = 29
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(29n);
        });

        test("F 3/x + 7 => F(3/x) + 7 with x=4", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3/x + 7;", ctx);
            // F(3/4) + 7 = 10.75 + 7 = 17.75 = 71/4
            const result2 = evalRix("F 3/x + 7;", ctx);
            expect(result2).toBeInstanceOf(Rational);
            expect(result2.toString()).toBe("71/4");
        });

        test("F 3//x + 7 => F(3//x) + 7 with x=4", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3//x + 7;", ctx);
            // 3//4 = 0, F(0) = 10, 10 + 7 = 17
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(17n);
        });

        test("F 3%x + 7 => F(3%x) + 7 with x=4", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3%x + 7;", ctx);
            // 3%4 = 3, F(3) = 13, 13 + 7 = 20
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(20n);
        });

        test("F 3x^2 + 7 => F(3*(x^2)) + 7 with x=4", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F 3x^2 + 7;", ctx);
            // 3*16 = 48, F(48) = 58, 58 + 7 = 65
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(65n);
        });

        test("F 3 < 7 => (F(3)) < 7", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            const result = evalRix("F 3 < 7;", ctx);
            // F(3) = 13, 13 < 7 = false = null
            expect(result).toBeNull();
        });

        test("3 < 7 remains ordinary comparison", () => {
            const result = evalRix("3 < 7;");
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(1n);
        });
    });

    describe("Boundary / disambiguation", () => {
        test("ab is still one identifier (not a*b)", () => {
            const ast = parseAST("ab;");
            const expr = getExpr(ast);
            expect(expr.type).toBe("UserIdentifier");
            expect(expr.name).toBe("ab");
        });

        test("3 F errors at eval (multiply number by bare function)", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            // 3 F → 3 * F (implicit mul) but F is a function value → arithmetic error
            expect(() => evalRix("3 F;", ctx)).toThrow();
        });

        test("3 F G errors at eval (multiply number by bare function result)", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("G(n) :-> 2 * n;", ctx);
            // 3 F G → 3 * F(G) but G is a function value → F gets a function as argument
            // depending on F's implementation this may error
            expect(() => evalRix("3 F G;", ctx)).toThrow();
        });

        test("F alone is just retrieval, not a call", () => {
            const ast = parseAST("F;");
            const expr = getExpr(ast);
            expect(expr.type).toBe("SystemIdentifier");
            expect(expr.name).toBe("F");
        });

        test("F + 1 does not auto-call F", () => {
            const ast = parseAST("F + 1;");
            const expr = getExpr(ast);
            expect(expr.type).toBe("BinaryOperation");
            expect(expr.operator).toBe("+");
        });

        test("a b where both are numeric is multiplication", () => {
            const ctx = new Context();
            evalRix("a := 7;", ctx);
            evalRix("b := 9;", ctx);
            const result = evalRix("a b;", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(63n);
        });
    });

    describe("AST structure", () => {
        test("3a => ImplicitMultiplication(3, a)", () => {
            const ast = parseAST("3a;");
            const expr = getExpr(ast);
            expect(expr.type).toBe("ImplicitMultiplication");
            expect(expr.left.type).toBe("Number");
            expect(expr.right.type).toBe("UserIdentifier");
        });

        test("F 3x => ImplicitApplication(F, ImplicitMul(3, x))", () => {
            const ast = parseAST("F 3x;");
            const expr = getExpr(ast);
            expect(expr.type).toBe("ImplicitApplication");
            expect(expr.callable.type).toBe("SystemIdentifier");
            expect(expr.callable.name).toBe("F");
            expect(expr.argument.type).toBe("ImplicitMultiplication");
        });

        test("3 F 7 => ImplicitMul(3, ImplicitApp(F, 7))", () => {
            const ast = parseAST("3 F 7;");
            const expr = getExpr(ast);
            expect(expr.type).toBe("ImplicitMultiplication");
            expect(expr.left.type).toBe("Number");
            expect(expr.left.value).toBe("3");
            expect(expr.right.type).toBe("ImplicitApplication");
            expect(expr.right.callable.name).toBe("F");
            expect(expr.right.argument.type).toBe("Number");
            expect(expr.right.argument.value).toBe("7");
        });

        test("F G 7 => ImplicitApp(F, ImplicitApp(G, 7))", () => {
            const ast = parseAST("F G 7;");
            const expr = getExpr(ast);
            expect(expr.type).toBe("ImplicitApplication");
            expect(expr.callable.name).toBe("F");
            expect(expr.argument.type).toBe("ImplicitApplication");
            expect(expr.argument.callable.name).toBe("G");
            expect(expr.argument.argument.type).toBe("Number");
        });

        test("3 F G 7 H 9 => MUL(3, APP(F, APP(G, MUL(7, APP(H, 9)))))", () => {
            const ast = parseAST("3 F G 7 H 9;");
            const expr = getExpr(ast);
            // 3 * F(G(7 * H(9)))
            expect(expr.type).toBe("ImplicitMultiplication");
            expect(expr.left.value).toBe("3");
            const fApp = expr.right;
            expect(fApp.type).toBe("ImplicitApplication");
            expect(fApp.callable.name).toBe("F");
            const gApp = fApp.argument;
            expect(gApp.type).toBe("ImplicitApplication");
            expect(gApp.callable.name).toBe("G");
            const mul7H = gApp.argument;
            expect(mul7H.type).toBe("ImplicitMultiplication");
            expect(mul7H.left.value).toBe("7");
            const hApp = mul7H.right;
            expect(hApp.type).toBe("ImplicitApplication");
            expect(hApp.callable.name).toBe("H");
            expect(hApp.argument.value).toBe("9");
        });
    });

    describe("Explicit call syntax preserved", () => {
        test("F(3) still works as explicit call", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            const result = evalRix("F(3);", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(13n);
        });

        test("F(3x + 7) still works", () => {
            const ctx = new Context();
            evalRix("F(n) :-> n + 10;", ctx);
            evalRix("x := 4;", ctx);
            const result = evalRix("F(3x + 7);", ctx);
            expect(result).toBeInstanceOf(Integer);
            expect(result.value).toBe(29n);
        });
    });
});
