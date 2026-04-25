import { Integer, Rational, RationalInterval } from "@ratmath/core";
import { createEvent, getCurrentFilePath, getDiagnostics } from "./diagnostics.js";
import {
    convertToRegisteredType,
    makeProto,
    registerBuiltinSemanticTypes,
    resolveTraitNames,
    runtimeTypeName,
    stringObj,
    traitRegistry,
    typeRegistry,
    valueMethod,
} from "./type-system.js";

registerBuiltinSemanticTypes();

function int(value) {
    return new Integer(BigInt(value));
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

function summarizeValue(value) {
    if (value === null) return "_";
    if (value instanceof Integer || value instanceof Rational || value instanceof RationalInterval) {
        return value.toString();
    }
    if (value?.type === "string") return JSON.stringify(value.value);
    if (value?.type) return `<${value.type}>`;
    return getLabel(value);
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

export const traitChecks = new Map([
    ["positive", (value) => {
        if (value instanceof Integer) return value.value > 0n;
        if (typeof value === "number" || typeof value === "bigint") return Number(value) > 0;
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
    const result = convertToRegisteredType(value, typeName);
    if (result === null) {
        throw new Error(`Cannot convert value to semantic type ${typeName}`);
    }
    return result.value;
}

export function valueHasSemanticMembership(value, name) {
    const ext = value?._ext;
    if (!(ext instanceof Map) || !name) {
        return false;
    }

    if (ext.get("__type")?.value === name) {
        return true;
    }
    if (ext.get("_type")?.value === name) {
        return true;
    }
    return traitNamesFromSet(ext.get("__traits")).includes(name);
}

export function convertSemanticType(value, typeName, context, { strict = true, warnOnFailure = false } = {}) {
    const header = {
        captureMode: null,
        name: null,
        typeName,
        traits: [],
    };
    const effectiveHeader = mergeStickyHeader(readStickyHeader(value), header);

    try {
        return applySemanticHeader(value, effectiveHeader, context, {
            inheritMissing: true,
            warnOnTypeChange: true,
        });
    } catch (error) {
        if (error.message === `Unknown semantic type: ${typeName}`) {
            throw error;
        }
        if (strict) {
            throw error;
        }
        if (warnOnFailure) {
            const ext = value?._ext instanceof Map ? value._ext : null;
            const data = new Map([
                ["requestedType", stringObj(typeName)],
                ["sourceSummary", stringObj(summarizeValue(value))],
            ]);

            const runtimeType = ext?.get("_type");
            if (runtimeType) data.set("sourceType", runtimeType);
            const semanticType = ext?.get("__type");
            if (semanticType) data.set("sourceSemanticType", semanticType);
            const traits = ext?.get("__traits");
            if (traits) data.set("sourceTraits", traits);

            emitWarning(context, "conversion failed", data);
        }
        return null;
    }
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

    const explicitTraits = effectiveHeader.traits.length > 0
        ? effectiveHeader.traits.map((trait) => trait.name)
        : (options.inheritMissing ? previous.traits.map((trait) => trait.name) : []);
    const typeDefaultTraits = nextTypeName ? (typeRegistry.get(nextTypeName)?.defaultTraits || []) : [];
    const nextTraits = resolveTraitNames([...typeDefaultTraits, ...explicitTraits]);
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
