/**
 * IR to Text Serializer
 *
 * Converts IR trees { fn, args } into human-readable system function call text.
 *
 * Default mode:    ADD(LITERAL("3"), LITERAL("4"))
 * Language mode:   @_ADD(@_LITERAL("3"), @_LITERAL("4"))
 */

/**
 * Serialize an IR node to human-readable text.
 *
 * @param {Object|string|number|null} node - IR node or literal value
 * @param {Object} [options]
 * @param {boolean} [options.langPrefix=false] - If true, prefix function names with @_
 * @param {number} [options.indent=0] - Indentation level for pretty printing
 * @param {boolean} [options.pretty=false] - If true, format with newlines/indentation
 * @returns {string}
 */
export function irToText(node, options = {}) {
    const { langPrefix = false, indent = 0, pretty = false } = options;
    const prefix = langPrefix ? "@_" : "";
    const indentStr = pretty ? "  ".repeat(indent) : "";

    if (node === null || node === undefined) {
        return "null";
    }

    if (typeof node === "string") {
        return JSON.stringify(node);
    }

    if (typeof node === "number" || typeof node === "bigint") {
        return String(node);
    }

    if (typeof node === "boolean") {
        return String(node);
    }

    // Arrays (e.g. param structures)
    if (Array.isArray(node)) {
        const items = node.map((item) =>
            irToText(item, { langPrefix, indent: indent + 1, pretty }),
        );
        return `[${items.join(", ")}]`;
    }

    // IR node: { fn, args }
    if (node.fn) {
        const fnName = `${prefix}${node.fn}`;
        const argTexts = node.args.map((arg) =>
            irToText(arg, { langPrefix, indent: indent + 1, pretty }),
        );

        if (pretty && argTexts.length > 0 && argTexts.join(", ").length > 60) {
            const innerIndent = "  ".repeat(indent + 1);
            return `${fnName}(\n${argTexts.map((a) => `${innerIndent}${a}`).join(",\n")}\n${indentStr})`;
        }

        return `${fnName}(${argTexts.join(", ")})`;
    }

    // Plain objects (params, mutation ops, metadata, etc.)
    if (typeof node === "object") {
        return serializeObject(node, { langPrefix, indent, pretty });
    }

    return String(node);
}

/**
 * Serialize a plain object (params, etc.) to text.
 */
function serializeObject(obj, options) {
    const { langPrefix, indent, pretty } = options;
    const entries = Object.entries(obj).map(([key, value]) => {
        const valText = irToText(value, {
            langPrefix,
            indent: indent + 1,
            pretty,
        });
        return `${key}: ${valText}`;
    });
    return `{${entries.join(", ")}}`;
}

/**
 * Serialize an array of IR nodes (e.g. from lower()) to text.
 * Each node is on its own line.
 * Nodes that are NOP, Comment, or null are filtered out.
 * Unhandled nodes (BINOP, etc.) are shown as warning comments.
 */
export function irListToText(irNodes, options = {}) {
    if (!Array.isArray(irNodes)) {
        return irToText(irNodes, options);
    }
    const prefix = options.langPrefix ? "@_" : "";
    const lines = [];
    for (const node of irNodes) {
        // Skip null/undefined
        if (node === null || node === undefined) continue;
        // Skip Comment nodes (lowered to NOP)
        if (node.fn === "NOP") continue;
        if (node.type === "Comment") continue;
        // Warn about unhandled BINOP nodes
        if (node.fn === "BINOP") {
            const op = node.args?.[0] ?? "?";
            lines.push(`# PARSE WARNING: unrecognized operator "${op}" — check syntax near this position`);
            continue;
        }
        const text = irToText(node, options);
        if (text === "null" || text === `${prefix}NOP()`) continue;
        lines.push(text);
    }
    return lines.join("\n");
}

