import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";

function testSystemLookup(name) {
    return { type: "identifier" };
}

describe("Reproduction: 3a issue", () => {
    test("3a should be one expression (multiplication or error), not two", () => {
        const code = "a = 2; 3a";
        const tokens = tokenize(code);
        const ast = parse(tokens, testSystemLookup);

        // If it's parsed as two expressions, ast will be an array of lengths
        // The user's observation suggests it's being treated as separate expressions.
        const tokens2 = tokenize("3a");
        const ast2 = parse(tokens2, testSystemLookup);

        console.log("AST for '3a':", JSON.stringify(ast2, null, 2));

        // Now it should be a single node containing an ImplicitMultiplication
        expect(Array.isArray(ast2)).toBe(true);
        expect(ast2.length).toBe(1);
        const expr = ast2[0].type === "Statement" ? ast2[0].expression : ast2[0];
        expect(expr.type).toBe("ImplicitMultiplication");
    });

    test("3(x+1) should be implicit multiplication", () => {
        const tokens = tokenize("3(x+1)");
        const ast = parse(tokens, testSystemLookup);
        expect(ast.length).toBe(1);
        const expr = ast[0].type === "Statement" ? ast[0].expression : ast[0];
        expect(expr.type).toBe("ImplicitMultiplication");
    });

    test("precedence: 3x^2 should be 3 * (x^2)", () => {
        const tokens = tokenize("3x^2");
        const ast = parse(tokens, testSystemLookup);
        const expr = ast[0].type === "Statement" ? ast[0].expression : ast[0];
        expect(expr.type).toBe("ImplicitMultiplication");
        expect(expr.right.type).toBe("BinaryOperation");
        expect(expr.right.operator).toBe("^");
    });
});
