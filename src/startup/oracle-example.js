import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../context.js";
import { createDefaultSystemContext, parseAndEvaluate } from "../evaluator.js";
import { installRegisteredTypes, typeRegistry } from "../type-system.js";

const STARTUP_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "oracle-example.rix");

export function loadOracleExampleStartup(registry) {
    if (typeRegistry.has("Oracle")) {
        if (registry) installRegisteredTypes(registry, ["Oracle"]);
        return registry;
    }

    const context = new Context();
    context.setEnv("__registry__", registry);
    parseAndEvaluate(fs.readFileSync(STARTUP_PATH, "utf8"), {
        context,
        registry,
        systemContext: createDefaultSystemContext(),
    });
    return registry;
}
