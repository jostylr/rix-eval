import { Rational, RationalInterval } from "@ratmath/core";
import { isHole } from "./hole.js";
import { isTensor, tensorOffsetForTuple, tensorSize } from "./tensor.js";
import { irToText } from "./ir-to-text.js";

function tensorValueAtTuple(tensor, tuple) {
    const value = tensor.data[tensorOffsetForTuple(tensor, tuple)];
    return value;
}

function tensorDisplayLevels(shape) {
    if (shape.length === 0) return [];
    if (shape.length === 1) {
        return [{ size: shape[0], separatorCount: 0 }];
    }

    const levels = [];
    for (let axis = shape.length - 1; axis >= 2; axis--) {
        levels.push({ size: shape[axis], separatorCount: axis });
    }
    levels.push({ size: shape[0], separatorCount: 1 });
    levels.push({ size: shape[1], separatorCount: 0 });
    return levels;
}

function displayPathToExternalTuple(displayPath) {
    if (displayPath.length === 1) {
        return [displayPath[0]];
    }

    const higher = displayPath.slice(0, -2).reverse();
    return [displayPath[displayPath.length - 2], displayPath[displayPath.length - 1], ...higher];
}

function tensorSeparator(separatorCount) {
    if (separatorCount <= 0) return ", ";
    if (separatorCount === 1) return "; ";
    return ` ${";".repeat(separatorCount)} `;
}

function formatTensorBody(tensor, formatValue, levels, levelIndex = 0, displayPath = []) {
    const level = levels[levelIndex];

    if (level.separatorCount === 0) {
        const values = [];
        for (let i = 1; i <= level.size; i++) {
            const tuple = displayPathToExternalTuple([...displayPath, i]);
            values.push(formatValue(tensorValueAtTuple(tensor, tuple)));
        }
        return values.join(", ");
    }

    const parts = [];
    for (let i = 1; i <= level.size; i++) {
        parts.push(formatTensorBody(tensor, formatValue, levels, levelIndex + 1, [...displayPath, i]));
    }
    return parts.join(tensorSeparator(level.separatorCount));
}

function formatTensor(tensor, formatValue) {
    const shapeText = tensor.shape.join("x");
    if (tensorSize(tensor) === 0) {
        return `{:${shapeText}:}`;
    }
    const levels = tensorDisplayLevels(tensor.shape);
    return `{:${shapeText}: ${formatTensorBody(tensor, formatValue, levels)} }`;
}

function truncate(text, limit = 40) {
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

const BINARY_OPS = new Map([
    ["ADD", "+"],
    ["SUB", "-"],
    ["MUL", "*"],
    ["DIV", "/"],
    ["INTDIV", "//"],
    ["MOD", "%"],
    ["POW", "^"],
    ["EQ", "=="],
    ["NEQ", "!="],
    ["LT", "<"],
    ["GT", ">"],
    ["LTE", "<="],
    ["GTE", ">="],
    ["AND", "&&"],
    ["OR", "||"],
]);

function previewIr(node, options = {}) {
    const { maxLen = 40, depth = 0 } = options;
    if (node === null) return "_";
    if (node === undefined) return "undefined";
    if (typeof node === "string") return node;
    if (typeof node === "number" || typeof node === "bigint" || typeof node === "boolean") {
        return String(node);
    }
    if (Array.isArray(node)) {
        return truncate(`[${node.map((item) => previewIr(item, { maxLen: 12, depth: depth + 1 })).join(", ")}]`, maxLen);
    }
    if (!node || typeof node !== "object") {
        return truncate(String(node), maxLen);
    }
    if (!node.fn) {
        return truncate(irToText(node), maxLen);
    }

    if (depth >= 5) {
        return truncate(irToText(node), maxLen);
    }

    switch (node.fn) {
    case "LITERAL":
        return String(node.args[0]);
    case "STRING":
        return JSON.stringify(node.args[0]);
    case "NULL":
        return "_";
    case "RETRIEVE":
        return node.args[0];
    case "OUTER_RETRIEVE":
        return `@${node.args[0]}`;
    case "SELF":
        return "$";
    case "PARENT_SELF":
        return "$$";
    case "NEG":
        return truncate(`-${previewIr(node.args[0], { maxLen: maxLen - 1, depth: depth + 1 })}`, maxLen);
    case "CALL":
        return truncate(
            `${node.args[0]}(${node.args.slice(1).map((arg) => previewIr(arg, { maxLen: 16, depth: depth + 1 })).join(", ")})`,
            maxLen,
        );
    case "CALL_EXPR":
        return truncate(
            `${previewIr(node.args[0], { maxLen: 14, depth: depth + 1 })}(${node.args.slice(1).map((arg) => previewIr(arg, { maxLen: 12, depth: depth + 1 })).join(", ")})`,
            maxLen,
        );
    case "BLOCK": {
        const start = node.args[0]?.kind === "block_meta" ? 1 : 0;
        const statements = node.args
            .slice(start)
            .map((stmt) => previewIr(stmt, { maxLen: 18, depth: depth + 1 }));
        return truncate(`{ ${statements.join("; ")} }`, maxLen);
    }
    case "ASSIGN":
    case "ASSIGN_COPY":
    case "ASSIGN_UPDATE":
    case "ASSIGN_DEEP_COPY":
    case "ASSIGN_DEEP_UPDATE":
    case "OUTER_ASSIGN":
        return truncate(`${node.args[0]} = ${previewIr(node.args[1], { maxLen: Math.max(12, maxLen - String(node.args[0]).length - 3), depth: depth + 1 })}`, maxLen);
    case "ASSIGN_EXPR":
        return truncate(
            `${previewIr(node.args[0], { maxLen: 12, depth: depth + 1 })} = ${previewIr(node.args[1], { maxLen: 16, depth: depth + 1 })}`,
            maxLen,
        );
    case "OUTER_UPDATE":
        return truncate(`@${node.args[0]} ~= ${previewIr(node.args[1], { maxLen: Math.max(12, maxLen - String(node.args[0]).length - 5), depth: depth + 1 })}`, maxLen);
    default:
        break;
    }

    const op = BINARY_OPS.get(node.fn);
    if (op && node.args.length >= 2) {
        return truncate(
            `${previewIr(node.args[0], { maxLen: 14, depth: depth + 1 })} ${op} ${previewIr(node.args[1], { maxLen: 14, depth: depth + 1 })}`,
            maxLen,
        );
    }

    return truncate(irToText(node), maxLen);
}

function formatCallablePreview(fn, label) {
    const params = fn.params?.positional?.map((param) => param.isRest ? `...${param.name}` : param.name).join(", ") || "";
    const prepEntries = [
        ...(Array.isArray(fn.params?.conditionals) ? fn.params.conditionals : []),
        ...(Array.isArray(fn.params?.prep) ? fn.params.prep : []),
    ];
    const prepText = prepEntries.length > 0
        ? ` ${fn.params?.prepStrict ? "?!-" : "?-"} [${truncate(prepEntries.map((entry) => previewIr(entry, { maxLen: 18 })).join(", "), 42)}]`
        : "";
    const bodyText = previewIr(fn.body, { maxLen: 48 });
    const displayName = fn.__name || fn.name || null;
    const nameText = displayName ? ` ${displayName}:` : ":";
    return `[${label}${nameText} (${params})${prepText} -> ${bodyText}]`;
}

function formatMultifunctionPreview(multifn) {
    const displayName = multifn.__name || null;
    const variants = (multifn.values || []).map((variant, index) => {
        if (!variant || (variant.type !== "function" && variant.type !== "lambda")) {
            return `#${index + 1}: <invalid>`;
        }
        const params = variant.params?.positional?.map((param) => param.isRest ? `...${param.name}` : param.name).join(", ") || "";
        const prepEntries = [
            ...(Array.isArray(variant.params?.conditionals) ? variant.params.conditionals : []),
            ...(Array.isArray(variant.params?.prep) ? variant.params.prep : []),
        ];
        const prepText = prepEntries.length > 0
            ? ` ${variant.params?.prepStrict ? "?!-" : "?-"} [${truncate(prepEntries.map((entry) => previewIr(entry, { maxLen: 12 })).join(", "), 24)}]`
            : "";
        const variantName = variant.__name ? `/${variant.__name}/ ` : "";
        const bodyText = previewIr(variant.body, { maxLen: 20 });
        return `${variantName}(${params})${prepText} -> ${bodyText}`;
    });
    if (variants.length === 0) {
        return displayName ? `[Multifunction ${displayName}: empty]` : "[Multifunction: empty]";
    }
    const prefix = displayName ? `[Multifunction ${displayName}:\n` : "[Multifunction:\n";
    return `${prefix}${variants.map((variant) => `${variant},`).join("\n")}\n]`;
}

export function formatValue(val) {
    if (isHole(val)) return "undefined";
    if (val === null) return "_";
    if (val === undefined) return "undefined";

    if (typeof val === "object" && val !== null) {
        if (val.type === "string") return val.value;
        if (isTensor(val)) return formatTensor(val, formatValue);
        if (val.type === "sequence" && val._ext instanceof Map && val._ext.get("_type")?.value === "multifunction") {
            return formatMultifunctionPreview(val);
        }
        if (val.type === "sequence") {
            const open = val.kind === "set" ? "{| " : val.kind === "tuple" ? "( " : "[";
            const close = val.kind === "set" ? " |}" : val.kind === "tuple" ? " )" : "]";
            const items = val.values || val.elements || [];
            return open + items.map(formatValue).join(", ") + close;
        }
        if (val.type === "set" || val.type === "tuple") {
            const open = val.type === "set" ? "{| " : "( ";
            const close = val.type === "set" ? " |}" : " )";
            return open + val.values.map(formatValue).join(", ") + close;
        }
        if (val.type === "map") {
            const entries = [];
            const mapObj = val.entries || val.elements || new Map();
            mapObj.forEach((entryValue, key) => {
                entries.push(`${key}=${formatValue(entryValue)}`);
            });
            return `{= ${entries.join(", ")} }`;
        }
        if (val.type === "export_bundle") {
            const entries = [];
            const mapObj = val.entries || new Map();
            mapObj.forEach((cell, key) => {
                entries.push(`${key}=${formatValue(cell?.value)}`);
            });
            return `{= ${entries.join(", ")} }`;
        }
        if (val.type === "function" || val.type === "lambda") {
            return formatCallablePreview(val, val.type === "lambda" ? "Lambda" : "Function");
        }
        if (val.type === "pattern_function") {
            return `[PatternFunction: ${val.name || "Anonymous"}]`;
        }
        if (val.type === "system_context") {
            const names = val.context.getAllNames();
            const frozenMark = val.context.frozen ? " frozen" : " mutable";
            return `[SystemContext${frozenMark}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""}]`;
        }
        if (val.type === "sysref") {
            return `[SystemFunction: ${val.name}]`;
        }
        if (val.type === "partial") {
            const arity = (val.template || []).reduce(
                (max, templateValue) =>
                    (templateValue && templateValue.type === "placeholder")
                        ? Math.max(max, templateValue.index)
                        : max,
                0,
            );
            return `[Partial: ${arity}]`;
        }
        if (val.type === "interval") {
            return `${val.start || val.lo}:${val.end || val.hi}`;
        }
        if (val.fn === "DEFER") {
            const inner = val.args && val.args[0];
            const kind = inner ? (inner.fn || inner.type || "AST") : "AST";
            return `[Deferred ${kind}]`;
        }
    }

    if (val instanceof Rational) return val.toMixedString();
    if (val instanceof RationalInterval) return val.toMixedString();
    return val.toString();
}
