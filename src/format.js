import { Rational, RationalInterval } from "@ratmath/core";
import { isHole } from "./hole.js";
import { isTensor, tensorOffsetForTuple, tensorSize } from "./tensor.js";

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

export function formatValue(val) {
    if (isHole(val)) return "undefined";
    if (val === null) return "_";
    if (val === undefined) return "undefined";

    if (typeof val === "object" && val !== null) {
        if (val.type === "string") return val.value;
        if (isTensor(val)) return formatTensor(val, formatValue);
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
        if (val.type === "function" || val.type === "lambda") {
            const params = val.params?.positional?.map((param) => param.name).join(", ") || "";
            if (val.type === "lambda") {
                return `[Lambda: (${params})]`;
            }
            return `[Function: ${val.name || "Anonymous"}(${params})]`;
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
    }

    if (val instanceof Rational) return val.toMixedString();
    if (val instanceof RationalInterval) return val.toMixedString();
    return val.toString();
}
