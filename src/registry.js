/**
 * System Function Registry
 *
 * Maps IR function names to their implementations.
 * Each entry: { impl: Function, lazy: boolean, pure: boolean, doc: string }
 *
 * "Lazy" functions receive raw IR nodes (unevaluated) as arguments.
 * The evaluator checks this flag before deciding whether to pre-evaluate args.
 */

export class Registry {
    constructor() {
        this.functions = new Map();
        this._overrides = new Map(); // saved originals when overridden
    }

    /**
     * Register a system function.
     * @param {string} name - IR function name (e.g. "ADD", "ASSIGN")
     * @param {Function} impl - Implementation: (args, context, evaluate) => value
     * @param {Object} options
     * @param {boolean} [options.lazy=false] - If true, args are passed as raw IR nodes
     * @param {boolean} [options.pure=false] - If true, function has no side effects
     * @param {string} [options.doc=""] - Documentation string
     */
    register(name, impl, options = {}) {
        this.functions.set(name, {
            impl,
            lazy: options.lazy || false,
            pure: options.pure || false,
            doc: options.doc || "",
        });
    }

    /**
     * Register multiple functions from an object { NAME: { impl, lazy?, pure?, doc? } }
     */
    registerAll(defs) {
        for (const [name, def] of Object.entries(defs)) {
            if (typeof def === "function") {
                this.register(name, def);
            } else {
                this.register(name, def.impl, def);
            }
        }
    }

    /**
     * Get a function definition by name.
     * @returns {{ impl, lazy, pure, doc } | undefined}
     */
    get(name) {
        return this.functions.get(name);
    }

    /**
     * Check if a function is registered.
     */
    has(name) {
        return this.functions.has(name);
    }

    /**
     * Call a system function by name.
     * @param {string} name
     * @param {Array} args - Evaluated args (or raw IR if lazy)
     * @param {Context} context
     * @param {Function} evaluate - The evaluate function (for lazy functions that need to evaluate sub-expressions)
     * @returns {*} The result
     */
    call(name, args, context, evaluate) {
        const func = this.functions.get(name);
        if (!func) {
            throw new Error(`Unknown system function: ${name}`);
        }
        return func.impl(args, context, evaluate);
    }

    /**
     * Override a function implementation (saves original for restore).
     */
    override(name, newImpl) {
        const original = this.functions.get(name);
        if (original && !this._overrides.has(name)) {
            this._overrides.set(name, original);
        }
        this.functions.set(name, {
            ...(original || {}),
            impl: newImpl,
        });
    }

    /**
     * Restore a previously overridden function.
     */
    restore(name) {
        const original = this._overrides.get(name);
        if (original) {
            this.functions.set(name, original);
            this._overrides.delete(name);
        }
    }

    /**
     * List all registered function names.
     */
    list() {
        return Array.from(this.functions.keys()).sort();
    }

    /**
     * List all registered function names (alias for list).
     */
    getAllNames() {
        return this.list();
    }
}
