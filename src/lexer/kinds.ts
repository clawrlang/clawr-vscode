const PUNCTUATION = [
    '=',
    '(',
    ')',
    '{',
    '}',
    '[',
    ']',
    ',',
    '.',
    ';',
    ':',
    '@',
    '+=',
    '-=',
    '/=',
    '*=',
    '&&=',
    '||=',
    '&=',
    '|=',
    '<<=',
    '>>=',
    '[>',
    '|>',
    '->',
    '=>',
] as const

const OPERATORS = [
    '+',
    '-',
    '*',
    '/',
    '%',
    '!',
    '&',
    '|',
    '~',
    '^',
    '<',
    '≤',
    '>',
    '≥',
    '.',
    '...',
    '..',
    '..<',
    '&&',
    '||',
    '==',
    '===',
    '!=',
    '≠',
    '!==',
    '<=',
    '>=',
    '<<',
    '>>',
    '??',
    '?.',
] as const

const ALL_KW = [
    // Variable Semantics
    'const',
    'mut',
    'ref',

    // Functions / methods / operators
    `func`,
    'pure',
    `operator`,

    // Types
    `enum`,
    'union',
    'data',
    'object',
    'service',
    'role',
    'trait',

    // Inheritance hierarchy
    `self`,
    `super`,
    'inheritance',

    // Function modifiers
    'helper',
    `mutating`,
    'atomic',
    'concurrent',

    // Control flow
    `return`,
    `continue`,
    `break`,
    `if`,
    `else`,
    `guard`,
    `switch`,
    `when`,
    `is`,
    `case`,
    `do`,
    `while`,
    `for`,
    `in`,
    `and`,
    `or`,
    `throw`,
    `throws`,
    `try`,
    `catch`,

    // Modules
    'import',
    'from',
    'as',
] as const

const ALL_TRUTH_LITERALS = ['false', 'ambiguous', 'true'] as const

export type PunctuationSymbol = (typeof PUNCTUATION)[number]
export type Operator = (typeof OPERATORS)[number]
export type Keyword = (typeof ALL_KW)[number]
export type TruthLiteral = (typeof ALL_TRUTH_LITERALS)[number]

export const punctuationSymbols = new Set(PUNCTUATION)
export const operators = new Set<string>(OPERATORS)
export const keywords = new Set<string>(ALL_KW)
export const punctuationChars = new Set<string>(
    [...PUNCTUATION, ...OPERATORS].flat(),
)
export const truthValues = new Set<string>(ALL_TRUTH_LITERALS)
