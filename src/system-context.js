/**
 * SystemContext — the RiX system capability object (`.`)
 *
 * Holds all user-accessible system functions (stdlib + operator aliases).
 * Accessible in RiX code only via the leading-dot syntax: .Name(args)
 *
 * Supports copying, freezing, and withholding capabilities for sandboxing.
 * The default instance is frozen; hosts build custom instances before freezing.
 */

export class SystemContext {
    /**
     * @param {Map<string, {impl, lazy, pure, doc}>} capabilities
     * @param {boolean} frozen
     */
    constructor(capabilities = new Map(), frozen = false) {
        this._capabilities = capabilities;
        this._frozen = frozen;
    }

    // --- Mutation (only allowed when unfrozen) ---

    _checkMutable() {
        if (this._frozen) throw new Error("System context is frozen and cannot be modified");
    }

    /**
     * Register a capability.
     * @param {string} name - Normalized uppercase name (e.g. "RANDNAME")
     * @param {{impl, lazy?, pure?, doc?}} def
     */
    register(name, def) {
        this._checkMutable();
        this._capabilities.set(name, {
            impl: typeof def === "function" ? def : def.impl,
            lazy: def.lazy || false,
            pure: def.pure || false,
            doc: def.doc || "",
        });
    }

    /**
     * Register multiple capabilities from an object map.
     */
    registerAll(defs) {
        for (const [name, def] of Object.entries(defs)) {
            this.register(name, def);
        }
    }

    /**
     * Remove a capability.
     */
    delete(name) {
        this._checkMutable();
        this._capabilities.delete(name);
    }

    /**
     * Freeze this context. After freezing, register/delete throw.
     */
    freeze() {
        this._frozen = true;
        return this;
    }

    // --- Reading ---

    /**
     * Get a capability definition by name.
     * @returns {{impl, lazy, pure, doc} | undefined}
     */
    get(name) {
        return this._capabilities.get(name);
    }

    /**
     * Check if a capability exists.
     */
    has(name) {
        return this._capabilities.has(name);
    }

    /**
     * Whether this context is frozen.
     */
    get frozen() {
        return this._frozen;
    }

    /**
     * Call a capability by name with pre-evaluated args.
     */
    call(name, args, context, evaluate) {
        const cap = this._capabilities.get(name);
        if (!cap) throw new Error(`Unknown system capability: ${name}. Use .${name}() or check available capabilities.`);
        return cap.impl(args, context, evaluate);
    }

    /**
     * Call a lazy capability by name (args are raw IR nodes).
     */
    callLazy(name, args, context, evaluate) {
        const cap = this._capabilities.get(name);
        if (!cap) throw new Error(`Unknown system capability: ${name}.`);
        return cap.impl(args, context, evaluate);
    }

    /**
     * Sorted list of all capability names.
     */
    getAllNames() {
        return Array.from(this._capabilities.keys()).sort();
    }

    // --- Capability object operations (return new instances) ---

    /**
     * Return a shallow copy of this context, unfrozen.
     * This is what `.` returns when used as an expression.
     */
    copy() {
        return new SystemContext(new Map(this._capabilities), false);
    }

    /**
     * Return a frozen copy with the named capabilities removed.
     * .Withhold("NET", "FILE") → restricted copy
     */
    withhold(...names) {
        const caps = new Map(this._capabilities);
        for (const name of names) {
            // Accept both raw names and normalized uppercase
            caps.delete(name.toUpperCase ? name.toUpperCase() : name);
        }
        return new SystemContext(caps, true);
    }

    /**
     * Return a frozen copy with an additional capability.
     * .With("Custom", myFn) → extended copy
     */
    with(name, def) {
        const caps = new Map(this._capabilities);
        caps.set(name, {
            impl: typeof def === "function" ? def : def.impl,
            lazy: def.lazy || false,
            pure: def.pure || false,
            doc: def.doc || "",
        });
        return new SystemContext(caps, true);
    }

    /**
     * Convert to a RiX value representation for use in the evaluator.
     * type: "system_context" wraps the SystemContext instance.
     */
    toRixValue() {
        return { type: "system_context", context: this };
    }
}

/**
 * The operator-to-name map shared between the parser (@+) and SystemContext.
 * These are the operator aliases exposed as .ADD, .SUB, etc.
 */
export const OPERATOR_ALIASES = {
    "+":  "ADD",
    "-":  "SUB",
    "*":  "MUL",
    "/":  "DIV",
    "//": "INTDIV",
    "%":  "MOD",
    "^":  "POW",
    "=":  "EQ",
    "!=": "NEQ",
    "<":  "LT",
    ">":  "GT",
    "<=": "LTE",
    ">=": "GTE",
    "&&": "AND",
    "||": "OR",
    "!":  "NOT",
};
