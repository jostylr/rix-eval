import { Integer } from "@ratmath/core";

function createFrozenMeta() {
    return new Map([
        ["frozen", new Integer(1n)],
        ["immutable", new Integer(1n)],
    ]);
}

function createBuiltinProto(entries) {
    return {
        type: "map",
        entries: new Map(entries),
        _ext: createFrozenMeta(),
    };
}

const SEQUENCE_PROTO = createBuiltinProto([
    ["PUSH", { type: "sysref", name: "PUSH" }],
    ["PUSH!", { type: "sysref", name: "PUSH!" }],
]);

export function isCallableValue(value) {
    return (
        typeof value === "function" ||
        (value &&
            (value.type === "function" ||
                value.type === "lambda" ||
                value.type === "sysref" ||
                value.type === "partial" ||
                value.type === "arityCap"))
    );
}

function ensureCallableMethod(value, name) {
    if (!isCallableValue(value)) {
        throw new Error(`Method "${name}" is not callable`);
    }
    return value;
}

function resolveFromProto(proto, candidates, methodName) {
    if (proto === null || proto === undefined) return null;
    if (proto.type !== "map" || !(proto.entries instanceof Map)) {
        throw new Error("Method prototype must be a map or null");
    }

    for (const candidate of candidates) {
        if (proto.entries.has(candidate)) {
            return ensureCallableMethod(proto.entries.get(candidate), methodName);
        }
    }
    return null;
}

export function resolveMethod(target, name) {
    const ext = target?._ext;
    const candidates = [name, `__${name}`, `_${name}`];

    if (ext instanceof Map) {
        for (const candidate of candidates) {
            if (ext.has(candidate)) {
                return ensureCallableMethod(ext.get(candidate), name);
            }
        }
    }

    const proto = ext instanceof Map ? ext.get("_proto") : undefined;
    const resolved = resolveFromProto(proto, candidates, name);
    if (resolved) {
        return resolved;
    }

    throw new Error(`Method not found: ${name}`);
}

export function ensureMutableReceiver(target) {
    const ext = target?._ext;
    if (!ext?.get("_mutable") || ext.get("frozen") || ext.get("immutable")) {
        throw new Error("Cannot mutate immutable value");
    }
}

export function attachBuiltinProto(value) {
    if (!value || typeof value !== "object") return value;
    if (value.type !== "sequence") return value;
    if (!value._ext) value._ext = new Map();
    if (!value._ext.has("_proto")) {
        value._ext.set("_proto", SEQUENCE_PROTO);
    }
    return value;
}
