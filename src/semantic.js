import { Integer, Rational, RationalInterval } from "@ratmath/core";
import { createEvent, getCurrentFilePath, getDiagnostics } from "./diagnostics.js";

function int(value) {
    return new Integer(BigInt(value));
}

function stringObj(value) {
    return { type: "string", value };
}

function mutableExt() {
    return new Map([["_mutable", int(1)]]);
}

function ensureExt(value) {
    if (!value || typeof value !== "object") {
        throw new Error("Semantic metadata requires an object value");
    }
    if (!(value._ext instanceof Map)) {
        value._ext = new Map();
    }
    return value._ext;
}

function makeProto(entries = []) {
    return { type: "map", entries: new Map(entries), _ext: new Map([["frozen", int(1)], ["immutable", int(1)]]) };
}

function traitOrderSequence(names) {
    return { type: "sequence", values: names.map(stringObj), _ext: mutableExt() };
}

export function createTraitSet(names, order = names) {
    return {
        type: "set",
        values: Array.from(new Set(names)).map(stringObj),
        _ext: new Map([["order", traitOrderSequence(order)]]),
    };
}

export function traitNamesFromSet(value) {
    if (!value || value.type !== "set" || !Array.isArray(value.values)) return [];
    return value.values
        .map((entry) => entry?.type === "string" ? entry.value : String(entry))
        .filter(Boolean);
}

export function traitOrderFromSet(value) {
    const explicit = value?._ext?.get("order");
    if (explicit?.type === "sequence") {
        return explicit.values
            .map((entry) => entry?.type === "string" ? entry.value : String(entry))
            .filter(Boolean);
    }
    return traitNamesFromSet(value);
}

function getLabel(value) {
    if (value?.type === "string") return value.value;
    return String(value);
}

function emitWarning(context, label, data = new Map()) {
    if (!context?.getEnv) return;
    const diagnostics = getDiagnostics(context);
    diagnostics.addEvent(createEvent({
        kind: "warning",
        label,
        file: getCurrentFilePath(context),
        data: { type: "map", entries: data },
    }));
}

function cloneHeader(header) {
    return {
        captureMode: header?.captureMode || null,
        name: header?.name || null,
        typeName: header?.typeName || null,
        traits: Array.isArray(header?.traits) ? header.traits.map((trait) => ({ ...trait })) : [],
    };
}

function runtimeTypeName(value) {
    if (value === null) return "null";
    if (value?.type) return value.type;
    if (value?.constructor?.name) return value.constructor.name;
    return typeof value;
}

function valueMethod(name, fn) {
    return { type: "method_builtin", name, impl: fn };
}

const typeRegistry = new Map([
    ["rational", {
        apply(value) {
            if (value instanceof Rational) return value;
            if (value instanceof Integer) return new Rational(value.value, 1n);
            if (value instanceof RationalInterval) {
                if (value.low.equals(value.high)) return value.low;
                return null;
            }
            return null;
        },
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("type:rational"))],
                ["KIND", valueMethod("KIND", () => stringObj("type:rational"))],
            ]);
        },
    }],
    ["oracle", {
        apply(value) {
            if (value?.type === "oracle") return value;
            return { type: "oracle", value };
        },
        proto(value) {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("type:oracle"))],
                ["KIND", valueMethod("KIND", () => stringObj("type:oracle"))],
            ]);
        },
    }],
    ["Length", {
        apply(value) {
            return value;
        },
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("type:length"))],
                ["KIND", valueMethod("KIND", () => stringObj("type:length"))],
            ]);
        },
    }],
    ["Point", {
        apply(value) {
            return value;
        },
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("type:point"))],
            ]);
        },
    }],
    ["Matrix", {
        apply(value) {
            return value;
        },
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("type:matrix"))],
            ]);
        },
    }],
    ["Vector", {
        apply(value) {
            return value;
        },
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("type:vector"))],
                ["KIND", valueMethod("KIND", () => stringObj("type:vector"))],
            ]);
        },
    }],
]);

const traitRegistry = new Map([
    ["meters", {
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("trait:meters"))],
                ["KIND", valueMethod("KIND", () => stringObj("trait:meters"))],
            ]);
        },
    }],
    ["cartesian", {
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("trait:cartesian"))],
            ]);
        },
    }],
    ["square", {
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("trait:square"))],
            ]);
        },
    }],
    ["positive", {
        proto() {
            return makeProto([
                ["Describe", valueMethod("Describe", () => stringObj("trait:positive"))],
            ]);
        },
    }],
    ["verify", {
        proto() {
            return makeProto();
        },
    }],
]);

export const traitChecks = new Map([
    ["positive", (value) => {
        if (value instanceof Integer) return value.value > 0n;
        if (typeof value === "number" || typeof value === "bigint") return Number(value) > 0;
        if (value?.type === "oracle") return traitChecks.get("positive")(value.value);
        return true;
    }],
]);

export function refreshSemanticProto(value) {
    const ext = ensureExt(value);
    const typeName = ext.get("__type")?.value ?? null;
    const traitsValue = ext.get("__traits") ?? null;
    const traitOrder = traitOrderFromSet(traitsValue);

    const typeLayer = typeName ? (typeRegistry.get(typeName)?.proto?.(value) ?? makeProto()) : null;
    const traitEntries = new Map();
    for (const traitName of traitOrder) {
        const traitLayer = traitRegistry.get(traitName)?.proto?.(value);
        if (!traitLayer?.entries) continue;
        for (const [key, entry] of traitLayer.entries) {
            traitEntries.set(key, entry);
        }
    }
    const traitsLayer = makeProto(Array.from(traitEntries.entries()));
    ext.set("__proto", makeProto([
        ["type", typeLayer],
        ["traits", traitsLayer],
    ]));
    return ext.get("__proto");
}

export function refreshRuntimeMetadata(value, builtinProto = null) {
    const ext = ensureExt(value);
    ext.set("_type", stringObj(runtimeTypeName(value)));
    ext.set("_proto", builtinProto ?? ext.get("_proto") ?? null);
    return value;
}

function shouldValidateTraits(context, value) {
    const globalValidate = context?.getEnv?.("validateTraits", false);
    const hasVerify = traitNamesFromSet(value?._ext?.get("__traits")).includes("verify");
    return globalValidate || hasVerify;
}

export function checkTraits(value, context, { warnOnly = false } = {}) {
    const traits = traitOrderFromSet(value?._ext?.get("__traits"));
    for (const traitName of traits) {
        if (traitName === "verify") continue;
        const check = traitChecks.get(traitName);
        if (!check) continue;
        if (!check(value)) {
            if (warnOnly) {
                emitWarning(context, `Trait check failed: ${traitName}`, new Map([["trait", stringObj(traitName)]]));
                return null;
            }
            throw new Error(`Trait check failed: ${traitName}`);
        }
    }
    return int(1);
}

function applyType(header, value) {
    const typeName = header.typeName;
    if (!typeName) return value;
    const handler = typeRegistry.get(typeName);
    if (!handler?.apply) {
        throw new Error(`Unknown semantic type: ${typeName}`);
    }
    const nextValue = handler.apply(value);
    if (nextValue === null || nextValue === undefined) {
        throw new Error(`Cannot convert value to semantic type ${typeName}`);
    }
    return nextValue;
}

export function valueSatisfiesTrait(value, traitName) {
    if (traitOrderFromSet(value?._ext?.get("__traits")).includes(traitName)) {
        return true;
    }
    const check = traitChecks.get(traitName);
    if (!check) {
        return false;
    }
    return Boolean(check(value));
}

export function readStickyHeader(value) {
    const ext = value?._ext;
    if (!(ext instanceof Map)) return cloneHeader(null);
    return {
        captureMode: null,
        name: ext.get("__name")?.value ?? null,
        typeName: ext.get("__type")?.value ?? null,
        traits: traitOrderFromSet(ext.get("__traits")).map((name, order) => ({ name, checkMode: null, order })),
    };
}

export function mergeStickyHeader(baseHeader, overrideHeader) {
    const base = cloneHeader(baseHeader);
    const override = cloneHeader(overrideHeader);
    return {
        captureMode: override.captureMode ?? base.captureMode ?? null,
        name: override.name ?? base.name ?? null,
        typeName: override.typeName ?? base.typeName ?? null,
        traits: override.traits.length > 0 ? override.traits : base.traits,
    };
}

export function applySemanticHeader(value, header, context, options = {}) {
    const effectiveHeader = cloneHeader(header);
    if (!value || typeof value !== "object") {
        throw new Error("Cannot outfit a non-object value");
    }

    const previous = readStickyHeader(value);
    let nextValue = value;
    nextValue = applyType(effectiveHeader, nextValue);

    const ext = ensureExt(nextValue);
    if (effectiveHeader.name) {
        ext.set("__name", stringObj(effectiveHeader.name));
    } else if (options.inheritMissing && previous.name) {
        ext.set("__name", stringObj(previous.name));
    }

    const nextTypeName = effectiveHeader.typeName ?? (options.inheritMissing ? previous.typeName : null);
    if (nextTypeName) {
        ext.set("__type", stringObj(nextTypeName));
    }

    const nextTraits = effectiveHeader.traits.length > 0
        ? effectiveHeader.traits.map((trait) => trait.name)
        : (options.inheritMissing ? previous.traits.map((trait) => trait.name) : []);
    if (nextTraits.length > 0) {
        ext.set("__traits", createTraitSet(nextTraits, nextTraits));
    }

    if (
        options.warnOnTypeChange &&
        previous.typeName &&
        nextTypeName &&
        previous.typeName !== nextTypeName &&
        nextTraits.length > 0
    ) {
        emitWarning(context, "Semantic type changed while traits were preserved", new Map([
            ["from", stringObj(previous.typeName)],
            ["to", stringObj(nextTypeName)],
        ]));
    }

    refreshSemanticProto(nextValue);
    if (shouldValidateTraits(context, nextValue)) {
        checkTraits(nextValue, context);
    }
    return nextValue;
}

export function applyUpdateSemantics(oldValue, newValue, context) {
    const inherited = readStickyHeader(oldValue);
    if (!inherited.name && !inherited.typeName && inherited.traits.length === 0) {
        return newValue;
    }
    return applySemanticHeader(newValue, inherited, context, { inheritMissing: true });
}

export function rebuildSemanticMetadata(value, context) {
    refreshSemanticProto(value);
    if (shouldValidateTraits(context, value)) {
        checkTraits(value, context);
    }
    return value;
}
