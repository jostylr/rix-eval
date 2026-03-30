import { describe, test, expect } from "bun:test";
import { Integer, Rational } from "@ratmath/core";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import { getDiagnostics } from "../src/diagnostics.js";

const defaultSystemContext = createDefaultSystemContext();

function evalRiX(code, ctx = new Context()) {
    const registry = createDefaultRegistry();
    const ir = lower(parse(tokenize(code)));
    let result = null;
    for (const node of ir) {
        result = evaluate(node, ctx, registry, defaultSystemContext);
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

describe("semantic inquiry and conversion operators", () => {
    test("inquiry succeeds against __type", () => {
        const result = evalRiX("x = {^ /::rational/ 7}; x ? :rational");
        expect(result).toBeInstanceOf(Integer);
        expect(result.value).toBe(1n);
    });

    test("inquiry succeeds against _type", () => {
        const result = evalRiX("x = 7; x._type = :rational; x ? :rational");
        expect(result).toBeInstanceOf(Integer);
        expect(result.value).toBe(1n);
    });

    test("inquiry succeeds against __traits", () => {
        const result = evalRiX("x = 7; x.__traits = {| :rational |}; x ? :rational");
        expect(result).toBeInstanceOf(Integer);
        expect(result.value).toBe(1n);
    });

    test("inquiry failure returns null", () => {
        const result = evalRiX("x = 7; x ? :oracle");
        expect(result).toBeNull();
    });

    test("soft conversion succeeds and returns converted value", () => {
        const result = evalRiX("7 ~: :rational");
        expect(result).toBeInstanceOf(Rational);
        expect(result.toString()).toBe("7");
    });

    test("strict conversion succeeds and returns converted value", () => {
        const result = evalRiX("7 ~!: :rational");
        expect(result).toBeInstanceOf(Rational);
        expect(result.toString()).toBe("7");
    });

    test("soft conversion failure returns null silently by default", () => {
        const { result, diagnostics } = evalRiXWithContext('"hello" ~: :rational');
        expect(result).toBeNull();
        expect(diagnostics.getEventsByKind("warning")).toHaveLength(0);
    });

    test("soft conversion failure can emit a warning", () => {
        const ctx = new Context();
        ctx.setEnv("warnings", { conversion: true });
        const { result, diagnostics } = evalRiXWithContext('"hello" ~: :rational', ctx);
        expect(result).toBeNull();
        const warnings = diagnostics.getEventsByKind("warning");
        expect(warnings).toHaveLength(1);
        expect(warnings[0].entries.get("label")?.value).toBe("conversion failed");
        const data = warnings[0].entries.get("data");
        expect(data.entries.get("requestedType")?.value).toBe("rational");
    });

    test("strict conversion failure throws", () => {
        expect(() => evalRiX('"hello" ~!: :rational')).toThrow(/Cannot convert value to semantic type rational/);
    });

    test("unknown conversion type throws even for soft conversion", () => {
        expect(() => evalRiX("7 ~: :notAType")).toThrow(/Unknown semantic type: notAType/);
    });

    test("conversion does not mutate the original binding unless assigned back", () => {
        const result = evalRiX("x := 7; y := x ~: :rational; {: x ? :rational, y ? :rational, x == 7 }");
        expect(result.values[0]).toBeNull();
        expect(result.values[1]).toBeInstanceOf(Integer);
        expect(result.values[1].value).toBe(1n);
        expect(result.values[2].value).toBe(1n);
    });
});
