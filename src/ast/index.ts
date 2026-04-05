// AST for Clawr data structures and related constructs

export interface ASTPosition {
    line: number
    column: number
}

export type ASTVisibility = 'public' | 'helper'

export interface ASTImportItem {
    name: string
    alias?: string
    position: ASTPosition
}

export interface ASTImportDeclaration {
    kind: 'import'
    items: ASTImportItem[]
    modulePath: string
    position: ASTPosition
}

// ----- Expressions -----
export type ASTExpression =
    | ASTIntegerLiteral
    | ASTTruthValueLiteral
    | ASTStringLiteral
    | ASTArrayLiteral
    | ASTWhenExpression
    | ASTIdentifier
    | ASTDataLiteral
    | ASTCopyExpression
    | ASTCallExpression
    | ASTBinaryExpression

export interface ASTIntegerLiteral {
    kind: 'integer'
    value: bigint
    position: ASTPosition
}

export interface ASTTruthValueLiteral {
    kind: 'truthvalue'
    value: 'false' | 'ambiguous' | 'true'
    position: ASTPosition
}

export interface ASTStringLiteral {
    kind: 'string'
    value: string
    position: ASTPosition
}

export interface ASTArrayLiteral {
    kind: 'array-literal'
    elements: ASTExpression[]
    position: ASTPosition
}

export interface ASTIdentifier {
    kind: 'identifier'
    name: string
    position: ASTPosition
}

export interface ASTDataLiteralField {
    value: ASTExpression
    namePosition: ASTPosition
}

export interface ASTDataLiteral {
    kind: 'data-literal'
    fields: { [field: string]: ASTDataLiteralField }
    superInitializer?: ASTCallExpression
    position: ASTPosition
}

export interface ASTCopyExpression {
    kind: 'copy'
    value: ASTExpression
    position: ASTPosition
}

export interface ASTCallExpression {
    kind: 'call'
    callee: ASTExpression
    arguments: ASTCallArgument[]
    position: ASTPosition
}

export interface ASTCallArgument {
    label?: string
    value: ASTExpression
}

export interface ASTBinaryExpression {
    kind: 'binary'
    operator: string
    left: ASTExpression
    right: ASTExpression
    position: ASTPosition
}

export type ASTWhenPattern =
    | {
          kind: 'wildcard-pattern'
          position: ASTPosition
      }
    | {
          kind: 'value-pattern'
          value: ASTExpression
          position: ASTPosition
      }

export interface ASTWhenExpression {
    kind: 'when'
    subject: ASTExpression
    branches: Array<{
        pattern: ASTWhenPattern
        value: ASTExpression
    }>
    position: ASTPosition
}

// ----- Function declarations -----
export interface ASTFunctionParameter {
    label?: string // external label; absent means positional/unlabeled
    name: string // internal binding name
    type: string
    semantics?: 'const' | 'mut' | 'ref'
    position: ASTPosition
}

export interface ASTFunctionDeclaration {
    kind: 'func-decl'
    name: string
    visibility: ASTVisibility
    parameters: ASTFunctionParameter[]
    returnType?: string // absent means void / no annotation
    returnSemantics?: 'const' | 'ref' // absent = unique/unbound return
    body: ASTFunctionBody
    position: ASTPosition
}

// Block body `{ stmts }` or shorthand body `=> expr`
export type ASTFunctionBody =
    | { kind: 'block'; statements: ASTStatement[] }
    | { kind: 'expression'; value: ASTExpression }

// ----- Statements -----
// ----- Object / Service declarations -----
export type ASTObjectField = {
    semantics?: 'const' | 'mut' | 'ref'
    name: string
    type: string
    position?: ASTPosition
}

export type ASTObjectSection =
    | { kind: 'methods'; items: ASTFunctionDeclaration[] }
    | { kind: 'data'; fields: ASTObjectField[] }
    | { kind: 'mutating'; items: ASTFunctionDeclaration[] }
    | { kind: 'inheritance'; items: ASTFunctionDeclaration[] }

export interface ASTObjectDeclaration {
    kind: 'object-decl'
    name: string
    supertype?: string
    supertypePosition?: ASTPosition
    visibility: ASTVisibility
    sections: ASTObjectSection[]
    position: ASTPosition
}

export interface ASTServiceDeclaration {
    kind: 'service-decl'
    name: string
    visibility: ASTVisibility
    sections: ASTObjectSection[]
    position: ASTPosition
}

// ----- Statements -----
export type ASTStatement =
    | ASTVariableDeclaration
    | ASTPrintStatement
    | ASTAssignment
    | ASTIfStatement
    | ASTWhileStatement
    | ASTForInStatement
    | ASTBreakStatement
    | ASTContinueStatement
    | ASTReturnStatement
    | ASTDataDeclaration
    | ASTFunctionDeclaration
    | ASTObjectDeclaration
    | ASTServiceDeclaration

export interface ASTAssignment {
    kind: 'assign'
    target: ASTExpression
    value: ASTExpression
    position: ASTPosition
}

export interface ASTDataDeclaration {
    kind: 'data-decl'
    name: string
    visibility: ASTVisibility
    fields: {
        semantics?: 'const' | 'mut' | 'ref'
        name: string
        type: string
        position?: ASTPosition
    }[]
    position: ASTPosition
}

export interface ASTIfStatement {
    kind: 'if'
    condition: ASTExpression
    thenBranch: ASTStatement[]
    elseBranch?: ASTStatement[]
    position: ASTPosition
}

export interface ASTWhileStatement {
    kind: 'while'
    condition: ASTExpression
    body: ASTStatement[]
    position: ASTPosition
}

export interface ASTForInStatement {
    kind: 'for-in'
    loopVar: string
    iterable: ASTExpression
    body: ASTStatement[]
    position: ASTPosition
}

export interface ASTReturnStatement {
    kind: 'return'
    value?: ASTExpression
    position: ASTPosition
}

export interface ASTBreakStatement {
    kind: 'break'
    position: ASTPosition
}

export interface ASTContinueStatement {
    kind: 'continue'
    position: ASTPosition
}

export interface ASTPrintStatement {
    kind: 'print'
    value: ASTExpression
    position: ASTPosition
}

export interface ASTVariableDeclaration {
    kind: 'var-decl'
    semantics: 'const' | 'mut' | 'ref'
    name: string
    valueSet?: ASTValueSet
    value: ASTExpression
    position: ASTPosition
}

// Placeholder for lattice information. This will be used for various analyses
// and optimizations, but for now we just need to represent the 'top' set of
// each lattice — all possible values — represented by its type. In the future,
// this will need to be more complex to support different restrictions on the
// values, e.g., for integers we might want to represent a range, and for truth
// values we might want to represent subsets of {false, ambiguous, true}. For
// now, we just use a simple type field to represent the top of the lattice.
export type ASTValueSet = {
    type: string
}

// ----- Top-level module structure -----
export interface ASTProgram {
    imports: ASTImportDeclaration[]
    body: ASTStatement[]
}
