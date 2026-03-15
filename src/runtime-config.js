export const runtimeDefaults = Object.freeze({
  defaultLoopMax: 10000,
  scriptPermissionNames: Object.freeze(["IMPORTS", "NET", "FILES"]),
  defaultScriptCapabilityPolicy: Object.freeze({
    includeAllFunctions: true,
    permissions: Object.freeze(["IMPORTS"]),
  }),
  capabilityGroups: Object.freeze({
    Core: Object.freeze(["LEN", "FIRST", "LAST", "GETEL", "IRANGE", "IF", "MULTI", "RAND_NAME", "PRINT", "TGEN", "KEYOF", "KEYS", "VALUES"]),
    Arith: Object.freeze(["ADD", "SUB", "MUL", "DIV", "INTDIV", "MOD", "POW"]),
    Logic: Object.freeze(["EQ", "NEQ", "LT", "GT", "LTE", "GTE", "AND", "OR", "NOT"]),
    Collections: Object.freeze(["LEN", "FIRST", "LAST", "GETEL", "IRANGE", "MAP", "FILTER", "REDUCE", "TGEN"]),
    Maps: Object.freeze(["MAP", "KEYOF", "KEYS", "VALUES"]),
    Arrays: Object.freeze(["LEN", "FIRST", "LAST", "GETEL", "IRANGE", "MAP", "FILTER", "REDUCE", "TGEN"]),
    Strings: Object.freeze(["UPPER", "SUBSTR", "PRINT"]),
    Imports: Object.freeze(["IMPORTS"]),
    Net: Object.freeze(["NET"]),
    Files: Object.freeze(["FILES"]),
  }),
});
