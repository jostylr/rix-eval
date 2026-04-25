import { describe, expect, test } from "bun:test";
import { parse } from "../../parser/src/parser.js";
import { tokenize } from "../../parser/src/tokenizer.js";
import { createDefaultRegistry, createDefaultSystemContext, evaluate } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { lower } from "../src/lower.js";
import { getDiagnostics } from "../src/diagnostics.js";

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

function evalRiXWithContext(code, ctx = new Context()) {
    return {
        result: evalRiX(code, ctx),
        context: ctx,
        diagnostics: getDiagnostics(ctx),
    };
}

function ints(values) {
    return values.map((value) => Number(value.value ?? value));
}

describe("constructor capture modes", () => {
    test("map alias mode keeps live mutable value", () => {
        const result = evalRiX("x := [1, 2]; m = {= /==/ a = x}; x.Push!(3); m[:a]");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2, 3]);
    });

    test("header capture parser accepts whitespace before closing slash", () => {
        const result = evalRiX("x := [1, 2]; m = {= /== / a = x}; x.Push!(3); m[:a]");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2, 3]);
    });

    test("map copy mode isolates later mutation", () => {
        const result = evalRiX("x := [1, 2]; m = {= /:=/ a = x}; x.Push!(3); m[:a]");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2]);
    });

    test("refreshing capture keeps ephemeral meta but not ordinary meta", () => {
        const result = evalRiX("x := [1]; x.tag = 7; x._hint = 9; m = {= /~=/ a = x}; m[:a]..");
        expect(result.type).toBe("map");
        expect(result.entries.has("tag")).toBe(false);
        expect(Number(result.entries.get("_hint").value)).toBe(9);
    });

    test("deep refreshing capture header parses and applies", () => {
        const result = evalRiX("x := [1]; x._hint = 9; m = {= /~~= / a = x}; m[:a]..");
        expect(Number(result.entries.get("_hint").value)).toBe(9);
    });

    test("brace array constructor works", () => {
        const result = evalRiX("a = {.. 1, 2, 3}; a");
        expect(result.type).toBe("sequence");
        expect(ints(result.values)).toEqual([1, 2, 3]);
    });

    test("non-map advanced constructors accept prefix entry overrides", () => {
        const result = evalRiX("x := [1, 2]; a = {.. /:=/ 0, == x}; x.Push!(3); a[2]");
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

describe("semantic outfitting headers", () => {
    test("{^ /#x/ 7} stores sticky name", () => {
        const result = evalRiX("v = {^ /#x/ 7}; v.__name");
        expect(result.value).toBe("x");
    });

    test("{^ /::Rational/ 7} applies type transform and sticky type", () => {
        const result = evalRiX("v = {^ /::Rational/ 7}; {: v.__type, v._type }");
        expect(result.values[0].value).toBe("Rational");
        expect(result.values[1].value).toBe("Rational");
    });

    test("{^ /#len ::Length :meters/ 7} stores name, type, and traits", () => {
        const result = evalRiX("v = {^ /#len ::Length :meters/ 7}; {: v.__name, v.__type, v.__traits.Len() }");
        expect(result.values[0].value).toBe("len");
        expect(result.values[1].value).toBe("Length");
        expect(Number(result.values[2].value)).toBe(1);
    });

    test(":verify triggers trait validation on initial outfit", () => {
        expect(() => evalRiX("v = {^ /:positive :verify/ -3}; v")).toThrow("Trait check failed: positive");
    });

    test("sticky semantic type reapplies on ~= updates", () => {
        const result = evalRiX("x = {^ /::Rational/ 7}; x ~= 9; {: x.__type, x._type }");
        expect(result.values[0].value).toBe("Rational");
        expect(result.values[1].value).toBe("Rational");
    });

    test("sticky semantic metadata survives ~= while runtime metadata is rebuilt", () => {
        const result = evalRiX("x = {^ /#n ::Length :meters/ 7}; x ~= 9; {: x.__name, x.__type, x.__traits.Len(), x._type }");
        expect(result.values[0].value).toBe("n");
        expect(result.values[1].value).toBe("Length");
        expect(Number(result.values[2].value)).toBe(1);
        expect(result.values[3].value).toBe("Integer");
    });

    test("changing semantic type while keeping traits emits a warning", () => {
        const { diagnostics } = evalRiXWithContext("x = {^ /::Length :meters/ 7}; y = {^ /::Vector/ x}; y");
        expect(diagnostics.getEventsByKind("warning").length).toBeGreaterThan(0);
    });

    test("trait proto overrides type proto", () => {
        const result = evalRiX("x = {^ /::Length :meters/ 7}; x.Kind()");
        expect(result.value).toBe("trait:meters");
    });

    test("CheckTraits warns and returns null on failure", () => {
        const { result, diagnostics } = evalRiXWithContext("x = {^ /:positive/ -3}; x.CheckTraits()");
        expect(result).toBeNull();
        expect(diagnostics.getEventsByKind("warning").length).toBeGreaterThan(0);
    });
});
