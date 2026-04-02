import { Integer } from "@ratmath/core";
import { attachBuiltinProto } from "./methods.js";
import { createEvent, getCurrentFilePath, getDiagnostics } from "./diagnostics.js";
import { runtimeDefaults } from "./runtime-config.js";

function stringObj(value) {
    return { type: "string", value };
}

function ensureExt(value) {
    if (!value || typeof value !== "object") {
        throw new Error("Multifunctions must be sequence values");
    }
    if (!value._ext) {
        value._ext = new Map();
    }
    return value._ext;
}

function getWarningsConfig(context) {
    return context?.getEnv?.("warnings", runtimeDefaults.warnings) ?? runtimeDefaults.warnings;
}

function emitWarning(context, label, data = new Map()) {
    if (!context?.getEnv) return;
    getDiagnostics(context).addEvent(createEvent({
        kind: "warning",
        label,
        file: getCurrentFilePath(context),
        data: { type: "map", entries: data },
    }));
}

function ensureState(value) {
    if (!value.__multifunction__) {
        Object.defineProperty(value, "__multifunction__", {
            value: {
                namedVariants: new Map(),
            },
            writable: true,
            configurable: true,
            enumerable: false,
        });
    }
    return value.__multifunction__;
}

function canonicalVariantKey(name) {
    return String(name).toUpperCase();
}

export function isMultifunctionValue(value) {
    return Boolean(
        value &&
        value.type === "sequence" &&
        value._ext instanceof Map &&
        value._ext.get("_type")?.value === "multifunction"
    );
}

export function markAsMultifunction(value) {
    if (!value || value.type !== "sequence" || !Array.isArray(value.values)) {
        throw new Error("Only arrays/sequences can be marked as multifunctions");
    }
    attachBuiltinProto(value);
    const ext = ensureExt(value);
    ext.set("_type", stringObj("multifunction"));
    ensureState(value);
    return value;
}

export function maybeAutoMarkMultifunction(name, value) {
    if (!/^[A-Z]/.test(name || "")) {
        return value;
    }
    if (!value || value.type !== "sequence" || !Array.isArray(value.values)) {
        return value;
    }
    const marked = markAsMultifunction(value);
    if (!marked.__name) {
        marked.__name = name;
    }
    return marked;
}

export function createMultifunctionValue(variants) {
    return markAsMultifunction({
        type: "sequence",
        values: [...variants],
        _ext: new Map([["_mutable", new Integer(1n)]]),
    });
}

export function rebuildMultifunctionState(value) {
    if (!isMultifunctionValue(value)) {
        return null;
    }
    const state = ensureState(value);
    const namedVariants = new Map();
    for (let index = 0; index < value.values.length; index++) {
        const variant = value.values[index];
        const name = variant?.__name;
        if (variant && typeof variant === "object") {
            variant.__parentMultifunction = value;
        }
        if (!name) continue;
        const key = canonicalVariantKey(name);
        if (namedVariants.has(key)) {
            throw new Error(`Duplicate multifunction variant name: ${name}`);
        }
        namedVariants.set(key, variant);
    }
    state.namedVariants = namedVariants;
    return state;
}

export function getNamedMultifunctionVariant(value, name) {
    const state = rebuildMultifunctionState(value);
    if (!state) {
        return null;
    }
    return state.namedVariants.get(canonicalVariantKey(name)) ?? null;
}

export function appendMultifunctionVariant(currentValue, variant, mode, context, ownerName = null) {
    if (currentValue === undefined) {
        const created = createMultifunctionValue([variant]);
        rebuildMultifunctionState(created);
        return created;
    }

    if (isMultifunctionValue(currentValue)) {
        if (mode === "prepend") {
            currentValue.values.unshift(variant);
        } else {
            currentValue.values.push(variant);
        }
        rebuildMultifunctionState(currentValue);
        return currentValue;
    }

    const callableKinds = new Set(["function", "lambda"]);
    if (currentValue && callableKinds.has(currentValue.type)) {
        if (getWarningsConfig(context)?.multifunctionConversion === true) {
            emitWarning(context, "Converted function to multifunction", new Map([
                ["name", stringObj(ownerName || currentValue.name || "<anonymous>")],
            ]));
        }
        const variants = mode === "prepend"
            ? [variant, currentValue]
            : [currentValue, variant];
        const created = createMultifunctionValue(variants);
        rebuildMultifunctionState(created);
        return created;
    }

    throw new Error(`${ownerName || "Value"} is not a function or multifunction`);
}

export function shouldWarnNoPrep(context) {
    return getWarningsConfig(context)?.multifunctionNoPrep === true;
}

export function emitNoPrepWarning(context, multifnName, index, variantName) {
    emitWarning(context, "Multifunction variant without prep is not last", new Map([
        ["function", stringObj(multifnName || "<anonymous>")],
        ["variantIndex", new Integer(BigInt(index + 1))],
        ...(variantName ? [["variantName", stringObj(variantName)]] : []),
    ]));
}
