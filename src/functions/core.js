/**
 * Core system functions: LITERAL, STRING, NULL, RETRIEVE, ASSIGN, NOP, SYSREF, GLOBAL
 */

import { Integer, Rational, RationalInterval, BaseSystem } from "@ratmath/core";
import { HOLE, isHole } from "../hole.js";
import {
    shallowCopyValue, deepCopyValue,
    copyAllMeta, transferMetaForUpdate,
} from "../cell.js";

const BASE_RESERVED_CHARS = new Set([".", "/", "#", "~", "_", "^", "+", "-"]);
const BASE_MODE_ALIASES = new Map([
    ["mixed", 1], ["..", 1],
    ["repeat", 2], [".", 2], ["#", 2], ["radix", 2],
    ["cf", 3], [".~", 3],
    ["cf_explicit", 4], ["~", 4],
    ["shifted", 5], ["_^", 5], ["^", 5],
    ["fraction", 6], ["/", 6], ["improper", 6],
]);
const DEFAULT_BASE_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@&";
const DEFAULT_BASE_EXPANSION_LIMIT = 20;

function unescapeQuotedString(text) {
    return text
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
}

function toRationalValue(value) {
    if (value instanceof Integer) return value.toRational();
    if (value instanceof Rational) return value;
    if (value instanceof RationalInterval) {
        if (value.low.equals(value.high)) return value.low;
        throw new Error("Expected a single numeric value, not an interval");
    }
    throw new Error("Expected a numeric value");
}

function groupDigits(intStr) {
    if (!intStr || intStr.length <= 3) return intStr;
    const sign = intStr.startsWith("-") ? "-" : "";
    const body = sign ? intStr.slice(1) : intStr;
    if (body.length <= 3) return intStr;
    let out = "";
    for (let i = 0; i < body.length; i++) {
        if (i > 0 && (body.length - i) % 3 === 0) out += "_";
        out += body[i];
    }
    return sign + out;
}

function stripGroupedDecimalDigits(text, { allowSign = false } = {}) {
    if (typeof text !== "string" || text.length === 0) return text;
    let s = text;
    let sign = "";
    if (allowSign && (s.startsWith("-") || s.startsWith("+"))) {
        sign = s[0];
        s = s.slice(1);
    }
    if (s.includes("_")) {
        if (s.startsWith("_") || s.endsWith("_") || s.includes("__")) {
            throw new Error("Invalid underscore placement in number");
        }
        for (let i = 0; i < s.length; i++) {
            if (s[i] !== "_") continue;
            const prev = s[i - 1];
            const next = s[i + 1];
            if (!/\d/.test(prev || "") || !/\d/.test(next || "")) {
                throw new Error("Underscore separators must be between digits");
            }
        }
    }
    return sign + s.replace(/_/g, "");
}

function groupDigitRuns(text, baseSystem) {
    if (!text) return text;
    let out = "";
    let run = "";
    const flush = () => {
        if (!run.length) return;
        if (run.length <= 3) {
            out += run;
        } else {
            for (let i = 0; i < run.length; i++) {
                if (i > 0 && i % 3 === 0) out += "_";
                out += run[i];
            }
        }
        run = "";
    };
    for (const ch of text) {
        if (baseSystem.charMap.has(ch)) {
            run += ch;
        } else {
            flush();
            out += ch;
        }
    }
    flush();
    return out;
}

function shortenRepeatingExpansion(expansion, limit = DEFAULT_BASE_EXPANSION_LIMIT) {
    if (typeof expansion !== "string") return expansion;

    if (!expansion.includes("#")) {
        if (expansion.length > limit + 2) {
            const dotIndex = expansion.indexOf(".");
            if (dotIndex !== -1 && expansion.length - dotIndex - 1 > limit) {
                return expansion.substring(0, dotIndex + limit + 1) + "...";
            }
        }
        return expansion;
    }

    if (expansion.endsWith("#0")) {
        const withoutRepeating = expansion.substring(0, expansion.length - 2);
        if (withoutRepeating.length > limit + 2) {
            const dotIndex = withoutRepeating.indexOf(".");
            if (dotIndex !== -1 && withoutRepeating.length - dotIndex - 1 > limit) {
                return withoutRepeating.substring(0, dotIndex + limit + 1) + "...";
            }
        }
        return withoutRepeating;
    }

    if (expansion.length > limit + 2) {
        const hashIndex = expansion.indexOf("#");
        const beforeHash = expansion.substring(0, hashIndex);
        const afterHash = expansion.substring(hashIndex + 1);
        if (beforeHash.length > limit + 1) {
            return beforeHash.substring(0, limit + 1) + "...";
        }
        const remainingSpace = limit + 2 - beforeHash.length;
        if (remainingSpace <= 1) return beforeHash + "#...";
        if (afterHash.length > remainingSpace - 1) {
            return beforeHash + "#" + afterHash.substring(0, remainingSpace - 1) + "...";
        }
    }

    return expansion;
}

function groupRadixExpansion(expansion, baseSystem) {
    if (!expansion) return expansion;
    const sign = expansion.startsWith("-") ? "-" : "";
    const body = sign ? expansion.slice(1) : expansion;

    const hashIndex = body.indexOf("#");
    const beforeHash = hashIndex === -1 ? body : body.slice(0, hashIndex);
    const afterHash = hashIndex === -1 ? null : body.slice(hashIndex + 1);

    const dotIndex = beforeHash.indexOf(".");
    const integerPart = dotIndex === -1 ? beforeHash : beforeHash.slice(0, dotIndex);
    const fracPart = dotIndex === -1 ? null : beforeHash.slice(dotIndex + 1);

    const groupedInteger = groupDigits(integerPart);
    const groupedFrac = fracPart === null ? null : groupDigitRuns(fracPart, baseSystem);
    const groupedRepeat = afterHash === null ? null : groupDigitRuns(afterHash, baseSystem);

    let out = groupedInteger;
    if (groupedFrac !== null) out += "." + groupedFrac;
    if (groupedRepeat !== null) out += "#" + groupedRepeat;
    return sign + out;
}

function baseFromInteger(n) {
    if (!Number.isInteger(n) || n < 2 || n > 64) {
        throw new Error("Base number must be an integer between 2 and 64");
    }
    const chars = Array.from(DEFAULT_BASE_DIGITS.slice(0, n));
    return new BaseSystem(chars, `Base ${n}`);
}

function ensureSafeDigits(baseSystem) {
    for (const ch of baseSystem.characters) {
        if (BASE_RESERVED_CHARS.has(ch)) {
            throw new Error(`Base digit '${ch}' is reserved and cannot be used in a digit alphabet`);
        }
    }
}

function parseBaseInteger(str, baseSystem, allowSign = true) {
    let s = str;
    let sign = 1n;
    if (allowSign && (s.startsWith("-") || s.startsWith("+"))) {
        sign = s[0] === "-" ? -1n : 1n;
        s = s.slice(1);
    }
    if (!s.length) throw new Error("Missing digits");
    if (s.startsWith("_") || s.endsWith("_")) throw new Error("Underscore cannot be leading or trailing");
    if (s.includes("__")) throw new Error("Consecutive underscores are not allowed");

    const usesLower = baseSystem.characters.some((c) => c >= "a" && c <= "z");
    const usesUpper = baseSystem.characters.some((c) => c >= "A" && c <= "Z");
    const normalizeChar = (ch) => {
        if (baseSystem.charMap.has(ch)) return ch;
        if (usesLower && !usesUpper) {
            const c = ch.toLowerCase();
            if (baseSystem.charMap.has(c)) return c;
        }
        if (usesUpper && !usesLower) {
            const c = ch.toUpperCase();
            if (baseSystem.charMap.has(c)) return c;
        }
        return ch;
    };

    const chars = Array.from(s).map(normalizeChar);
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === "_") {
            const prev = chars[i - 1];
            const next = chars[i + 1];
            if (!baseSystem.charMap.has(prev) || !baseSystem.charMap.has(next)) {
                throw new Error("Underscore separators must be between base digits");
            }
            continue;
        }
        if (!baseSystem.charMap.has(ch)) {
            throw new Error(`Invalid digit '${ch}' for ${baseSystem.name}`);
        }
    }
    const cleaned = chars.filter((ch) => ch !== "_").join("");
    return sign * baseSystem.toDecimal(cleaned);
}

function parseSimpleBaseNumeral(str, baseSystem) {
    let s = str;
    let sign = 1n;
    if (s.startsWith("-") || s.startsWith("+")) {
        sign = s[0] === "-" ? -1n : 1n;
        s = s.slice(1);
    }
    const dotParts = s.split(".");
    if (dotParts.length > 2) throw new Error("Too many radix points");
    const intPart = dotParts[0] === "" ? "0" : dotParts[0];
    const fracPart = dotParts.length === 2 ? dotParts[1] : "";
    const intVal = parseBaseInteger(intPart, baseSystem, false);
    let result = new Rational(intVal, 1n);
    if (fracPart.length) {
        const fracVal = parseBaseInteger(fracPart, baseSystem, false);
        const denom = BigInt(baseSystem.base) ** BigInt(Array.from(fracPart).filter((c) => c !== "_").length);
        result = result.add(new Rational(fracVal, denom));
    }
    if (sign < 0n) result = result.negate();
    return result;
}

function continuedFractionFromTerms(terms) {
    let acc = new Rational(terms[terms.length - 1], 1n);
    for (let i = terms.length - 2; i >= 0; i--) {
        acc = new Rational(terms[i], 1n).add(new Rational(1, 1).divide(acc));
    }
    return acc;
}

function fromBaseString(baseStr, baseSystem) {
    if (typeof baseStr !== "string") throw new Error("FROMBASE expects a string input");
    let s = baseStr.trim();
    if (!s.length) throw new Error("Empty base numeral");
    if (s.startsWith("_")) throw new Error("Underscore cannot start a number");

    let shiftExp = null;
    const shiftIdx = s.indexOf("_^");
    if (shiftIdx !== -1) {
        if (s.indexOf("_^", shiftIdx + 2) !== -1) throw new Error("Only one _^ is allowed");
        if (s.includes("#") && shiftIdx < s.indexOf("#")) throw new Error("Radix shift must come after repeating section");
        shiftExp = s.slice(shiftIdx + 2);
        s = s.slice(0, shiftIdx);
    }

    let value;
    if (s.includes(".~")) {
        const explicit = s.startsWith("~");
        if (explicit) s = s.slice(1);
        const idx = s.indexOf(".~");
        const a0 = s.slice(0, idx);
        const tail = s.slice(idx + 2);
        if (!tail.length) throw new Error("Continued fraction requires terms after .~");
        const termStrs = [a0, ...tail.split("~")];
        if (termStrs.some((t) => !t.length)) throw new Error("Invalid continued fraction format");
        const terms = termStrs.map((t, i) => parseBaseInteger(t, baseSystem, i === 0));
        value = continuedFractionFromTerms(terms);
    } else if (s.includes("..")) {
        const parts = s.split("..");
        if (parts.length !== 2) throw new Error("Mixed number must have exactly one '..'");
        const whole = parseBaseInteger(parts[0], baseSystem, true);
        const fracParts = parts[1].split("/");
        if (fracParts.length !== 2) throw new Error("Mixed number requires Y/Z fractional part");
        const num = parseBaseInteger(fracParts[0], baseSystem, false);
        const den = parseBaseInteger(fracParts[1], baseSystem, false);
        if (den === 0n) throw new Error("Denominator cannot be zero");
        let frac = new Rational(num, den);
        if (whole < 0n) frac = frac.negate();
        value = new Rational(whole, 1n).add(frac);
    } else if (s.includes("/")) {
        const parts = s.split("/");
        if (parts.length !== 2) throw new Error("Fraction must have exactly one '/'");
        const num = parseBaseInteger(parts[0], baseSystem, true);
        const den = parseBaseInteger(parts[1], baseSystem, false);
        if (den === 0n) throw new Error("Denominator cannot be zero");
        value = new Rational(num, den);
        value._explicitFraction = true;
    } else if (s.includes("#")) {
        const parts = s.split("#");
        if (parts.length !== 2) throw new Error("Repeating form must have exactly one '#'");
        const prefix = parts[0];
        const repeat = parts[1];
        if (!repeat.length) throw new Error("Repeating block after # cannot be empty");
        const sign = prefix.startsWith("-") ? -1n : 1n;
        const unsignedPrefix = (prefix.startsWith("-") || prefix.startsWith("+")) ? prefix.slice(1) : prefix;
        const dot = unsignedPrefix.indexOf(".");
        const intStr = dot === -1 ? unsignedPrefix : unsignedPrefix.slice(0, dot);
        const nonRep = dot === -1 ? "" : unsignedPrefix.slice(dot + 1);
        const intVal = parseBaseInteger(intStr || "0", baseSystem, false);
        const nonRepVal = nonRep.length ? parseBaseInteger(nonRep, baseSystem, false) : 0n;
        const repVal = parseBaseInteger(repeat, baseSystem, false);
        const B = BigInt(baseSystem.base);
        const m = BigInt(Array.from(nonRep).filter((c) => c !== "_").length);
        const r = BigInt(Array.from(repeat).filter((c) => c !== "_").length);
        let result = new Rational(intVal, 1n);
        if (m > 0n) result = result.add(new Rational(nonRepVal, B ** m));
        result = result.add(new Rational(repVal, (B ** m) * (B ** r - 1n)));
        value = sign < 0n ? result.negate() : result;
    } else {
        value = parseSimpleBaseNumeral(s, baseSystem);
    }

    if (shiftExp !== null && shiftExp.length) {
        const shift = parseBaseInteger(shiftExp, baseSystem, true);
        const B = new Rational(BigInt(baseSystem.base), 1n);
        const factor = shift >= 0n ? B.pow(shift) : new Rational(1, 1).divide(B.pow(-shift));
        value = value.multiply(factor);
    }

    return value.denominator === 1n ? new Integer(value.numerator) : value;
}

function resolveModeSpec(modeValue) {
    if (modeValue === undefined || modeValue === null) return { mode: 1 };
    if (typeof modeValue === "string") {
        const s = modeValue.trim().toLowerCase();
        const limitedRadix = s.match(/^(?:\.|#|repeat|radix)(\d+)$/);
        if (limitedRadix) return { mode: 2, limit: parseInt(limitedRadix[1], 10) };
        const limitedShifted = s.match(/^(?:\^|_\^|shifted)(\d+)$/);
        if (limitedShifted) return { mode: 5, limit: parseInt(limitedShifted[1], 10) };
        const alias = BASE_MODE_ALIASES.get(s);
        if (alias !== undefined) return { mode: alias };
        throw new Error(`Unknown formatting mode '${modeValue}'`);
    }
    if (modeValue && modeValue.type === "string") {
        return resolveModeSpec(modeValue.value);
    }
    if (modeValue instanceof Integer) return { mode: Number(modeValue.value) };
    if (modeValue instanceof Rational && modeValue.denominator === 1n) return { mode: Number(modeValue.numerator) };
    throw new Error("Formatting mode must be an integer or mode string");
}

function toBaseDigitsInt(value, baseSystem) {
    return groupDigits(baseSystem.fromDecimal(value));
}

function toBaseString(value, baseSystem, modeSpec = { mode: 1 }) {
    const mode = typeof modeSpec === "number" ? modeSpec : modeSpec?.mode ?? 1;
    const limit = typeof modeSpec === "number" ? undefined : modeSpec?.limit;
    const rat = toRationalValue(value);
    if (mode === 2) {
        const raw = rat.toRepeatingBase(baseSystem);
        const shortened = shortenRepeatingExpansion(raw, limit ?? DEFAULT_BASE_EXPANSION_LIMIT);
        return groupRadixExpansion(shortened, baseSystem);
    }
    if (mode === 3 || mode === 4) {
        const cf = rat.toContinuedFraction();
        const terms = cf.map((t) => baseSystem.fromDecimal(t));
        if (terms.length === 1) return groupDigits(terms[0]);
        const prefix = (mode === 4 || cf[0] < 0n) ? "~" : "";
        return `${prefix}${groupDigits(terms[0])}.~${terms.slice(1).map(groupDigits).join("~")}`;
    }
    if (mode === 5) {
        const raw = shortenRepeatingExpansion(rat.toRepeatingBase(baseSystem), limit ?? DEFAULT_BASE_EXPANSION_LIMIT);
        const sign = raw.startsWith("-") ? "-" : "";
        const body = sign ? raw.slice(1) : raw;
        const hash = body.indexOf("#");
        const dot = body.indexOf(".");
        const cut = dot === -1 ? (hash === -1 ? body.length : hash) : dot;
        const integer = body.slice(0, cut);
        const integerDigits = Array.from(integer).filter((ch) => baseSystem.charMap.has(ch)).length;
        if (integer.length <= 1) return `${groupRadixExpansion(sign + body, baseSystem)}_^0`;
        const tail = dot === -1
            ? (hash === -1 ? "" : body.slice(hash))
            : body.slice(dot + 1);
        const shifted = `${integer[0]}.${integer.slice(1)}${tail}`;
        return `${groupRadixExpansion(sign + shifted, baseSystem)}_^${integerDigits - 1}`;
    }
    if (mode === 6) {
        return `${toBaseDigitsInt(rat.numerator, baseSystem)}/${toBaseDigitsInt(rat.denominator, baseSystem)}`;
    }
    if (rat.denominator === 1n) {
        return toBaseDigitsInt(rat.numerator, baseSystem);
    }
    const sign = rat.numerator < 0n ? -1n : 1n;
    const absNum = rat.numerator < 0n ? -rat.numerator : rat.numerator;
    const whole = absNum / rat.denominator;
    const rem = absNum % rat.denominator;
    if (rem === 0n) return toBaseDigitsInt(rat.numerator, baseSystem);
    const wholeStr = toBaseDigitsInt(sign < 0n ? -whole : whole, baseSystem);
    return `${wholeStr}..${toBaseDigitsInt(rem, baseSystem)}/${toBaseDigitsInt(rat.denominator, baseSystem)}`;
}

function resolveBaseSpecFromValue(value) {
    if (typeof value === "string" && /^0([A-Za-z])$/.test(value)) {
        const letter = value[1];
        const base = BaseSystem.getSystemForPrefix(letter);
        if (!base) throw new Error(`Unknown base prefix '${value}'`);
        return base;
    }
    if (value && value.type === "string") {
        const chars = Array.from(value.value);
        const base = new BaseSystem(chars, `Custom Base ${chars.length}`);
        ensureSafeDigits(base);
        return base;
    }
    if (typeof value === "string") {
        const chars = Array.from(value);
        const base = new BaseSystem(chars, `Custom Base ${chars.length}`);
        ensureSafeDigits(base);
        return base;
    }
    if (value instanceof Integer) {
        return baseFromInteger(Number(value.value));
    }
    if (value instanceof Rational && value.denominator === 1n) {
        return baseFromInteger(Number(value.numerator));
    }
    if (value && value.type === "tuple" && Array.isArray(value.values) && value.values.length === 2) {
        const radix = value.values[0];
        const digits = value.values[1];
        const baseFromDigits = resolveBaseSpecFromValue(digits);
        const radixNum = radix instanceof Integer
            ? Number(radix.value)
            : radix instanceof Rational && radix.denominator === 1n
                ? Number(radix.numerator)
                : null;
        if (!Number.isInteger(radixNum)) throw new Error("Tuple radix must be an integer");
        if (radixNum !== baseFromDigits.base) {
            throw new Error(`Tuple base mismatch: radix ${radixNum} does not match digits length ${baseFromDigits.base}`);
        }
        return baseFromDigits;
    }
    throw new Error("Invalid base specification");
}

/**
 * Parse a number literal string into a ratmath type.
 * Handles: integers, rationals, decimals, mixed numbers, repeating decimals (#),
 * radix shift (_^), continued fractions (.~), and prefixed bases (0x, 0b, etc.).
 * E notation is intentionally NOT supported.
 */
function parseLiteral(str) {
    if (typeof str !== "string") return str;

    // Bare base-prefix tokens are valid BASESPEC values in conversion contexts.
    // Return as raw token so TOBASE/FROMBASE can resolve them.
    if (/^0[a-zA-Z]$/.test(str) || /^0z\[\d+\]$/.test(str)) {
        return str;
    }

    // Explicit-start continued fraction with prefixed base integer part:
    // ~0b101.~11~10 or ~-0B4.~3
    const explicitPrefixed = str.match(/^~(-?)(?:0z\[(\d+)\]|0([a-zA-Z]))(.+)$/);
    if (explicitPrefixed) {
        const neg = explicitPrefixed[1] === "-" ? "-" : "";
        const custom = explicitPrefixed[2];
        const prefix = explicitPrefixed[3];
        const tail = explicitPrefixed[4];
        const baseSystem = custom
            ? BaseSystem.fromBase(parseInt(custom, 10))
            : BaseSystem.getSystemForPrefix(prefix);
        if (!baseSystem) {
            throw new Error(`Unknown base prefix in explicit continued fraction: ${str}`);
        }
        return fromBaseString(`~${neg}${tail}`, baseSystem);
    }

    // Explicit-start continued fractions: ~INT.~term~term~... or ~-INT.~term~term~...
    // The ~ prefix is the explicit coefficient marker.
    if (str.startsWith("~")) {
        const cfStr = str.slice(1); // strip leading ~
        const cfMatch = cfStr.match(/^(-?\d+)\.~(\d+(?:~\d+)*)$/);
        if (cfMatch) {
            const intPart = BigInt(cfMatch[1]);
            const cfTerms = cfMatch[2].split("~").map(t => BigInt(t));
            return Rational.fromContinuedFraction([intPart, ...cfTerms]);
        }
        throw new Error(`Invalid explicit continued fraction format: ${str}`);
    }

    const isNegative = str.startsWith("-");
    const posStr = isNegative ? str.slice(1) : str;

    // Uppercase-prefix quoted literal: 0A"..."
    const quotedPrefix = str.match(/^(-?)0([A-Z])"((?:[^"\\]|\\.)*)"$/);
    if (quotedPrefix) {
        const sign = quotedPrefix[1] === "-" ? "-" : "";
        const prefix = quotedPrefix[2];
        const baseSystem = BaseSystem.getSystemForPrefix(prefix);
        if (!baseSystem) throw new Error(`Unknown base prefix 0${prefix}`);
        const stream = unescapeQuotedString(quotedPrefix[3]);
        return fromBaseString(sign + stream, baseSystem);
    }

    // Implicit-start continued fractions: INT.~term~term~... (no sign, no ~ prefix)
    // Only for plain decimal-literal form here; prefixed-base forms are handled later.
    if (str.includes(".~") && !/^-?(?:0z\[\d+\]|0[a-zA-Z])/.test(str)) {
        const cfMatch = str.match(/^(\d+)\.~(\d+(?:~\d+)*)$/);
        if (cfMatch) {
            const intPart = BigInt(cfMatch[1]);
            const cfTerms = cfMatch[2].split("~").map(t => BigInt(t));
            return Rational.fromContinuedFraction([intPart, ...cfTerms]);
        }
        throw new Error(`Invalid continued fraction format: ${str}`);
    }

    // Radix shift: number_^exponent (e.g. 1_^2 = 100, 1_^-2 = 1/100)
    if (posStr.includes("_^")) {
        const shiftMatch = posStr.match(/^(.*?)_\^([+-]?\d(?:_?\d)*)$/);
        if (shiftMatch) {
            const baseVal = parseLiteral((isNegative ? "-" : "") + shiftMatch[1]);
            const exp = BigInt(stripGroupedDecimalDigits(shiftMatch[2], { allowSign: true }));
            // _^ uses base 10 for decimal literals
            const base = 10n;
            let scale;
            if (exp >= 0n) {
                scale = new Rational(base ** exp);
            } else {
                scale = new Rational(1n, base ** (-exp));
            }
            const baseRat = baseVal instanceof Integer ? baseVal.toRational() : baseVal;
            const result = baseRat.multiply(scale);
            return result.denominator === 1n ? new Integer(result.numerator) : result;
        }
        throw new Error(`Invalid radix shift format: ${str}`);
    }

    // Repeating decimals: digits.digits#digits, .digits#digits, digits#digits
    if (posStr.includes("#")) {
        return parseRepeatingDecimalLiteral(str);
    }

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
        if (!valueStr || valueStr === "-") {
            throw new Error(`Invalid base literal: ${str}`);
        }
        return fromBaseString(valueStr, baseSystem);
    }

    // Default Decimal Integer
    if (/^-?\d(?:_?\d)*$/.test(str)) {
        return new Integer(stripGroupedDecimalDigits(str, { allowSign: true }));
    }

    // Default Decimal Rational: a/b or -a/b
    const ratMatch = str.match(/^(-?\d(?:_?\d)*)\/(\d(?:_?\d)*)$/);
    if (ratMatch) {
        return new Rational(
            BigInt(stripGroupedDecimalDigits(ratMatch[1], { allowSign: true })),
            BigInt(stripGroupedDecimalDigits(ratMatch[2]))
        );
    }

    // Default Decimal Mixed number: a..b/c
    const mixedMatch = str.match(/^(-?\d(?:_?\d)*)\.\.(\d(?:_?\d)*)\/(\d(?:_?\d)*)$/);
    if (mixedMatch) {
        const whole = BigInt(stripGroupedDecimalDigits(mixedMatch[1], { allowSign: true }));
        const num = BigInt(stripGroupedDecimalDigits(mixedMatch[2]));
        const den = BigInt(stripGroupedDecimalDigits(mixedMatch[3]));
        const sign = whole < 0n ? -1n : 1n;
        const absWhole = whole < 0n ? -whole : whole;
        return new Rational(sign * (absWhole * den + num), den);
    }

    // Default Decimal
    if (/^-?\d(?:_?\d)*\.\d(?:_?\d)*$/.test(str)) {
        const parts = str.split(".");
        const sign = parts[0].startsWith("-") ? -1n : 1n;
        const intPart = stripGroupedDecimalDigits(parts[0].startsWith("-") ? parts[0].slice(1) : parts[0]);
        const fracPart = stripGroupedDecimalDigits(parts[1]);
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

/**
 * Parse a repeating decimal string like "1.3#", "0.#3", "1.23#45", "5#3"
 * into an exact Rational.
 * Format: nonRepeating#repeating where repeating part repeats forever.
 */
function parseRepeatingDecimalLiteral(str) {
    const isNeg = str.startsWith("-");
    const s = isNeg ? str.slice(1) : str;

    const hashIdx = s.indexOf("#");
    if (hashIdx === -1) throw new Error(`Expected # in repeating decimal: ${str}`);

    const nonRepStr = s.slice(0, hashIdx);  // e.g. "1.23" or "5" or "1."
    const repStr = s.slice(hashIdx + 1);    // e.g. "45" or "3" or ""

    // If repeating part is empty or "0", treat as terminating decimal
    if (repStr === "" || repStr === "0") {
        // Parse the non-repeating part as a regular decimal
        return parseLiteral(isNeg ? "-" + nonRepStr : nonRepStr);
    }

    // Split non-repeating part into integer and fractional portions
    let intStr, fracStr;
    if (nonRepStr.includes(".")) {
        const dotIdx = nonRepStr.indexOf(".");
        intStr = nonRepStr.slice(0, dotIdx) || "0";
        fracStr = nonRepStr.slice(dotIdx + 1);  // may be empty string ""
    } else {
        intStr = nonRepStr || "0";
        fracStr = "";
    }

    // The value is: (intStr + fracStr + repStr - intStr + fracStr) / (10^(fracStr.length) * (10^repStr.length - 1))
    // More precisely:
    //   Let n = fracStr.length, m = repStr.length
    //   full = intStr + fracStr + repStr (as integer)
    //   base = intStr + fracStr (as integer)
    //   result = (full - base) / (10^n * (10^m - 1))

    const cleanInt = stripGroupedDecimalDigits(intStr || "0");
    const cleanFrac = stripGroupedDecimalDigits(fracStr || "");
    const cleanRep = stripGroupedDecimalDigits(repStr);

    const n = cleanFrac.length;
    const m = cleanRep.length;

    const fullStr = cleanInt + cleanFrac + cleanRep;
    const baseStr = cleanInt + cleanFrac || "0";

    const full = BigInt(fullStr);
    const base = BigInt(baseStr || "0");

    const den = (10n ** BigInt(n)) * (10n ** BigInt(m) - 1n);
    const num = full - base;

    const result = new Rational(isNeg ? -num : num, den);
    return result;
}

// ─── Assignment helpers ──────────────────────────────────────────────

/**
 * Resolve an assignment target name from IR args[0].
 * Handles raw strings, IR nodes that evaluate to strings, and RiX string objects.
 */
function resolveAssignName(arg, evaluate) {
    let name = typeof arg === "object" && arg !== null && arg.fn
        ? evaluate(arg)
        : arg;
    if (name && typeof name === "object" && name.type === "string") {
        name = name.value;
    }
    return name;
}

/**
 * Check if a value is locked (cannot be replaced via ~= / ~~=).
 */
function checkLocked(value) {
    const ext = value?._ext;
    if (ext?.get("locked")) {
        throw new Error("Cannot update value: cell is locked. Use = or := to rebind instead.");
    }
}

/**
 * Check if a value is frozen or immutable (cannot be replaced via ~= / ~~=).
 */
function checkFrozenImmutable(value) {
    const ext = value?._ext;
    if (ext?.get("immutable")) {
        throw new Error("Cannot update value: cell is immutable");
    }
    if (ext?.get("frozen")) {
        throw new Error("Cannot update value: cell is frozen");
    }
}

/**
 * Perform in-place value replacement (~= / ~~=) on a local binding.
 * Preserves cell identity (binding slot) so aliases see the change.
 */
function performUpdate(name, rhsValue, context, depth) {
    const copyFn = depth === "deep" ? deepCopyValue : shallowCopyValue;
    const cell = context.getCell(name);

    if (cell) {
        const oldValue = cell.value;
        checkLocked(oldValue);
        checkFrozenImmutable(oldValue);
        const newValue = copyFn(rhsValue);
        transferMetaForUpdate(oldValue, newValue, rhsValue, depth);
        cell.value = newValue;
        return newValue;
    }

    // lhs doesn't exist yet — create fresh binding.
    // Even with no old cell, ordinary meta from rhs is NOT inherited.
    // Only ephemeral (_) and sticky (__) transfer; transferMetaForUpdate
    // with oldValue=null handles this correctly.
    const newValue = copyFn(rhsValue);
    transferMetaForUpdate(null, newValue, rhsValue, depth);
    context.setFresh(name, newValue);
    return newValue;
}

/**
 * Perform in-place value replacement on an outer scope binding.
 */
function performOuterUpdate(name, rhsValue, context, depth) {
    const copyFn = depth === "deep" ? deepCopyValue : shallowCopyValue;
    const cell = context.getOuterCell(name);

    if (cell) {
        const oldValue = cell.value;
        checkLocked(oldValue);
        checkFrozenImmutable(oldValue);
        const newValue = copyFn(rhsValue);
        transferMetaForUpdate(oldValue, newValue, rhsValue, depth);
        cell.value = newValue;
        return newValue;
    }

    throw new Error(`Cannot update outer variable '@${name}' because it does not exist in any outer scope.`);
}

export const coreFunctions = {
    LITERAL: {
        impl(args) {
            return parseLiteral(args[0]);
        },
        pure: true,
        doc: "Parse a number literal string into a ratmath type",
    },

    DEFINEBASE: {
        lazy: true,
        impl(args, context, evaluate) {
            const letter = args[0];
            if (!/^[A-Z]$/.test(letter)) {
                throw new Error("Base definition requires uppercase prefix letter");
            }
            if (BaseSystem.hasExactPrefix(letter)) {
                throw new Error(`Base prefix 0${letter} is already defined`);
            }

            const rhsNode = args[1];
            let rhsValue;
            if (rhsNode && rhsNode.fn === "LITERAL" && typeof rhsNode.args?.[0] === "string" && /^0([A-Za-z])$/.test(rhsNode.args[0])) {
                rhsValue = rhsNode.args[0];
            } else {
                rhsValue = evaluate(rhsNode);
            }
            const baseSystem = resolveBaseSpecFromValue(rhsValue);
            ensureSafeDigits(baseSystem);
            BaseSystem.registerPrefix(letter, baseSystem);
            return new Integer(1n);
        },
        doc: "Define a custom uppercase base prefix (0A = ...), one-time global definition",
    },

    TOBASE: {
        lazy: true,
        impl(args, context, evaluate) {
            const value = evaluate(args[0]);
            const specNode = args[1];
            const modeNode = args[2];

            const evalBaseSpecNode = (node) => {
                if (node && node.fn === "LITERAL" && typeof node.args?.[0] === "string" && /^0([A-Za-z])$/.test(node.args[0])) {
                    return node.args[0];
                }
                return evaluate(node);
            };

            let baseSpecValue = evalBaseSpecNode(specNode);
            let modeSpec = modeNode !== undefined ? resolveModeSpec(evaluate(modeNode)) : { mode: 1 };

            if (baseSpecValue && baseSpecValue.type === "tuple" && Array.isArray(baseSpecValue.values) && baseSpecValue.values.length === 2) {
                const second = baseSpecValue.values[1];
                try {
                    modeSpec = resolveModeSpec(second);
                    baseSpecValue = baseSpecValue.values[0];
                } catch {
                    // Keep as BASESPEC tuple {: radix, digits}
                }
            } else if (baseSpecValue && baseSpecValue.type === "string") {
                try {
                    modeSpec = resolveModeSpec(baseSpecValue);
                    baseSpecValue = new Integer(10n);
                } catch {
                    // Keep as string-based BASESPEC digits
                }
            }

            const baseSystem = resolveBaseSpecFromValue(baseSpecValue);
            const text = toBaseString(value, baseSystem, modeSpec);
            return { type: "string", value: text };
        },
        doc: "Format number to base string: expr _> baseSpec",
    },

    FROMBASE: {
        lazy: true,
        impl(args, context, evaluate) {
            const strVal = evaluate(args[0]);
            const specNode = args[1];
            const baseSpecValue =
                specNode && specNode.fn === "LITERAL" && typeof specNode.args?.[0] === "string" && /^0([A-Za-z])$/.test(specNode.args[0])
                    ? specNode.args[0]
                    : evaluate(specNode);

            const text = strVal && strVal.type === "string" ? strVal.value : strVal;
            if (typeof text !== "string") throw new Error("FROMBASE expects a string left operand");
            const baseSystem = resolveBaseSpecFromValue(baseSpecValue);
            return fromBaseString(text, baseSystem);
        },
        doc: "Parse base string to number: str <_ baseSpec",
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

    HOLE: {
        impl() { return HOLE; },
        holeAware: true,
        pure: true,
        doc: "Internal hole/undefined sentinel — represents an explicitly omitted value",
    },

    HOLE_COALESCE: {
        lazy: true,
        holeAware: true,
        impl(args, _ctx, evalFn) {
            const left = evalFn(args[0]);
            if (isHole(left)) return evalFn(args[1]);
            return left;
        },
        doc: "Hole-coalescing: x ?| y returns x if x is not a hole, else y",
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

    SELF: {
        impl(_args, context) {
            const callable = context.getCurrentCallable();
            if (callable === undefined) {
                throw new Error("Self reference '$' is only valid within a function body");
            }
            return callable;
        },
        doc: "Resolve the current callable object inside a function body",
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

    // ─── Assignment operators ─────────────────────────────────────────
    //
    // =    ASSIGN            alias/rebind — share binding slot with rhs
    // :=   ASSIGN_COPY       fresh cell with shallow-copied value + all meta
    // ~=   ASSIGN_UPDATE     in-place value replacement (cell-preserving)
    // ::=  ASSIGN_DEEP_COPY  fresh cell with deep-copied value + all meta
    // ~~=  ASSIGN_DEEP_UPDATE in-place value replacement with deep copies

    ASSIGN: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
            const rhsIR = args[1];

            // If rhs is a simple variable reference, share the same Cell
            if (rhsIR && typeof rhsIR === "object" && rhsIR.fn === "RETRIEVE") {
                const rhsName = rhsIR.args[0];
                const cell = context.getCell(rhsName);
                if (cell) {
                    context.setCell(name, cell);
                    return cell.value;
                }
            }
            if (rhsIR && typeof rhsIR === "object" && rhsIR.fn === "OUTER_RETRIEVE") {
                const rhsName = rhsIR.args[0];
                const cell = context.getOuterCell(rhsName);
                if (cell) {
                    context.setCell(name, cell);
                    return cell.value;
                }
            }

            // Otherwise evaluate and create a fresh Cell
            const value = evaluate(rhsIR);
            context.setFresh(name, value);
            return value;
        },
        doc: "Alias/rebind — lhs shares the same Cell as rhs variable, or gets a fresh Cell for expressions",
    },

    ASSIGN_COPY: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
            const rhsValue = evaluate(args[1]);
            const newValue = shallowCopyValue(rhsValue);
            copyAllMeta(rhsValue, newValue, "shallow");
            context.setFresh(name, newValue);
            return newValue;
        },
        doc: "Fresh copied-cell assignment (:=) — shallow-copy value + all meta into new binding",
    },

    ASSIGN_UPDATE: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
            const rhsValue = evaluate(args[1]);
            return performUpdate(name, rhsValue, context, "shallow");
        },
        doc: "In-place value replacement (~=) — preserves cell identity, ordinary meta; replaces ephemeral; preserves sticky unless rhs overrides",
    },

    ASSIGN_DEEP_COPY: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
            const rhsValue = evaluate(args[1]);
            const newValue = deepCopyValue(rhsValue);
            copyAllMeta(rhsValue, newValue, "deep");
            context.setFresh(name, newValue);
            return newValue;
        },
        doc: "Fresh deep-copied-cell assignment (::=) — deep-copy value + all meta into new binding",
    },

    ASSIGN_DEEP_UPDATE: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
            const rhsValue = evaluate(args[1]);
            return performUpdate(name, rhsValue, context, "deep");
        },
        doc: "In-place deep value replacement (~~=) — like ~= but deep-copies rhs value",
    },

    OUTER_ASSIGN: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
            const value = evaluate(args[1]);
            context.setOuter(name, value);
            return value;
        },
        doc: "Assign a value to an existing outer scope variable",
    },

    OUTER_UPDATE: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
            const rhsValue = evaluate(args[1]);
            const depth = args[2] || "shallow";
            return performOuterUpdate(name, rhsValue, context, depth);
        },
        doc: "In-place value replacement on an outer scope variable (~= / ~~= with @)",
    },

    GLOBAL: {
        lazy: true,
        impl(args, context, evaluate) {
            const name = resolveAssignName(args[0], evaluate);
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
            throw new Error(`Unrecognized operator "${op}"`);
        },
        pure: true,
        doc: "Fallback for unrecognized binary operators",
    },
};
