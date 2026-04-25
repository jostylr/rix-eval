import { Integer, Rational } from "@ratmath/core";
import {
    makeProto,
    installRegisteredTypes,
    registerTrait,
    registerType,
    stringObj,
    traitRegistry,
    typeRegistry,
    valueMethod,
} from "../type-system.js";

function oracleFromExact(value) {
    if (value?.type === "oracle") return value;
    return {
        type: "oracle",
        value,
        bounds: null,
        cache: null,
    };
}

export function registerOracleExampleType() {
    if (!traitRegistry.has("refinable")) {
        registerTrait({
            name: "refinable",
            proto: () => makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("trait:refinable"))],
            ]),
            description: "Example user-land trait for values that can refine approximations",
        });
    }
    if (!traitRegistry.has("approximate")) {
        registerTrait({
            name: "approximate",
            proto: () => makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("trait:approximate"))],
            ]),
            description: "Example user-land trait for approximate real representations",
        });
    }
    if (!traitRegistry.has("oracle")) {
        registerTrait({
            name: "oracle",
            implies: ["refinable", "approximate"],
            proto: () => makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("trait:oracle"))],
            ]),
            description: "Example user-land trait for oracle real values",
        });
    }
    if (typeRegistry.has("Oracle")) return typeRegistry.get("Oracle");

    return registerType({
        name: "Oracle",
        aliases: ["oracle"],
        nativeType: "oracle",
        defaultTraits: ["oracle", "refinable", "approximate", "number"],
        convertFrom: {
            Integer: oracleFromExact,
            integer: oracleFromExact,
            Rational: oracleFromExact,
            rational: oracleFromExact,
            oracle: (value) => value,
        },
        convert(value) {
            if (value instanceof Integer || value instanceof Rational || value?.type === "oracle") {
                return oracleFromExact(value);
            }
            return null;
        },
        validate: (value) => value?.type === "oracle",
        export(value) {
            return {
                type: "map",
                entries: new Map([
                    ["type", stringObj("Oracle")],
                    ["data", { type: "map", entries: new Map([
                        ["seed", value.value],
                        ["bounds", value.bounds ?? null],
                    ]) }],
                    ["cache", value.cache ?? null],
                    ["version", new Integer(1n)],
                ]),
            };
        },
        import(value) {
            const data = value?.entries?.get("data");
            return {
                type: "oracle",
                value: data?.entries?.get("seed") ?? null,
                bounds: data?.entries?.get("bounds") ?? null,
                cache: value?.entries?.get("cache") ?? null,
            };
        },
        proto: () => makeProto([
            ["Bounds", valueMethod("Bounds", (self) => self.bounds ?? null)],
            ["Mid", valueMethod("Mid", (self) => self.value)],
            ["ToInterval", valueMethod("ToInterval", (self) => self.bounds ?? null)],
            ["Describe", valueMethod("Describe", () => stringObj("type:Oracle"))],
        ]),
        installs: {},
    });
}

export function loadOracleExampleStartup(registry) {
    registerOracleExampleType();
    if (registry) installRegisteredTypes(registry, ["Oracle"]);
    return registry;
}
