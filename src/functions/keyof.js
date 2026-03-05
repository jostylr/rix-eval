import { Integer } from "@ratmath/core";

function normalizeKeyPrimitive(value) {
    if (typeof value === "string") return value;
    if (value && value.type === "string") return value.value;
    if (value instanceof Integer) return value.value.toString();
    if (typeof value === "number" || typeof value === "bigint") return String(value);
    return null;
}

/**
 * KEYOF(x) -> canonical string map key.
 * - string: direct
 * - integer: canonical integer string
 * - otherwise: use x.key meta property (string/integer only)
 */
export function keyOf(value) {
    const direct = normalizeKeyPrimitive(value);
    if (direct !== null) return direct;

    const meta = value?._ext;
    const metaKey = meta instanceof Map ? meta.get("key") : null;
    if (metaKey === null || metaKey === undefined) {
        throw new Error("Value cannot be used as a map key (not string/int and no .key property)");
    }

    const normalizedMeta = normalizeKeyPrimitive(metaKey);
    if (normalizedMeta === null) {
        throw new Error("Invalid .key type; must be string or integer");
    }
    return normalizedMeta;
}

/**
 * Canonicalize a meta .key assignment value.
 */
export function canonicalizeMetaKey(value) {
    const normalized = normalizeKeyPrimitive(value);
    if (normalized === null) {
        throw new Error("Invalid .key type; must be string or integer");
    }
    return normalized;
}

