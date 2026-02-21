/**
 * Core system functions: LITERAL, STRING, NULL, RETRIEVE, ASSIGN, NOP, SYSREF, GLOBAL
 */

import { Integer, Rational, RationalInterval } from "@ratmath/core";

/**
 * Parse a number literal string into a ratmath type.
 * Uses a simplified parser for common cases; the full packages/parser
 * can be plugged in later for complex formats.
 */
function parseLiteral(str) {
    if (typeof str !== "string") return str;

    // Integer
    if (/^-?\d+$/.test(str)) {
        return new Integer(str);
    }

    // Rational: a/b or -a/b
    const ratMatch = str.match(/^(-?\d+)\/(\d+)$/);
    if (ratMatch) {
        return new Rational(BigInt(ratMatch[1]), BigInt(ratMatch[2]));
    }

    // Mixed number: a..b/c
    const mixedMatch = str.match(/^(-?\d+)\.\.(\d+)\/(\d+)$/);
    if (mixedMatch) {
        const whole = BigInt(mixedMatch[1]);
        const num = BigInt(mixedMatch[2]);
        const den = BigInt(mixedMatch[3]);
        const sign = whole < 0n ? -1n : 1n;
        const absWhole = whole < 0n ? -whole : whole;
        return new Rational(sign * (absWhole * den + num), den);
    }

    // Decimal
    if (/^-?\d+\.\d+$/.test(str)) {
        const parts = str.split(".");
        const sign = parts[0].startsWith("-") ? -1n : 1n;
        const intPart = parts[0].startsWith("-") ? parts[0].slice(1) : parts[0];
        const fracPart = parts[1];
        const den = 10n ** BigInt(fracPart.length);
        const num = sign * (BigInt(intPart) * den + BigInt(fracPart));
        return new Rational(num, den);
    }

    // Hex: 0xFF
    if (/^0[xX][0-9a-fA-F]+$/.test(str)) {
        return new Integer(BigInt(str));
    }

    // Binary: 0b101
    if (/^0[bB][01]+$/.test(str)) {
        return new Integer(BigInt(str));
    }

    // Octal: 0o77
    if (/^0[oO][0-7]+$/.test(str)) {
        return new Integer(BigInt(str));
    }

    // Fallback: try as integer
    try {
        return new Integer(str);
    } catch {
        // Return as string if we can't parse it
        return str;
    }
}

export const coreFunctions = {
    LITERAL: {
        impl(args) {
            return parseLiteral(args[0]);
        },
        pure: true,
        doc: "Parse a number literal string into a ratmath type",
    },

    STRING: {
        impl(args) {
            return { type: "string", value: args[0] };
        },
        pure: true,
        doc: "Create a string value",
    },

    NULL: {
        impl() {
            return null;
        },
        pure: true,
        doc: "Null value",
    },

    NOP: {
        impl() {
            return null;
        },
        pure: true,
        doc: "No operation",
    },

    RETRIEVE: {
        impl(args, context) {
            const name = args[0];
            const value = context.get(name);
            if (value === undefined) {
                throw new Error(`Undefined variable: ${name}`);
            }
            return value;
        },
        doc: "Look up a variable in the current scope chain",
    },

    ASSIGN: {
        lazy: true,
        impl(args, context, evaluate) {
            // args[0] is the variable name (raw string from IR)
            // args[1] is the value expression (IR node to evaluate)
            const name = args[0];
            const value = evaluate(args[1]);
            context.set(name, value);
            return value;
        },
        doc: "Assign a value to a variable in the current scope",
    },

    GLOBAL: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = args[0];
            const value = evaluate(args[1]);
            context.setGlobal(name, value);
            return value;
        },
        doc: "Assign a value to a variable in the global scope",
    },

    SYSREF: {
        impl(args, context) {
            // Return a reference to a system function by name
            const name = args[0];
            return { type: "sysref", name };
        },
        pure: true,
        doc: "Reference to a system function",
    },

    PLACEHOLDER: {
        impl(args) {
            return { type: "placeholder", index: args[0] };
        },
        pure: true,
        doc: "Placeholder for pattern matching",
    },

    COMMAND: {
        lazy: true,
        impl(args, context, evaluate) {
            // REPL commands like HELP, LOAD, UNLOAD
            // The parser sometimes produces COMMAND nodes for prefix operators
            // like NOT when used at statement level. We handle this by trying
            // to dispatch to the registry if the command name is a known function.
            const name = args[0];
            const evalArgs = args.slice(1).map(a => evaluate(a));

            // Try to dispatch as a system function call
            // The evaluate callback has registry access, so we construct
            // an IR node and evaluate it
            const irNode = { fn: name, args: args.slice(1) };
            try {
                return evaluate(irNode);
            } catch {
                // If the function isn't found, return as a command descriptor
                return { type: "command", name, args: evalArgs };
            }
        },
        doc: "REPL command dispatch (also handles parser-generated operator commands)",
    },

    ASSIGN_EXPR: {
        lazy: true,
        impl(args, context, evaluate) {
            // Like ASSIGN, but used when the target is an expression (e.g. _1 = expr)
            // args[0] = target (could be a placeholder or other lvalue)
            // args[1] = value expression
            const target = evaluate(args[0]);
            const value = evaluate(args[1]);
            // If target is a placeholder, just return the value
            if (target && target.type === "placeholder") {
                return value;
            }
            // If target is a string (variable name), assign it
            if (typeof target === "string") {
                context.set(target, value);
            }
            return value;
        },
        doc: "Assignment expression (lvalue = expr)",
    },

    BINOP: {
        impl(args) {
            // Fallback for unrecognized binary operators
            const op = args[0];
            const left = args[1];
            const right = args[2];
            return {
                type: "binop",
                operator: op,
                left,
                right,
                message: `Unrecognized operator "${op}"`,
            };
        },
        pure: true,
        doc: "Fallback for unrecognized binary operators",
    },
};
