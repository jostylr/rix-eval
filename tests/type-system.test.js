import { describe, test, expect } from "bun:test";
import { Integer, Rational } from "@ratmath/core";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";
import {
    makeProto,
    registerTrait,
    registerType,
    traitRegistry,
    typeRegistry,
    valueMethod,
    stringObj,
} from "../src/type-system.js";
import { loadOracleExampleStartup } from "../src/startup/oracle-example.js";
import { loadFloatExampleStartup } from "../../examples/floats/floats-loader.js";

const defaultSystemContext = createDefaultSystemContext();

function evalRiX(code, ctx = new Context(), registryOptions = {}) {
    const registry = createDefaultRegistry(registryOptions);
    const ir = lower(parse(tokenize(code), () => ({ type: "identifier" })));
    let result = null;
    for (const node of ir) {
        result = evaluate(node, ctx, registry, defaultSystemContext);
    }
    return { result, context: ctx, registry };
}

function asBool(value) {
    return value instanceof Integer && value.value === 1n;
}

describe("RiX type and trait registry", () => {
    test("registered trait entries are immutable and duplicate registration is rejected", () => {
        const entry = registerTrait({
            name: "testImmutableTrait",
            implies: [],
            proto: () => makeProto(),
            description: "test trait",
        });
        expect(entry.name).toBe("testImmutableTrait");
        expect(Object.isFrozen(entry)).toBe(true);
        expect(() => {
            entry.description = "changed";
        }).toThrow();
        expect(() => registerTrait({ name: "testImmutableTrait" })).toThrow(/Duplicate trait registration/);
    });

    test("registered type entries are immutable and duplicate registration is rejected", () => {
        const entry = registerType({
            name: "TestImmutableType",
            nativeType: "testImmutable",
            convert: (value) => value,
            proto: () => makeProto(),
        });
        expect(entry.name).toBe("TestImmutableType");
        expect(Object.isFrozen(entry)).toBe(true);
        expect(() => {
            entry.nativeType = "changed";
        }).toThrow();
        expect(() => registerType({ name: "TestImmutableType" })).toThrow(/Duplicate type registration/);
    });

    test("trait implication materializes implied traits", () => {
        const { result } = evalRiX(`
            x = {^ /::Rational/ 7};
            {: x ? :number, x ? :ring, x ? :field, x ? :rational };
        `);
        expect(result.values.map(asBool)).toEqual([true, true, true, true]);
    });

    test("Rational conversion supports soft, strict, and header forms", () => {
        expect(evalRiX("7 ~: :Rational").result).toBeInstanceOf(Rational);
        expect(evalRiX("7 ~!: :Rational").result).toBeInstanceOf(Rational);
        expect(evalRiX('"bad" ~: :Rational').result).toBeNull();
        expect(() => evalRiX('"bad" ~!: :Rational')).toThrow(/Cannot convert value to semantic type Rational/);

        const outfitted = evalRiX("x = {^ /::Rational/ 7}; {: x.__type, x ? :field }").result;
        expect(outfitted.values[0].value).toBe("Rational");
        expect(asBool(outfitted.values[1])).toBe(true);
    });

    test("type proto methods work through method lookup and explicit __proto access", () => {
        const result = evalRiX(`
            x = {^ /::Rational/ 7};
            {: x.Num(), x.__proto[:type].Num(x) };
        `).result;
        expect(result.values[0].value).toBe(7n);
        expect(result.values[1].value).toBe(7n);
    });

    test("later explicit trait proto wins over earlier trait proto", () => {
        registerTrait({
            name: "testProtoA",
            proto: () => makeProto([["Clash", valueMethod("Clash", () => stringObj("A"))]]),
        });
        registerTrait({
            name: "testProtoB",
            proto: () => makeProto([["Clash", valueMethod("Clash", () => stringObj("B"))]]),
        });

        const result = evalRiX("x = {^ /:testProtoA :testProtoB/ 7}; x.Clash();").result;
        expect(result.value).toBe("B");
    });

    test("system operators are multifunction-backed with native fallback and installed Rational variants", () => {
        const registry = createDefaultRegistry();
        const add = registry.get("ADD");
        expect(add.systemMultifunction).toBe(true);
        expect(add.variants.at(-1).name).toBe("NativeFallback");
        expect(add.variants.some((variant) => variant.name === "RatRat" && variant.installedByType === "Rational")).toBe(true);

        const result = evalRiX("r = 1/2 ~: :Rational; s = 1/3 ~: :Rational; r + s;").result;
        expect(result).toBeInstanceOf(Rational);
        expect(result.toString()).toBe("5/6");
    });

    test("POW and POWPROD are distinct system functions with shared native behavior", () => {
        const values = evalRiX("{: 2 ^ 3, 2 ** 3, @^, @** };").result.values;
        expect(values[0].value).toBe(8n);
        expect(values[1].value).toBe(8n);
        expect(values[2].name).toBe("POW");
        expect(values[3].name).toBe("POWPROD");
    });

    test("Rational and Tensor export/import round trip through system helpers", () => {
        const rational = evalRiX("r = 7 ~: :Rational; e = .TypeExport(r); r2 = .TypeImport(e); r == r2;").result;
        expect(asBool(rational)).toBe(true);

        const tensor = evalRiX("t = {:2x2: 1, 2; 3, 4}; e = .TypeExport(t); t2 = .TypeImport(e); {: t2.Shape(), t2.Flatten() };").result;
        expect(tensor.values[0].values.map((v) => Number(v.value))).toEqual([2, 2]);
        expect(tensor.values[1].values.map((v) => Number(v.value))).toEqual([1, 2, 3, 4]);
    });

    test("Oracle is not a built-in type by default", () => {
        expect(typeRegistry.has("Oracle")).toBe(false);
        expect(() => evalRiX("7 ~!: :Oracle")).toThrow(/Unknown semantic type: Oracle/);
    });

    test("example user startup can register minimal Oracle export/import", () => {
        const result = evalRiX(
            "o = 7 ~: :Oracle; e = .TypeExport(o); o2 = .TypeImport(e); o2.Mid();",
            new Context(),
            { startupLoaders: [loadOracleExampleStartup] },
        ).result;
        expect(result.value).toBe(7n);
    });

    test("example Float startup registers a RiX interface backed by JavaScript", () => {
        expect(defaultSystemContext.has("FLOATLTE")).toBe(false);
        expect(defaultSystemContext.has("FloatLte")).toBe(false);
        expect(defaultSystemContext.has("IMPORTJS")).toBe(true);
        expect(defaultSystemContext.has("SIN")).toBe(true);

        const { result, registry } = evalRiX(
            "{; a = 1 ~: :Float; b = 2 ~: :Float; c = a + b * b; s = .SIN(a); e = .EXP(a); ex = .TypeExport(c); c2 = .TypeImport(ex); {: c2.Value(), s.Value(), e.Value() } }",
            new Context(),
            { startupLoaders: [loadFloatExampleStartup] },
        );

        expect(result.values[0].value).toBe("5");
        expect(Number(result.values[1].value)).toBeCloseTo(Math.sin(1));
        expect(Number(result.values[2].value)).toBeCloseTo(Math.exp(1));
        expect(registry.get("ADD").variants.some((variant) => variant.name === "FloatFloat" && variant.installedByType === "Float")).toBe(true);
        expect(registry.get("SIN").variants.some((variant) => variant.name === "Float" && variant.installedByType === "Float")).toBe(true);
        expect(registry.get("SIN").variants.at(-1).name).toBe("NativeFallback");
    });

    test("built-in registries expose the expected built-ins", () => {
        expect(typeRegistry.has("Rational")).toBe(true);
        expect(typeRegistry.has("rational")).toBe(true);
        expect(typeRegistry.has("Integer")).toBe(true);
        expect(typeRegistry.has("RationalInterval")).toBe(true);
        expect(typeRegistry.has("Tensor")).toBe(true);
        expect(traitRegistry.has("field")).toBe(true);
        expect(traitRegistry.has("shapeAware")).toBe(true);
    });
});
