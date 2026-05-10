import { Integer, Rational, RationalInterval } from "@ratmath/core";
import { createTensor, isTensor } from "./tensor.js";
import { callWithConcreteArgs } from "./functions/functions.js";

function int(value) {
    return new Integer(BigInt(value));
}

export function stringObj(value) {
    return { type: "string", value };
}

export function colonName(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (value?.type === "string") return value.value;
    return String(value);
}

export function makeProto(entries = []) {
    const entryMap = new Map(entries);
    for (const [key, value] of entries) {
        if (typeof key === "string") {
            entryMap.set(key.toUpperCase(), value);
        }
    }
    return {
        type: "map",
        entries: entryMap,
        _ext: new Map([["frozen", int(1)], ["immutable", int(1)], ...entryMap.entries()]),
    };
}

export function valueMethod(name, fn) {
    return {
        type: "method_builtin",
        name,
        impl(args, context, evaluate, callWithConcreteArgs) {
            const receiver = args[0]?.type === "map" && args.length > 1 ? args[1] : args[0];
            const rest = args[0]?.type === "map" && args.length > 1 ? args.slice(2) : args.slice(1);
            return fn(receiver, rest, context, evaluate, callWithConcreteArgs);
        },
    };
}

function immutableCloneSpec(spec) {
    const clone = { ...spec };
    if (Array.isArray(spec.defaultTraits)) clone.defaultTraits = Object.freeze([...spec.defaultTraits]);
    if (Array.isArray(spec.implies)) clone.implies = Object.freeze([...spec.implies]);
    if (Array.isArray(spec.aliases)) clone.aliases = Object.freeze([...spec.aliases]);
    if (spec.convertFrom instanceof Map) clone.convertFrom = new Map(spec.convertFrom);
    else if (spec.convertFrom && typeof spec.convertFrom === "object") clone.convertFrom = new Map(Object.entries(spec.convertFrom));
    else clone.convertFrom = new Map();
    if (spec.installs instanceof Map) clone.installs = new Map(spec.installs);
    else if (spec.installs && typeof spec.installs === "object") clone.installs = new Map(Object.entries(spec.installs));
    else clone.installs = new Map();
    return Object.freeze(clone);
}

function isCallable(value) {
    return value && typeof value === "object" && (
        value.type === "function" ||
        value.type === "lambda" ||
        value.type === "sysref" ||
        value.type === "partial"
    );
}

function invokeMaybeCallable(fn, args, context, evaluate) {
    if (!fn) return null;
    if (typeof fn === "function") return fn(...args);
    if (isCallable(fn)) {
        if (!fn.__rixCapturedEnv || !context?.setEnv) {
            return callWithConcreteArgs(fn, args, context, evaluate);
        }
        const restored = new Map();
        for (const [key, value] of fn.__rixCapturedEnv) {
            restored.set(key, {
                has: context.env?.has(key) === true,
                value: context.getEnv(key, undefined),
            });
            context.setEnv(key, value);
        }
        try {
            return callWithConcreteArgs(fn, args, context, evaluate);
        } finally {
            for (const [key, entry] of restored) {
                if (entry.has) context.setEnv(key, entry.value);
                else context.env?.delete(key);
            }
        }
    }
    throw new Error("Type/trait registry hook must be callable");
}

function truthy(value) {
    return value !== null && value !== undefined;
}

class ImmutableSemanticRegistry {
    constructor(kind) {
        this.kind = kind;
        this.entries = new Map();
        this.aliases = new Map();
    }

    register(spec) {
        const name = colonName(spec?.name);
        if (!name) throw new Error(`${this.kind} registration requires a name`);
        if (this.entries.has(name) || this.aliases.has(name)) {
            throw new Error(`Duplicate ${this.kind} registration: ${name}`);
        }
        const entry = immutableCloneSpec({ ...spec, name });
        this.entries.set(name, entry);
        for (const alias of entry.aliases || []) {
            const aliasName = colonName(alias);
            if (!aliasName) continue;
            if (this.entries.has(aliasName) || this.aliases.has(aliasName)) {
                throw new Error(`Duplicate ${this.kind} alias: ${aliasName}`);
            }
            this.aliases.set(aliasName, name);
        }
        return entry;
    }

    get(name) {
        const key = colonName(name);
        if (!key) return null;
        return this.entries.get(key) ?? this.entries.get(this.aliases.get(key)) ?? null;
    }

    has(name) {
        return Boolean(this.get(name));
    }

    list() {
        return Array.from(this.entries.keys());
    }
}

export const traitRegistry = new ImmutableSemanticRegistry("trait");
export const typeRegistry = new ImmutableSemanticRegistry("type");

export function registerTrait(spec) {
    return traitRegistry.register(spec);
}

export function registerType(spec) {
    return typeRegistry.register(spec);
}

export function resolveTraitNames(names) {
    const result = [];
    const seen = new Set();
    const visiting = new Set();

    function visit(name) {
        const traitName = colonName(name);
        if (!traitName || seen.has(traitName)) return;
        if (visiting.has(traitName)) throw new Error(`Cyclic trait implication involving ${traitName}`);
        const entry = traitRegistry.get(traitName);
        if (!entry) throw new Error(`Unknown semantic trait: ${traitName}`);
        visiting.add(traitName);
        for (const implied of entry.implies || []) {
            visit(implied);
        }
        visiting.delete(traitName);
        seen.add(traitName);
        result.push(traitName);
    }

    for (const name of names || []) visit(name);
    return result;
}

export function runtimeTypeName(value) {
    if (value === null) return "null";
    if (value instanceof Integer) return "Integer";
    if (value instanceof Rational) return "Rational";
    if (value instanceof RationalInterval) return "RationalInterval";
    if (isTensor(value)) return "tensor";
    if (value?.type === "sequence") return "array";
    if (value?.type) return value.type;
    if (value?.constructor?.name) return value.constructor.name;
    return typeof value;
}

function normalizeResult(entry, value) {
    return entry.normalize ? entry.normalize(value) : value;
}

export function convertToRegisteredType(value, requestedTypeName, context = null, evaluate = null) {
    const typeName = colonName(requestedTypeName);
    const entry = typeRegistry.get(typeName);
    if (!entry) throw new Error(`Unknown semantic type: ${typeName}`);

    const semanticSourceType = value?._ext?.get("__type")?.value ?? null;
    const runtimeSourceType = value?._ext?.get("_type")?.value ?? runtimeTypeName(value);
    const sourceType = semanticSourceType ?? runtimeSourceType;
    let next = value;
    const converter =
        entry.convertFrom?.get(runtimeSourceType) ??
        entry.convertFrom?.get(String(runtimeSourceType).toLowerCase()) ??
        entry.convertFrom?.get(sourceType) ??
        entry.convertFrom?.get(String(sourceType).toLowerCase());

    if (converter) {
        next = invokeMaybeCallable(converter, [value], context, evaluate);
    } else if (entry.name === sourceType || typeName === sourceType || entry.nativeType === sourceType) {
        next = value;
    } else if (entry.convert) {
        next = invokeMaybeCallable(entry.convert, [value, stringObj(sourceType)], context, evaluate);
    }

    if (next === null || next === undefined) {
        return null;
    }
    next = entry.normalize ? invokeMaybeCallable(entry.normalize, [next], context, evaluate) : normalizeResult(entry, next);
    if (next === null || next === undefined) {
        return null;
    }
    if (entry.validate && !truthy(invokeMaybeCallable(entry.validate, [next], context, evaluate))) {
        return null;
    }
    return { value: next, entry, requestedTypeName: typeName };
}

function isStringObject(value) {
    return value && typeof value === "object" && value.type === "string";
}

function rationalFromString(value) {
    if (!isStringObject(value)) return null;
    const text = value.value.trim();
    const ratio = text.match(/^(-?\d+)\/(\d+)$/);
    if (ratio) return new Rational(BigInt(ratio[1]), BigInt(ratio[2]));
    if (/^-?\d+$/.test(text)) return new Rational(BigInt(text), 1n);
    return null;
}

function rationalParts(value) {
    if (value instanceof Integer) return { numerator: value.value, denominator: 1n };
    if (value instanceof Rational) return { numerator: value.numerator, denominator: value.denominator };
    return null;
}

function boolResult(value) {
    return value ? new Integer(1n) : null;
}

function compareNumeric(a, b) {
    if (a && b && typeof a.subtract === "function" && typeof b.subtract === "function") {
        const diff = a.subtract(b);
        if (typeof diff.sign === "function") return Number(diff.sign().value ?? diff.sign());
        if (typeof diff.numerator === "bigint") {
            if (diff.numerator < 0n) return -1;
            if (diff.numerator > 0n) return 1;
            return 0;
        }
        if (typeof diff.value === "bigint") {
            if (diff.value < 0n) return -1;
            if (diff.value > 0n) return 1;
            return 0;
        }
    }
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

export const TYPE_INSTALL_FUNCTIONS = [
    "ADD", "SUB", "MUL", "DIV", "INTDIV", "MOD", "POW", "POWPROD", "NEG",
    "EQ", "LT", "GT", "LTE", "GTE",
    "ABS", "SQRT", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2",
    "LOG", "LN", "LOG10", "EXP",
];

let builtinsRegistered = false;

export function registerBuiltinSemanticTypes() {
    if (builtinsRegistered) return;

    const traits = [
        ["number"],
        ["ring", ["number"]],
        ["field", ["ring", "number"]],
        ["ordered", ["number"]],
        ["rational", ["field", "ordered"]],
        ["integer", ["rational"]],
        ["indexable"],
        ["shapeAware"],
        ["collection"],
        ["sequence", ["collection", "indexable"]],
        ["maplike", ["collection", "indexable"]],
        ["tensor", ["indexable", "shapeAware", "collection"]],
        ["meters"],
        ["cartesian"],
        ["square"],
        ["positive"],
        ["verify"],
    ];
    for (const [name, implies = []] of traits) {
        registerTrait({
            name,
            implies,
            proto: () => makeProto([
                ["Describe", valueMethod("Describe", () => stringObj(`trait:${name}`))],
                ["KIND", valueMethod("KIND", () => stringObj(`trait:${name}`))],
            ]),
            description: `${name} semantic trait`,
        });
    }

    const nativeOnly = [
        ["String", "string", [], (value) => isStringObject(value) ? value : null],
        ["Array", "array", ["sequence"], (value) => value?.type === "sequence" ? value : null],
        ["Tuple", "tuple", ["sequence"], (value) => value?.type === "tuple" ? value : null],
        ["Map", "map", ["maplike"], (value) => value?.type === "map" ? value : null],
        ["Set", "set", ["collection"], (value) => value?.type === "set" ? value : null],
        ["Function", "function", [], (value) => value?.type === "function" || value?.type === "lambda" ? value : null],
        ["Multifunction", "multifunction", [], (value) => value?._ext?.get("_type")?.value === "multifunction" ? value : null],
        ["Null", "null", [], (value) => value === null ? value : null],
        ["Hole", "hole", [], () => null],
    ];
    for (const [name, nativeType, defaultTraits, convert] of nativeOnly) {
        registerType({
            name,
            aliases: [nativeType],
            nativeType,
            defaultTraits,
            convert,
            proto: () => makeProto([["Describe", valueMethod("Describe", () => stringObj(`type:${name}`))]]),
        });
    }

    registerType({
        name: "Rational",
        aliases: ["rational"],
        nativeType: "rational",
        defaultTraits: ["rational", "number", "ordered", "field"],
        convertFrom: {
            Integer: (value) => new Rational(value.value, 1n),
            integer: (value) => new Rational(value.value, 1n),
            Rational: (value) => value,
            rational: (value) => value,
            string: rationalFromString,
        },
        convert(value) {
            if (value instanceof Integer) return new Rational(value.value, 1n);
            if (value instanceof Rational) return value;
            if (value instanceof RationalInterval && value.low.equals(value.high)) return value.low;
            return rationalFromString(value);
        },
        normalize: (value) => value,
        validate: (value) => value instanceof Rational,
        export(value) {
            const parts = rationalParts(value);
            return {
                type: "map",
                entries: new Map([
                    ["type", stringObj("Rational")],
                    ["data", { type: "map", entries: new Map([
                        ["num", new Integer(parts.numerator)],
                        ["den", new Integer(parts.denominator)],
                    ]) }],
                    ["cache", null],
                    ["version", new Integer(1n)],
                ]),
            };
        },
        import(value) {
            const data = value?.entries?.get("data");
            const num = data?.entries?.get("num");
            const den = data?.entries?.get("den");
            return new Rational(num.value, den.value);
        },
        proto: () => makeProto([
            ["Num", valueMethod("Num", (self) => new Integer(rationalParts(self).numerator))],
            ["Den", valueMethod("Den", (self) => new Integer(rationalParts(self).denominator))],
            ["ToString", valueMethod("ToString", (self) => stringObj(self.toString()))],
            ["Describe", valueMethod("Describe", () => stringObj("type:Rational"))],
            ["KIND", valueMethod("KIND", () => stringObj("type:Rational"))],
        ]),
        installs: {
            ADD: [{
                name: "RatRat",
                prep: (args) => args.length === 2 && rationalParts(args[0]) && rationalParts(args[1]),
                impl: ([a, b]) => a.add(b),
            }],
            SUB: [{
                name: "RatRat",
                prep: (args) => args.length === 2 && rationalParts(args[0]) && rationalParts(args[1]),
                impl: ([a, b]) => a.subtract(b),
            }],
            MUL: [{
                name: "RatRat",
                prep: (args) => args.length === 2 && rationalParts(args[0]) && rationalParts(args[1]),
                impl: ([a, b]) => a.multiply(b),
            }],
            DIV: [{
                name: "RatRat",
                prep: (args) => args.length === 2 && rationalParts(args[0]) && rationalParts(args[1]),
                impl: ([a, b]) => a.divide(b),
            }],
            EQ: [{
                name: "RatRat",
                prep: (args) => args.length === 2 && rationalParts(args[0]) && rationalParts(args[1]),
                impl: ([a, b]) => boolResult(a.equals(b)),
            }],
            LT: [{
                name: "RatRat",
                prep: (args) => args.length === 2 && rationalParts(args[0]) && rationalParts(args[1]),
                impl: ([a, b]) => boolResult(compareNumeric(a, b) < 0),
            }],
        },
    });

    registerType({
        name: "Integer",
        aliases: ["integer"],
        nativeType: "integer",
        defaultTraits: ["integer", "rational", "number", "ordered"],
        convertFrom: {
            Integer: (value) => value,
            integer: (value) => value,
        },
        convert(value) {
            if (value instanceof Integer) return value;
            return null;
        },
        validate: (value) => value instanceof Integer,
        export(value) {
            return {
                type: "map",
                entries: new Map([
                    ["type", stringObj("Integer")],
                    ["data", { type: "map", entries: new Map([["value", new Integer(value.value)]]) }],
                    ["cache", null],
                    ["version", new Integer(1n)],
                ]),
            };
        },
        import(value) {
            return new Integer(value?.entries?.get("data")?.entries?.get("value")?.value ?? 0n);
        },
        proto: () => makeProto([
            ["ToString", valueMethod("ToString", (self) => stringObj(self.toString()))],
            ["Describe", valueMethod("Describe", () => stringObj("type:Integer"))],
        ]),
        installs: {},
    });

    registerType({
        name: "RationalInterval",
        aliases: ["Interval", "interval"],
        nativeType: "interval",
        defaultTraits: ["ordered"],
        convertFrom: {
            RationalInterval: (value) => value,
            interval: (value) => value,
        },
        convert(value) {
            return value instanceof RationalInterval ? value : null;
        },
        validate: (value) => value instanceof RationalInterval,
        export(value) {
            return {
                type: "map",
                entries: new Map([
                    ["type", stringObj("RationalInterval")],
                    ["data", { type: "map", entries: new Map([
                        ["low", value.low],
                        ["high", value.high],
                    ]) }],
                    ["cache", null],
                    ["version", new Integer(1n)],
                ]),
            };
        },
        import(value) {
            const data = value?.entries?.get("data");
            return new RationalInterval(data?.entries?.get("low"), data?.entries?.get("high"));
        },
        proto: () => makeProto([
            ["Low", valueMethod("Low", (self) => self.low)],
            ["High", valueMethod("High", (self) => self.high)],
            ["ToString", valueMethod("ToString", (self) => stringObj(self.toString()))],
            ["Describe", valueMethod("Describe", () => stringObj("type:RationalInterval"))],
        ]),
        installs: {},
    });

    registerType({
        name: "Tensor",
        aliases: ["tensor"],
        nativeType: "tensor",
        defaultTraits: ["tensor", "indexable", "shapeAware", "collection"],
        convertFrom: {
            tensor: (value) => value,
            array: (value) => createTensor([value.values.length], value.values),
            tuple: (value) => createTensor([value.values.length], value.values),
        },
        convert(value) {
            if (isTensor(value)) return value;
            if (value?.type === "sequence" || value?.type === "tuple") return createTensor([value.values.length], value.values);
            return null;
        },
        validate: isTensor,
        export(value) {
            return {
                type: "map",
                entries: new Map([
                    ["type", stringObj("Tensor")],
                    ["data", { type: "map", entries: new Map([
                        ["shape", { type: "sequence", values: value.shape.map((n) => new Integer(BigInt(n))) }],
                        ["elems", { type: "sequence", values: [...value.data] }],
                    ]) }],
                    ["cache", null],
                    ["version", new Integer(1n)],
                ]),
            };
        },
        import(value) {
            const data = value?.entries?.get("data");
            const shape = data?.entries?.get("shape")?.values.map((n) => Number(n.value)) || [];
            const elems = data?.entries?.get("elems")?.values || [];
            return createTensor(shape, elems);
        },
        proto: () => makeProto([
            ["Shape", valueMethod("Shape", (self) => ({ type: "sequence", values: self.shape.map((n) => new Integer(BigInt(n))) }))],
            ["Rank", valueMethod("Rank", (self) => new Integer(BigInt(self.shape.length)))],
            ["Flatten", valueMethod("Flatten", (self) => ({ type: "sequence", values: [...self.data] }))],
            ["Describe", valueMethod("Describe", () => stringObj("type:Tensor"))],
        ]),
        installs: {},
    });

    registerType({
        name: "Length",
        nativeType: "Length",
        defaultTraits: [],
        convert: (value) => value,
        proto: () => makeProto([
            ["Describe", valueMethod("Describe", () => stringObj("type:length"))],
            ["KIND", valueMethod("KIND", () => stringObj("type:length"))],
        ]),
    });
    registerType({ name: "Point", nativeType: "Point", defaultTraits: [], convert: (value) => value, proto: () => makeProto([["Describe", valueMethod("Describe", () => stringObj("type:point"))]]) });
    registerType({ name: "Matrix", nativeType: "Matrix", parent: "Tensor", defaultTraits: ["tensor"], convert: (value) => value, proto: () => makeProto([["Describe", valueMethod("Describe", () => stringObj("type:matrix"))]]) });
    registerType({ name: "Vector", nativeType: "Vector", defaultTraits: [], convert: (value) => value, proto: () => makeProto([["Describe", valueMethod("Describe", () => stringObj("type:vector"))], ["KIND", valueMethod("KIND", () => stringObj("type:vector"))]]) });

    builtinsRegistered = true;
}

export function exportByRegisteredType(value) {
    const typeName = value?._ext?.get("__type")?.value ?? null;
    const entry = typeRegistry.get(typeName) ?? typeRegistry.get(runtimeTypeName(value));
    if (!entry?.export) throw new Error(`No type export registered for ${typeName || runtimeTypeName(value)}`);
    return entry.export(value);
}

export function exportByRegisteredTypeRuntime(value, context = null, evaluate = null) {
    const typeName = value?._ext?.get("__type")?.value ?? null;
    const entry = typeRegistry.get(typeName) ?? typeRegistry.get(runtimeTypeName(value));
    if (!entry?.export) throw new Error(`No type export registered for ${typeName || runtimeTypeName(value)}`);
    return invokeMaybeCallable(entry.export, [value], context, evaluate);
}

export function importByRegisteredType(value) {
    if (!value || value.type !== "map" || !(value.entries instanceof Map)) {
        throw new Error("TypeImport expects a tagged map export");
    }
    const typeName = value.entries.get("type")?.value;
    if (!typeName) throw new Error("TypeImport export map requires a type tag");
    const entry = typeRegistry.get(typeName);
    if (!entry?.import) throw new Error(`No type import registered for ${typeName}`);
    const imported = entry.import(value);
    return finalizeImportedRegisteredValue(imported, typeName, entry);
}

function finalizeImportedRegisteredValue(imported, typeName, entry) {
    if (imported && typeof imported === "object") {
        if (!(imported._ext instanceof Map)) imported._ext = new Map();
        imported._ext.set("__type", stringObj(typeName));
        const traits = resolveTraitNames(entry.defaultTraits || []);
        if (traits.length > 0) {
            imported._ext.set("__traits", {
                type: "set",
                values: traits.map(stringObj),
                _ext: new Map([["order", { type: "sequence", values: traits.map(stringObj) }]]),
            });
        }
        imported._ext.set("__proto", makeProto([
            ["type", entry.proto?.(imported) ?? makeProto()],
            ["traits", makeProto()],
        ]));
        imported._ext.set("_type", stringObj(runtimeTypeName(imported)));
    }
    return imported;
}

export function importByRegisteredTypeRuntime(value, context = null, evaluate = null) {
    if (!value || value.type !== "map" || !(value.entries instanceof Map)) {
        throw new Error("TypeImport expects a tagged map export");
    }
    const typeName = value.entries.get("type")?.value;
    if (!typeName) throw new Error("TypeImport export map requires a type tag");
    const entry = typeRegistry.get(typeName);
    if (!entry?.import) throw new Error(`No type import registered for ${typeName}`);
    return finalizeImportedRegisteredValue(invokeMaybeCallable(entry.import, [value], context, evaluate), typeName, entry);
}

export function installRegisteredTypes(registry, typeNames = ["Integer", "Rational", "RationalInterval", "Tensor"]) {
    let order = 0;
    for (const typeName of typeNames) {
        const entry = typeRegistry.get(typeName);
        if (!entry) throw new Error(`Unknown semantic type: ${typeName}`);
        for (const [targetFunction, variants] of entry.installs || []) {
            for (const variant of variants || []) {
                registry.installVariant(targetFunction, {
                    ...variant,
                    impl(args, context, evaluate) {
                        const result = variant.impl(args, context, evaluate);
                        if (
                            result &&
                            typeof result === "object" &&
                            entry.nativeType &&
                            runtimeTypeName(result) === entry.nativeType
                        ) {
                            return finalizeImportedRegisteredValue(result, entry.name, entry);
                        }
                        return result;
                    },
                    installedByType: entry.name,
                    targetFunction,
                    installOrder: order++,
                });
            }
        }
    }
}

function mapGet(mapValue, key) {
    if (mapValue?.type !== "map" || !(mapValue.entries instanceof Map)) return undefined;
    if (mapValue.entries.has(key)) return mapValue.entries.get(key);
    const lowerKey = key.toLowerCase();
    for (const [entryKey, value] of mapValue.entries) {
        if (String(entryKey).toLowerCase() === lowerKey) return value;
    }
    return undefined;
}

function listNames(value) {
    if (!value) return [];
    if (value.type === "set" || value.type === "sequence" || value.type === "tuple") {
        return value.values.map(colonName).filter(Boolean);
    }
    if (value.type === "map" && value.entries instanceof Map) {
        return Array.from(value.entries.keys());
    }
    return [];
}

function protoFromRixMap(value, context = null) {
    if (!value || value.type !== "map" || !(value.entries instanceof Map)) return value;
    return makeProto(Array.from(value.entries.entries()).map(([key, entry]) => [key, captureHook(entry, context)]));
}

function captureHook(value, context) {
    if (isCallable(value) && context?.getEnv) {
        const captured = new Map();
        for (const key of ["jsImportBaseDir", "scriptBaseDir"]) {
            if (context.env?.has(key)) captured.set(key, context.getEnv(key, undefined));
        }
        Object.defineProperty(value, "__rixCapturedEnv", {
            value: captured,
            configurable: true,
        });
    }
    return value;
}

function hooksFromRixMap(value, context = null) {
    if (!value || value.type !== "map" || !(value.entries instanceof Map)) return {};
    return Object.fromEntries(Array.from(value.entries.entries()).map(([key, entry]) => [key, captureHook(entry, context)]));
}

function isRixList(value) {
    return value?.type === "sequence" || value?.type === "tuple" || value?.type === "set";
}

function callableVariantHook(fn, mode) {
    if (!fn) return mode === "prep" ? null : () => null;
    return (args, context, evaluate) => invokeMaybeCallable(fn, args, context, evaluate);
}

function variantsFromRixList(value, context = null) {
    if (!value) return [];
    const items = isRixList(value) ? value.values : [value];
    return items.map((item, index) => {
        if (!item || item.type !== "map" || !(item.entries instanceof Map)) {
            throw new Error("Type install variants must be map specs");
        }
        const name = colonName(mapGet(item, "name")) || `Variant${index + 1}`;
        return {
            name,
            prep: callableVariantHook(captureHook(mapGet(item, "prep"), context), "prep"),
            impl: callableVariantHook(captureHook(mapGet(item, "impl"), context), "impl"),
        };
    });
}

function installsFromRixMap(value, context = null) {
    if (!value || value.type !== "map" || !(value.entries instanceof Map)) return new Map();
    return new Map(Array.from(value.entries.entries()).map(([targetFunction, variants]) => [
        targetFunction,
        variantsFromRixList(variants, context),
    ]));
}

export function registerTraitFromRixSpec(spec, context = null) {
    if (!spec || spec.type !== "map" || !(spec.entries instanceof Map)) {
        throw new Error("TraitRegister expects a map spec");
    }
    const proto = protoFromRixMap(mapGet(spec, "proto"), context) || makeProto();
    return registerTrait({
        name: colonName(mapGet(spec, "name")),
        implies: listNames(mapGet(spec, "implies")),
        verify: captureHook(mapGet(spec, "verify") || null, context),
        proto: () => proto,
        description: mapGet(spec, "description")?.value ?? "",
    });
}

export function registerTypeFromRixSpec(spec, context = null) {
    if (!spec || spec.type !== "map" || !(spec.entries instanceof Map)) {
        throw new Error("TypeRegister expects a map spec");
    }
    const proto = protoFromRixMap(mapGet(spec, "proto"), context) || makeProto();
    return registerType({
        name: colonName(mapGet(spec, "name")),
        aliases: listNames(mapGet(spec, "aliases")),
        nativeType: colonName(mapGet(spec, "nativeType")),
        parent: colonName(mapGet(spec, "parent")),
        defaultTraits: listNames(mapGet(spec, "defaultTraits")),
        construct: captureHook(mapGet(spec, "construct") || null, context),
        convert: captureHook(mapGet(spec, "convert") || null, context),
        convertFrom: hooksFromRixMap(mapGet(spec, "convertFrom"), context),
        normalize: captureHook(mapGet(spec, "normalize") || null, context),
        validate: captureHook(mapGet(spec, "validate") || null, context),
        export: captureHook(mapGet(spec, "export") || null, context),
        import: captureHook(mapGet(spec, "import") || null, context),
        proto: () => proto,
        installs: installsFromRixMap(mapGet(spec, "installs"), context),
        display: captureHook(mapGet(spec, "display") || null, context),
    });
}

registerBuiltinSemanticTypes();
