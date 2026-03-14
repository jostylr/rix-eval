import { Integer, Rational } from "@ratmath/core";

function rixString(value) {
    return { type: "string", value };
}

function rixTuple(values) {
    return { type: "tuple", values };
}

function rixMap(entries) {
    return {
        type: "map",
        entries: new Map(entries),
    };
}

function mapEntry(mapValue, key) {
    if (!mapValue || mapValue.type !== "map" || !(mapValue.entries instanceof Map)) {
        throw new Error(`Expected map value while reading '${key}'`);
    }
    return mapValue.entries.get(key);
}

function tupleValues(value, label) {
    if (!value || value.type !== "tuple" || !Array.isArray(value.values)) {
        throw new Error(`Expected tuple for ${label}`);
    }
    return value.values;
}

function stringValue(value, label) {
    if (typeof value === "string") return value;
    if (value && value.type === "string") return value.value;
    throw new Error(`Expected string for ${label}`);
}

function operatorName(fn) {
    const names = {
        ADD: "+",
        SUB: "-",
        MUL: "*",
        DIV: "/",
        INTDIV: "//",
        MOD: "%",
        POW: "^",
        EQ: "==",
        NEQ: "!=",
        LT: "<",
        GT: ">",
        LTE: "<=",
        GTE: ">=",
        AND: "&&",
        OR: "||",
    };
    return names[fn] ?? null;
}

function serializeIrArg(arg) {
    if (arg === null || arg === undefined) {
        return rixMap([["kind", rixString("null")]]);
    }
    if (typeof arg === "string") {
        return rixString(arg);
    }
    if (typeof arg === "number" || typeof arg === "bigint") {
        return rixMap([
            ["kind", rixString("number")],
            ["value", rixString(String(arg))],
        ]);
    }
    if (Array.isArray(arg)) {
        return rixTuple(arg.map(serializeIrArg));
    }
    if (!arg.fn) {
        return rixMap(Object.entries(arg).map(([key, value]) => [key, serializeIrArg(value)]));
    }
    return serializeExprIr(arg);
}

export function serializeExprIr(node) {
    if (!node || typeof node !== "object" || !node.fn) {
        return serializeIrArg(node);
    }

    if (node.fn === "LITERAL") {
        return rixMap([
            ["kind", rixString("number")],
            ["value", rixString(node.args[0])],
        ]);
    }

    if (node.fn === "STRING") {
        return rixMap([
            ["kind", rixString("string")],
            ["value", rixString(node.args[0])],
        ]);
    }

    if (node.fn === "NULL") {
        return rixMap([["kind", rixString("null")]]);
    }

    if (node.fn === "RETRIEVE") {
        return rixMap([
            ["kind", rixString("identifier")],
            ["name", rixString(node.args[0])],
        ]);
    }

    if (node.fn === "OUTER_RETRIEVE") {
        return rixMap([
            ["kind", rixString("outer")],
            ["name", rixString(node.args[0])],
        ]);
    }

    if (node.fn === "SYSREF") {
        return rixMap([
            ["kind", rixString("sysref")],
            ["name", rixString(node.args[0])],
        ]);
    }

    if (node.fn === "NEG") {
        return rixMap([
            ["kind", rixString("unary")],
            ["op", rixString("-")],
            ["expr", serializeExprIr(node.args[0])],
        ]);
    }

    const op = operatorName(node.fn);
    if (op) {
        return rixMap([
            ["kind", rixString("binary")],
            ["op", rixString(op)],
            ["left", serializeExprIr(node.args[0])],
            ["right", serializeExprIr(node.args[1])],
        ]);
    }

    if (node.fn === "CALL") {
        return rixMap([
            ["kind", rixString("call")],
            ["target", rixMap([
                ["kind", rixString("identifier")],
                ["name", rixString(node.args[0])],
            ])],
            ["args", rixTuple(node.args.slice(1).map(serializeExprIr))],
        ]);
    }

    if (node.fn === "CALL_EXPR") {
        return rixMap([
            ["kind", rixString("call")],
            ["target", serializeExprIr(node.args[0])],
            ["args", rixTuple(node.args.slice(1).map(serializeExprIr))],
        ]);
    }

    if (node.fn === "SYS_CALL") {
        return rixMap([
            ["kind", rixString("call")],
            ["target", rixMap([
                ["kind", rixString("sysref")],
                ["name", rixString(node.args[0])],
            ])],
            ["args", rixTuple(node.args.slice(1).map(serializeExprIr))],
        ]);
    }

    return rixMap([
        ["kind", rixString("ir")],
        ["fn", rixString(node.fn)],
        ["args", rixTuple(node.args.map(serializeIrArg))],
    ]);
}

function specValue(meta) {
    const entries = [
        ["kind", rixString("systemSpec")],
        ["syntax", rixString("#")],
        ["inputs", rixTuple((meta.inputs || []).map(rixString))],
        ["outputs", rixTuple((meta.outputs || []).map(rixString))],
        ["statements", rixTuple((meta.statements || []).map((statement) => rixMap([
            ["kind", rixString("assign")],
            ["target", rixString(statement.target)],
            ["expr", serializeExprIr(statement.expr)],
        ])))],
    ];
    if (meta.imports && meta.imports.length > 0) {
        entries.push(["imports", rixTuple(meta.imports.map((spec) => rixMap([
            ["local", rixString(spec.local)],
            ["source", rixString(spec.source)],
            ["mode", rixString(spec.mode)],
        ])))]);
    }
    return rixMap(entries);
}

function parseNumberLiteral(text) {
    if (/^-?\d+$/.test(text)) {
        return new Integer(BigInt(text));
    }
    const rational = text.match(/^(-?\d+)\/(\d+)$/);
    if (rational) {
        return new Rational(BigInt(rational[1]), BigInt(rational[2]));
    }
    const decimal = text.match(/^(-?\d+)\.(\d+)$/);
    if (decimal) {
        const sign = decimal[1].startsWith("-") ? -1n : 1n;
        const whole = BigInt(decimal[1].replace("-", ""));
        const frac = decimal[2];
        const den = 10n ** BigInt(frac.length);
        return new Rational(sign * (whole * den + BigInt(frac)), den);
    }
    throw new Error(`Unsupported numeric literal '${text}' in symbolic polynomial helper`);
}

function exactInteger(value, label) {
    if (value instanceof Integer) {
        return Number(value.value);
    }
    if (value instanceof Rational && value.denominator === 1n) {
        return Number(value.numerator);
    }
    throw new Error(`${label} must be an exact integer`);
}

function evalPolyExpr(node, env) {
    const kind = stringValue(mapEntry(node, "kind"), "expression kind");
    if (kind === "number") {
        return parseNumberLiteral(stringValue(mapEntry(node, "value"), "number literal"));
    }
    if (kind === "identifier") {
        const name = stringValue(mapEntry(node, "name"), "identifier name");
        if (!env.has(name)) {
            throw new Error(`Poly cannot resolve symbolic identifier '${name}'`);
        }
        return env.get(name);
    }
    if (kind === "outer") {
        const name = stringValue(mapEntry(node, "name"), "outer identifier name");
        throw new Error(`Poly does not support unresolved outer reference '@${name}'`);
    }
    if (kind === "unary") {
        const op = stringValue(mapEntry(node, "op"), "unary operator");
        if (op !== "-") {
            throw new Error(`Poly does not support unary operator '${op}'`);
        }
        return new Integer(0).subtract(evalPolyExpr(mapEntry(node, "expr"), env));
    }
    if (kind === "binary") {
        const op = stringValue(mapEntry(node, "op"), "binary operator");
        const left = evalPolyExpr(mapEntry(node, "left"), env);
        const right = evalPolyExpr(mapEntry(node, "right"), env);
        if (op === "+") return left.add(right);
        if (op === "-") return left.subtract(right);
        if (op === "*") return left.multiply(right);
        if (op === "^") return left.pow(exactInteger(right, "Exponent"));
        throw new Error(`Poly does not support operator '${op}'`);
    }
    throw new Error(`Poly does not support symbolic node kind '${kind}'`);
}

function derivExpr(node, variableName) {
    const kind = stringValue(mapEntry(node, "kind"), "expression kind");
    if (kind === "number" || kind === "null" || kind === "string") {
        return rixMap([
            ["kind", rixString("number")],
            ["value", rixString("0")],
        ]);
    }
    if (kind === "identifier") {
        const name = stringValue(mapEntry(node, "name"), "identifier name");
        return rixMap([
            ["kind", rixString("number")],
            ["value", rixString(name === variableName ? "1" : "0")],
        ]);
    }
    if (kind === "outer") {
        return rixMap([
            ["kind", rixString("number")],
            ["value", rixString("0")],
        ]);
    }
    if (kind === "unary") {
        const op = stringValue(mapEntry(node, "op"), "unary operator");
        if (op !== "-") {
            throw new Error(`Deriv does not support unary operator '${op}'`);
        }
        return rixMap([
            ["kind", rixString("unary")],
            ["op", rixString("-")],
            ["expr", derivExpr(mapEntry(node, "expr"), variableName)],
        ]);
    }
    if (kind !== "binary") {
        throw new Error(`Deriv does not support symbolic node kind '${kind}'`);
    }

    const op = stringValue(mapEntry(node, "op"), "binary operator");
    const left = mapEntry(node, "left");
    const right = mapEntry(node, "right");

    if (op === "+") {
        return rixMap([
            ["kind", rixString("binary")],
            ["op", rixString("+")],
            ["left", derivExpr(left, variableName)],
            ["right", derivExpr(right, variableName)],
        ]);
    }

    if (op === "-") {
        return rixMap([
            ["kind", rixString("binary")],
            ["op", rixString("-")],
            ["left", derivExpr(left, variableName)],
            ["right", derivExpr(right, variableName)],
        ]);
    }

    if (op === "*") {
        return rixMap([
            ["kind", rixString("binary")],
            ["op", rixString("+")],
            ["left", rixMap([
                ["kind", rixString("binary")],
                ["op", rixString("*")],
                ["left", derivExpr(left, variableName)],
                ["right", right],
            ])],
            ["right", rixMap([
                ["kind", rixString("binary")],
                ["op", rixString("*")],
                ["left", left],
                ["right", derivExpr(right, variableName)],
            ])],
        ]);
    }

    if (op === "^") {
        const exponentNode = right;
        const exponentKind = stringValue(mapEntry(exponentNode, "kind"), "power exponent kind");
        if (exponentKind !== "number") {
            throw new Error("Deriv only supports powers with nonnegative integer literal exponents");
        }
        const exponentText = stringValue(mapEntry(exponentNode, "value"), "power exponent");
        if (!/^\d+$/.test(exponentText)) {
            throw new Error("Deriv only supports powers with nonnegative integer literal exponents");
        }
        const exponent = BigInt(exponentText);
        if (exponent === 0n) {
            return rixMap([
                ["kind", rixString("number")],
                ["value", rixString("0")],
            ]);
        }
        const decremented = rixMap([
            ["kind", rixString("number")],
            ["value", rixString(String(exponent - 1n))],
        ]);
        return rixMap([
            ["kind", rixString("binary")],
            ["op", rixString("*")],
            ["left", rixMap([
                ["kind", rixString("number")],
                ["value", rixString(String(exponent))],
            ])],
            ["right", rixMap([
                ["kind", rixString("binary")],
                ["op", rixString("*")],
                ["left", rixMap([
                    ["kind", rixString("binary")],
                    ["op", rixString("^")],
                    ["left", left],
                    ["right", decremented],
                ])],
                ["right", derivExpr(left, variableName)],
            ])],
        ]);
    }

    throw new Error(`Deriv does not support operator '${op}'`);
}

function cloneSpecWithStatements(spec, statements) {
    const entries = new Map(spec.entries);
    entries.set("statements", rixTuple(statements));
    return {
        type: "map",
        entries,
    };
}

function polyFromSpec(spec) {
    const kind = stringValue(mapEntry(spec, "kind"), "spec kind");
    if (kind !== "systemSpec") {
        throw new Error("Poly expects a systemSpec value");
    }

    const inputNames = tupleValues(mapEntry(spec, "inputs"), "spec inputs").map((value) => stringValue(value, "input name"));
    const outputNames = tupleValues(mapEntry(spec, "outputs"), "spec outputs").map((value) => stringValue(value, "output name"));
    const statements = tupleValues(mapEntry(spec, "statements"), "spec statements");

    if (outputNames.length !== 1) {
        throw new Error("Poly currently supports exactly one output");
    }

    return (...args) => {
        if (args.length !== inputNames.length) {
            throw new Error(`Poly expected ${inputNames.length} argument(s) but received ${args.length}`);
        }
        const env = new Map();
        for (let i = 0; i < inputNames.length; i++) {
            env.set(inputNames[i], args[i]);
        }

        for (const statement of statements) {
            const statementKind = stringValue(mapEntry(statement, "kind"), "statement kind");
            if (statementKind !== "assign") {
                throw new Error(`Poly only supports assign statements, got '${statementKind}'`);
            }
            const target = stringValue(mapEntry(statement, "target"), "assignment target");
            const value = evalPolyExpr(mapEntry(statement, "expr"), env);
            env.set(target, value);
        }

        return env.get(outputNames[0]) ?? null;
    };
}

function derivSpec(spec, variableNameRaw) {
    const kind = stringValue(mapEntry(spec, "kind"), "spec kind");
    if (kind !== "systemSpec") {
        throw new Error("Deriv expects a systemSpec value");
    }
    const variableName = stringValue(variableNameRaw, "derivative variable");
    const statements = tupleValues(mapEntry(spec, "statements"), "spec statements").map((statement) => {
        const statementKind = stringValue(mapEntry(statement, "kind"), "statement kind");
        if (statementKind !== "assign") {
            throw new Error(`Deriv only supports assign statements, got '${statementKind}'`);
        }
        return rixMap([
            ["kind", rixString("assign")],
            ["target", mapEntry(statement, "target")],
            ["expr", derivExpr(mapEntry(statement, "expr"), variableName)],
        ]);
    });
    return cloneSpecWithStatements(spec, statements);
}

export function installSymbolicBindings(context) {
    context.setGlobal("POLY", polyFromSpec);
    context.setGlobal("DERIV", derivSpec);
    context.setGlobal("Poly", polyFromSpec);
    context.setGlobal("Deriv", derivSpec);
}

export const symbolicFunctions = {
    SYSTEM_SPEC: {
        lazy: true,
        impl(args) {
            return specValue(args[0] || {});
        },
        pure: true,
        doc: "Create a symbolic system specification value",
    },
};
