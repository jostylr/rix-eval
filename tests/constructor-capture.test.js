import { describe, expect, test } from "bun:test";
import { parse } from "../../parser/src/parser.js";
import { tokenize } from "../../parser/src/tokenizer.js";
import { createDefaultRegistry, createDefaultSystemContext, evaluate } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { lower } from "../src/lower.js";

function evalRiX(code, ctx = new Context()) {
    const registry = createDefaultRegistry();
    const systemContext = createDefaultSystemContext();
    const ast = parse(tokenize(code));
    const ir = lower(ast);
    let result = null;
    for (const node of ir) {
        result = evaluate(node, ctx, registry, systemContext);
    }
    return result;
}

function ints(values) {
    return values.map((value) => Number(value.value ?? value));
}

describe("constructor capture modes", () => {
    test("map alias mode keeps live mutable value", () => {
        const result = evalRiX("x := [1, 2]; m = {== a = x}; x.Push!(3); m[:a]");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2, 3]);
    });

    test("map copy mode isolates later mutation", () => {
        const result = evalRiX("x := [1, 2]; m = {:= a = x}; x.Push!(3); m[:a]");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2]);
    });

    test("refreshing capture keeps ephemeral meta but not ordinary meta", () => {
        const result = evalRiX("x := [1]; x.tag = 7; x._hint = 9; m = {~= a = x}; m[:a]..");
        expect(result.type).toBe("map");
        expect(result.entries.has("tag")).toBe(false);
        expect(Number(result.entries.get("_hint").value)).toBe(9);
    });

    test("brace array constructor works", () => {
        const result = evalRiX("a = {.. 1, 2, 3}; a");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2, 3]);
    });

    test("non-map advanced constructors accept prefix entry overrides", () => {
        const result = evalRiX("x := [1, 2]; a = {:=.. 0, == x}; x.Push!(3); a[2]");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2, 3]);
    });

    test("constructor default capture config affects unannotated constructors", () => {
        const ctx = new Context();
        ctx.setEnv("defaultConstructorCaptureMode", "alias");
        const result = evalRiX("x := [1, 2]; a = [x]; x.Push!(3); a[1]", ctx);
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2, 3]);
    });
});
