/**
 * Core system functions: LITERAL, STRING, NULL, RETRIEVE, ASSIGN, NOP, SYSREF, GLOBAL
 */

import { Integer, Rational, RationalInterval, BaseSystem } from "@ratmath/core";

/**
 * Parse a number literal string into a ratmath type.
 * Uses a simplified parser for common cases; the full packages/parser
 * can be plugged in later for complex formats.
 */
function parseLiteral(str) {
    if (typeof str !== "string") return str;

    // Helper for base parsing
    const parseWithBase = (numStr, baseSystem) => {
        const normalizeCase = (s, sys) => {
            const usesLower = sys.characters.some(c => c >= 'a' && c <= 'z');
            const usesUpper = sys.characters.some(c => c >= 'A' && c <= 'Z');
            if (usesLower && !usesUpper) return s.toLowerCase();
            if (usesUpper && !usesLower) return s.toUpperCase();
            return s;
        };

        // Decimal form: a.b
        if (numStr.includes(".")) {
            const parts = numStr.split(".");
            const intStr = parts[0] || "0";
            const fracStr = parts[1];

            const sign = numStr.startsWith("-") ? -1n : 1n;
            const absIntStr = intStr.startsWith("-") ? intStr.slice(1) : intStr;

            const intVal = baseSystem.toDecimal(normalizeCase(absIntStr, baseSystem));
            const fracVal = fracStr ? baseSystem.toDecimal(normalizeCase(fracStr, baseSystem)) : 0n;
            const den = BigInt(baseSystem.base) ** BigInt(fracStr ? fracStr.length : 0);
            const num = sign * (intVal * den + fracVal);
            return new Rational(num, den);
        }

        // Rational form: a/b (tokenizer ensures no spaces)
        if (numStr.includes("/")) {
            // Might have mixed: a..b/c
            if (numStr.includes("..")) {
                const mixedParts = numStr.split("..");
                const wholeStr = mixedParts[0];
                const fracParts = mixedParts[1].split("/");

                const sign = wholeStr.startsWith("-") ? -1n : 1n;
                const absWholeStr = wholeStr.startsWith("-") ? wholeStr.slice(1) : wholeStr;

                // Allow inner prefixes? For simplicity assume inner parts use the outer base or explicitly prefix
                // e.g. 0xA..B/C -> extract A, B, C
                const getVal = (s) => {
                    const m = s.match(/^(?:0[a-zA-Z]|0z\[\d+\])?(.*)$/);
                    return baseSystem.toDecimal(normalizeCase(m ? m[1] : s, baseSystem));
                };

                const whole = getVal(absWholeStr);
                const num = getVal(fracParts[0]);
                const den = getVal(fracParts[1]);

                return new Rational(sign * (whole * den + num), den);
            } else {
                const fracParts = numStr.split("/");

                const sign = fracParts[0].startsWith("-") ? -1n : 1n;
                const absNumStr = fracParts[0].startsWith("-") ? fracParts[0].slice(1) : fracParts[0];

                const getVal = (s) => {
                    const m = s.match(/^(?:0[a-zA-Z]|0z\[\d+\])?(.*)$/);
                    return baseSystem.toDecimal(normalizeCase(m ? m[1] : s, baseSystem));
                };

                const num = getVal(absNumStr);
                const den = getVal(fracParts[1]);
                return new Rational(sign * num, den);
            }
        }

        // Integer form
        return new Integer(baseSystem.toDecimal(normalizeCase(numStr, baseSystem)));
    };

    let baseSystem = null;
    let valueStr = str;
    let isNegative = str.startsWith("-");
    const posStr = isNegative ? str.slice(1) : str;

    // Check for 0z[N]
    const customMatch = posStr.match(/^0z\[(\d+)\](.*)$/);
    if (customMatch) {
        baseSystem = BaseSystem.fromBase(parseInt(customMatch[1]));
        valueStr = (isNegative ? "-" : "") + customMatch[2];
    } else {
        // Check for 0x, 0b, 0v, etc.
        const prefixMatch = posStr.match(/^0([a-zA-Z])(.*)$/);
        if (prefixMatch) {
            const prefix = prefixMatch[1];
            baseSystem = BaseSystem.getSystemForPrefix(prefix);
            if (baseSystem) {
                valueStr = (isNegative ? "-" : "") + prefixMatch[2];
            }
        }
    }

    if (baseSystem) {
        // We know it's a base literal, so if it fails, throw the actual error
        // instead of silently falling back to a string literal.
        return parseWithBase(valueStr, baseSystem);
    }

    // Default Decimal Integer
    if (/^-?\d+$/.test(str)) {
        return new Integer(str);
    }

    // Default Decimal Rational: a/b or -a/b
    const ratMatch = str.match(/^(-?\d+)\/(\d+)$/);
    if (ratMatch) {
        return new Rational(BigInt(ratMatch[1]), BigInt(ratMatch[2]));
    }

    // Default Decimal Mixed number: a..b/c
    const mixedMatch = str.match(/^(-?\d+)\.\.(\d+)\/(\d+)$/);
    if (mixedMatch) {
        const whole = BigInt(mixedMatch[1]);
        const num = BigInt(mixedMatch[2]);
        const den = BigInt(mixedMatch[3]);
        const sign = whole < 0n ? -1n : 1n;
        const absWhole = whole < 0n ? -whole : whole;
        return new Rational(sign * (absWhole * den + num), den);
    }

    // Default Decimal
    if (/^-?\d+\.\d+$/.test(str)) {
        const parts = str.split(".");
        const sign = parts[0].startsWith("-") ? -1n : 1n;
        const intPart = parts[0].startsWith("-") ? parts[0].slice(1) : parts[0];
        const fracPart = parts[1];
        const den = 10n ** BigInt(fracPart.length);
        const num = sign * (BigInt(intPart) * den + BigInt(fracPart));
        return new Rational(num, den);
    }

    // Fallback: try as integer
    try {
        return new Integer(str);
    } catch {
        throw new Error(`Invalid number format: ${str}`);
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

    OUTER_RETRIEVE: {
        impl(args, context) {
            const name = args[0];
            const value = context.getOuter(name);
            if (value === undefined) {
                throw new Error(`Undefined outer variable: @${name}`);
            }
            return value;
        },
        doc: "Look up a variable strictly in the outer scope chains",
    },

    ASSIGN: {
        lazy: true,
        impl(args, context, evaluate) {
            // Evaluated name (if it was an IR node like STRING)
            let name = typeof args[0] === "object" && args[0] !== null && args[0].fn
                ? evaluate(args[0])
                : args[0];

            // Unwrap RiX string object if necessary
            if (name && typeof name === "object" && name.type === "string") {
                name = name.value;
            }

            const value = evaluate(args[1]);
            context.set(name, value);
            return value;
        },
        doc: "Assign a value to a variable in the current scope",
    },

    OUTER_ASSIGN: {
        lazy: true,
        impl(args, context, evaluate) {
            let name = typeof args[0] === "object" && args[0] !== null && args[0].fn
                ? evaluate(args[0])
                : args[0];

            if (name && typeof name === "object" && name.type === "string") {
                name = name.value;
            }

            const value = evaluate(args[1]);
            context.setOuter(name, value);
            return value;
        },
        doc: "Assign a value to an existing outer scope variable",
    },

    GLOBAL: {
        lazy: true,
        impl(args, context, evaluate) {
            let name = typeof args[0] === "object" && args[0] !== null && args[0].fn
                ? evaluate(args[0])
                : args[0];

            // Unwrap RiX string object if necessary
            if (name && typeof name === "object" && name.type === "string") {
                name = name.value;
            }

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
