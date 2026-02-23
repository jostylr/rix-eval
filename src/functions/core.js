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

    REGEX: {
        impl(args) {
            const patternObj = args[0];
            const flagsObj = args[1];
            const pattern = patternObj && patternObj.type === "string" ? patternObj.value : String(patternObj || "");
            const flags = flagsObj && flagsObj.type === "string" ? flagsObj.value : String(flagsObj || "");

            const modeObj = args[2];
            const mode = modeObj && modeObj.constructor.name === "Integer" ? Number(modeObj.value) : Number(modeObj); // 0=ONE, 1=TEST, 2=ALL, 3=ITER

            let actualFlags = flags;
            if ((mode === 2 || mode === 3) && !actualFlags.includes('g')) {
                actualFlags += 'g';
            }
            if (!actualFlags.includes('d')) {
                actualFlags += 'd'; // Enable match indices
            }

            let re;
            try {
                re = new RegExp(pattern, actualFlags);
            } catch (e) {
                throw new Error(`unsupported regex flag or pattern: ${e.message}`);
            }

            const buildMatchObject = (match) => {
                const groups = [];
                const spans = [];
                for (let i = 0; i < match.length; i++) {
                    const text = match[i];
                    groups.push(text === undefined ? null : { type: "string", value: text });
                    if (match.indices && match.indices[i]) {
                        const [start, end] = match.indices[i];
                        spans.push({
                            type: "tuple",
                            values: [
                                new Integer(BigInt(start + 1)),
                                new Integer(BigInt(end))
                            ]
                        });
                    } else {
                        spans.push(null);
                    }
                }

                // Maps for named
                const named = new Map();
                const namedSpans = new Map();
                if (match.groups) {
                    for (const [key, text] of Object.entries(match.groups)) {
                        named.set(key, text === undefined ? null : { type: "string", value: text });

                        if (match.indices && match.indices.groups && match.indices.groups[key]) {
                            const [s, e] = match.indices.groups[key];
                            namedSpans.set(key, {
                                type: "tuple",
                                values: [
                                    new Integer(BigInt(s + 1)),
                                    new Integer(BigInt(e))
                                ]
                            });
                        } else {
                            namedSpans.set(key, null);
                        }
                    }
                }

                const entries = new Map();
                entries.set("text", { type: "string", value: match[0] });
                entries.set("span", spans[0]);
                entries.set("groups", { type: "sequence", values: groups });
                entries.set("spans", { type: "sequence", values: spans });
                entries.set("named", { type: "map", entries: named });
                entries.set("named spans", { type: "map", entries: namedSpans });
                entries.set("input", { type: "string", value: match.input });

                return { type: "map", entries };
            };

            const regexFunc = (inputVal) => {
                const str = inputVal && inputVal.type === "string" ? inputVal.value : inputVal;
                if (typeof str !== "string") {
                    throw new Error("regex expects string");
                }

                re.lastIndex = 0; // Reset state for global/sticky

                if (mode === 0) { // ONE
                    const m = re.exec(str);
                    return m ? buildMatchObject(m) : null;
                } else if (mode === 1) { // TEST
                    return re.test(str) ? new Integer(1n) : null;
                } else if (mode === 2) { // ALL
                    const results = [];
                    let m;
                    while ((m = re.exec(str)) !== null) {
                        results.push(buildMatchObject(m));
                        if (m[0].length === 0) {
                            re.lastIndex++; // Prevent infinite loops on empty matches
                        }
                    }
                    return { type: "sequence", values: results };
                } else if (mode === 3) { // ITER
                    const matches = [];
                    let isExhausted = false;
                    let lastIdx = 0;

                    const fetchNext = () => {
                        if (isExhausted) return null;
                        re.lastIndex = lastIdx;
                        const m = re.exec(str);
                        lastIdx = re.lastIndex;
                        if (m) {
                            const obj = buildMatchObject(m);
                            matches.push(obj);
                            if (m[0].length === 0) {
                                re.lastIndex++;
                                lastIdx++;
                            }
                            return obj;
                        } else {
                            isExhausted = true;
                            return null;
                        }
                    };

                    let currentIndex = 0;

                    const iteratorFunc = (nVal) => {
                        if (nVal !== undefined && nVal !== null) {
                            const n = Number(nVal instanceof Integer ? nVal.value : nVal);
                            if (isNaN(n) || n < 1) {
                                throw new Error("iterator index must be a positive integer");
                            }
                            // 1-based random access
                            while (!isExhausted && matches.length < n) {
                                fetchNext();
                            }
                            currentIndex = n;
                            return n <= matches.length ? matches[n - 1] : null;
                        } else {
                            currentIndex++;
                            if (currentIndex <= matches.length) {
                                return matches[currentIndex - 1];
                            } else {
                                return fetchNext();
                            }
                        }
                    };

                    iteratorFunc.toString = () => {
                        return `[Regex Iterator: {/${pattern}/${flags}} (NextIndex=${currentIndex})]`;
                    };

                    return iteratorFunc;
                }
            };

            regexFunc.toString = () => {
                const modeNames = ["ONE", "TEST", "ALL", "ITER"];
                const modeName = modeNames[mode];
                const signatures = [
                    "(String) -> Match|null",
                    "(String) -> 1|null",
                    "(String) -> Sequence<Match>",
                    "(String) -> Iterator"
                ];
                return `[Regex ${modeName}: {/${pattern}/${flags}} ${signatures[mode]}]`;
            };

            return regexFunc;
        },
        doc: "Create a regex matching function",
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
