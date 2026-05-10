import { describe, test, expect } from "bun:test";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";

function systemLookup(name) {
    const symbols = {
        F: { type: "identifier" },
        G: { type: "identifier" },
    };
    return symbols[name] || { type: "identifier" };
}

const defaultSystemContext = createDefaultSystemContext();

function evalRix(code) {
    const ctx = new Context();
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

describe("Shared scope: code blocks in construct positions", () => {
    describe("LOOP sub-parts", () => {
        test("init block shares loop scope", () => {
            // {@ { x = 1 }; x < 4; x; x += 1 } should work like {@ x = 1; x < 4; x; x += 1 }
            const withBlock = evalRix("{@ {; x = 1 }; x < 4; x; x += 1 }");
            const withoutBlock = evalRix("{@ x = 1; x < 4; x; x += 1 }");
            expect(withBlock.value).toBe(3n);
            expect(withoutBlock.value).toBe(3n);
        });

        test("body block shares loop scope", () => {
            // body as a code block can see and modify loop vars
            const result = evalRix("total = 0; {@ i = 1; i <= 3; {; @total += i }; i += 1 }; total;");
            expect(result.value).toBe(6n); // 1 + 2 + 3
        });

        test("condition block shares loop scope", () => {
            // condition as a code block can reference loop vars
            const result = evalRix("{@ x = 0; {; x < 5 }; x; x += 1 }");
            expect(result.value).toBe(4n);
        });

        test("update block shares loop scope", () => {
            // update as a code block can modify loop vars
            const result = evalRix("{@ x = 1; x < 10; x; {; x *= 2 } }");
            expect(result.value).toBe(8n); // 1, 2, 4, 8 (next would be 16, fails condition)
        });

        test("all five parts as code blocks", () => {
            const result = evalRix(`
                total = 0;
                {@ {; i = 1 }; {; i <= 3 }; {; @total += i }; {; i += 1 }; {; @total + i } };
            `);
            expect(result.value).toBe(10n);
        });

        test("multi-statement init block shares scope", () => {
            const result = evalRix("{@ {; x = 0; y = 10 }; x < 3; x + y; x += 1 }");
            expect(result.value).toBe(12n); // last iteration: x=2, y=10 → 12
        });

        test("nested block inside loop part is still isolated", () => {
            // A block nested INSIDE a shared block should be isolated
            // { { z = 99 } } — the outer block shares loop scope, but inner block is isolated
            expect(() => evalRix("{@ {; { z = 99 }; z }; 0; _; _ }")).toThrow();
        });

        test("double-braced block in init is isolated", () => {
            // { { x = 1 } } — outer shares, inner is isolated, so x is NOT in loop scope
            expect(() => evalRix("{@ { { x = 1 } }; x < 4; x; x += 1 }")).toThrow();
        });
    });

    describe("scope isolation preserved", () => {
        test("loop scope still isolates from outer scope", () => {
            // Loop vars should not leak to outer scope
            expect(() => evalRix("{@ x = 1; x < 3; x; x += 1 }; x;")).toThrow("Undefined variable: x");
        });

        test("block inside loop body with @-prefix still works", () => {
            const result = evalRix("out = 0; {@ i = 0; i < 3; {; @out += 1 }; i += 1 }; out;");
            expect(result.value).toBe(3n);
        });
    });
});
