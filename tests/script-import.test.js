import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { Integer } from "@ratmath/core";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { Context } from "../src/context.js";
import { createDefaultRegistry, createDefaultSystemContext, evaluate } from "../src/evaluator.js";
import { installSymbolicBindings } from "../src/functions/symbolic.js";
import { runtimeDefaults } from "../src/runtime-config.js";

const TMP_ROOT = path.resolve(process.cwd(), "tmp", "script-import-tests");

function writeScripts(files) {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, "case-"));
    for (const [name, source] of Object.entries(files)) {
        const fullPath = path.join(dir, `${name}.rix`);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, source, "utf8");
    }
    return dir;
}

function evalRix(code, options = {}) {
    const context = options.context || new Context();
    installSymbolicBindings(context);
    if (options.scriptBaseDir) {
        context.setEnv("scriptBaseDir", options.scriptBaseDir);
    }
    if (options.capabilityGroups) {
        context.setEnv("capabilityGroups", options.capabilityGroups);
    }
    if (options.defaultScriptCapabilityPolicy) {
        context.setEnv("defaultScriptCapabilityPolicy", options.defaultScriptCapabilityPolicy);
    }
    if (options.scriptPermissionNames) {
        context.setEnv("scriptPermissionNames", options.scriptPermissionNames);
    }

    const registry = createDefaultRegistry();
    const systemContext = options.systemContext || createDefaultSystemContext();
    const ir = lower(parse(tokenize(code)));

    let result = null;
    for (const node of ir) {
        result = evaluate(node, context, registry, systemContext);
    }

    return { result, context, systemContext };
}

function makeSystemContext(extraDefs = {}) {
    const ctx = createDefaultSystemContext({ frozen: false });
    for (const [name, impl] of Object.entries(extraDefs)) {
        ctx.register(name, {
            impl,
            doc: `Test capability ${name}`,
        });
    }
    ctx.freeze();
    return ctx;
}

afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("script import execution", () => {
    test("basic script execution returns the final expression value", () => {
        const dir = writeScripts({
            const: "40 + 2",
        });

        const { result } = evalRix('<"const">', { scriptBaseDir: dir });
        expect(result.value).toBe(42n);
    });

    test("explicit exports return an export bundle", () => {
        const dir = writeScripts({
            poly: "r := 9; d := 3; < result=r, deriv=d >",
        });

        const { result } = evalRix('<"poly">', { scriptBaseDir: dir });
        expect(result.type).toBe("export_bundle");
        expect(Array.from(result.entries.keys())).toEqual(["result", "deriv"]);
        expect(result.entries.get("result").value.value).toBe(9n);
        expect(result.entries.get("deriv").value.value).toBe(3n);
    });

    test("caller-side output bindings write bindings from the export bundle", () => {
        const dir = writeScripts({
            poly: "< x >; r := x * x; d := 2 * x; < result=r, deriv=d >",
        });

        const { result } = evalRix('x := 5; <"poly" x ; p=result, d=deriv>; [p, d]', { scriptBaseDir: dir });
        expect(result.values[0].value).toBe(25n);
        expect(result.values[1].value).toBe(10n);
    });

    test("caller output bindings happen before the surrounding assignment rebinds the lhs", () => {
        const dir = writeScripts({
            one: "a := 7; < a= >",
        });

        const { context } = evalRix('m = <"one" ; m=a>; m', { scriptBaseDir: dir });
        const stored = context.get("m");
        expect(stored.type).toBe("export_bundle");
        expect(stored.entries.get("a").value.value).toBe(7n);
    });

    test("fresh execution produces distinct live export cells", () => {
        const dir = writeScripts({
            counter: "n := 0; < n= >",
        });

        const { result } = evalRix('a = <"counter" ; c=n>; b = <"counter" ; d=n>; c += 1; [c, d, a[:n], b[:n]]', { scriptBaseDir: dir });
        expect(result.values.map((entry) => entry.value)).toEqual([1n, 0n, 1n, 0n]);
    });

    test("live exported cells remain usable after the script frame ends", () => {
        const dir = writeScripts({
            counter: "n := 0; < n= >",
        });

        const { result } = evalRix('bundle = <"counter" ; live=n>; live += 2; [live, bundle[:n]]', { scriptBaseDir: dir });
        expect(result.values[0].value).toBe(2n);
        expect(result.values[1].value).toBe(2n);
    });

    test("copy exports stay isolated from live exports", () => {
        const dir = writeScripts({
            duo: "n := 0; < live=n, copy~n >",
        });

        const { result } = evalRix('bundle = <"duo" ; live=live, frozen=copy>; live += 3; [live, frozen, bundle[:live], bundle[:copy]]', { scriptBaseDir: dir });
        expect(result.values.map((entry) => entry.value)).toEqual([3n, 0n, 3n, 0n]);
    });

    test("input aliasing lets the script mutate the caller cell", () => {
        const dir = writeScripts({
            worker: "< state= >; state += 1; state",
        });

        const { context } = evalRix('data := 5; <"worker" state=data>; data', { scriptBaseDir: dir });
        expect(context.get("data").value).toBe(6n);
    });

    test("input copy variants isolate the caller cell", () => {
        const dir = writeScripts({
            worker: "< state >; state += 1; state",
        });

        const { context } = evalRix('data := 5; <"worker" state~data>; data', { scriptBaseDir: dir });
        expect(context.get("data").value).toBe(5n);
    });

    test("bare input names read the current scope while @name targets an ancestor scope", () => {
        const dir = writeScripts({
            worker: "< state= >; state += 1; state",
        });

        const { result } = evalRix('x := 1; {; x := 10; [<"worker" state=x>, <"worker" state=@x>, x, @x] }', { scriptBaseDir: dir });
        expect(result.values.map((entry) => entry.value)).toEqual([11n, 2n, 11n, 2n]);
    });

    test("capability groups and ordered modifiers are processed left-to-right", () => {
        const dir = writeScripts({
            arith: "@+(1, 2)",
            core: ".LEN([1, 2, 3])",
            aonly: ".AONLY()",
            bonly: ".BONLY()",
        });

        const systemContext = makeSystemContext({
            AONLY() { return new Integer(11n); },
            BONLY() { return new Integer(29n); },
        });
        const capabilityGroups = {
            ...runtimeDefaults.capabilityGroups,
            A: ["AONLY"],
            AB: ["AONLY", "BONLY"],
        };

        expect(evalRix('<"arith" /-All,+Arith/>', { scriptBaseDir: dir, systemContext }).result.value).toBe(3n);
        expect(evalRix('<"core" /-All,+Core/>', { scriptBaseDir: dir, systemContext }).result.value).toBe(3n);
        expect(evalRix('<"aonly" /-All,+AB,-AB,+A/>', {
            scriptBaseDir: dir,
            systemContext,
            capabilityGroups,
        }).result.value).toBe(11n);
        expect(() => evalRix('<"bonly" /-All,+AB,-AB,+A/>', {
            scriptBaseDir: dir,
            systemContext,
            capabilityGroups,
        })).toThrow("Unknown system capability: BONLY");
        expect(evalRix('<"aonly" /-All,+@AONLY/>', {
            scriptBaseDir: dir,
            systemContext,
            capabilityGroups,
        }).result.value).toBe(11n);
    });

    test("nested scripts cannot gain capabilities that their parent lacks", () => {
        const dir = writeScripts({
            parent: '<"child" /+Net/>',
            child: ".NETPING()",
        });

        const systemContext = makeSystemContext({
            NETPING() { return new Integer(1n); },
        });
        const capabilityGroups = {
            ...runtimeDefaults.capabilityGroups,
            Net: ["NETPING"],
        };

        expect(() => evalRix('<"parent" /-All,+Core,+Imports/>', {
            scriptBaseDir: dir,
            systemContext,
            capabilityGroups,
        })).toThrow("Unknown system capability: NETPING");
    });

    test("cyclic imports error while active recursion is in flight", () => {
        const dir = writeScripts({
            a: '<"b">',
            b: '<"a">',
        });

        expect(() => evalRix('<"a">', { scriptBaseDir: dir })).toThrow("Cyclic script import detected");
    });

    test("nested imports fail when the Imports capability is absent", () => {
        const dir = writeScripts({
            parent: '<"leaf">',
            leaf: "1",
        });

        expect(() => evalRix('<"parent" /-All,+Core/>', { scriptBaseDir: dir })).toThrow("Script imports are not allowed");
    });

    test("caller outputs are rejected for scripts without explicit exports", () => {
        const dir = writeScripts({
            const: "1",
        });

        expect(() => evalRix('<"const" ; p=result>', { scriptBaseDir: dir })).toThrow(
            "Caller-side script outputs require the imported script to declare exports",
        );
    });
});
