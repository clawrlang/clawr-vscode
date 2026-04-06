import type {
    ASTArrayLiteral,
    ASTCallArgument,
    ASTDataDeclaration,
    ASTDataLiteral,
    ASTFunctionParameter,
    ASTIdentifier,
    ASTImportDeclaration,
    ASTIntegerLiteral,
    ASTObjectDeclaration,
    ASTPosition,
    ASTServiceDeclaration,
    ASTStringLiteral,
    ASTTruthValueLiteral,
    ASTWhenPattern,
} from '../ast'

export type SemanticImportDeclaration = ASTImportDeclaration

export interface SemanticFieldAccess {
    kind: 'field-access'
    object: SemanticExpression
    field: string
    position: ASTPosition
}

export interface SemanticCopyExpression {
    kind: 'copy'
    value: SemanticExpression
    position: ASTPosition
}

export interface SemanticBinaryExpression {
    kind: 'binary'
    operator: string
    left: SemanticExpression
    right: SemanticExpression
    position: ASTPosition
}

export interface SemanticArrayLiteral {
    kind: 'array-literal'
    elements: SemanticExpression[]
    position: ASTPosition
}

export interface SemanticArrayIndexExpression {
    kind: 'array-index'
    array: SemanticExpression
    index: SemanticExpression
    elementType: string
    position: ASTPosition
}

export interface SemanticCallDispatch {
    kind: 'direct' | 'virtual'
    methodName?: string
    parameters?: SemanticFunctionParameter[]
    ownerType?: string
    receiverType?: string
}

export interface SemanticCallExpression {
    kind: 'call'
    callee: SemanticExpression
    arguments: SemanticCallArgument[]
    dispatch?: SemanticCallDispatch
    position: ASTPosition
}

export interface SemanticCallArgument extends Omit<ASTCallArgument, 'value'> {
    value: SemanticExpression
}

export type SemanticWhenPattern =
    | {
          kind: 'wildcard-pattern'
          position: ASTPosition
      }
    | {
          kind: 'value-pattern'
          value: SemanticExpression
          position: ASTPosition
      }

export interface SemanticWhenExpression {
    kind: 'when'
    subject: SemanticExpression
    branches: Array<{
        pattern: SemanticWhenPattern
        value: SemanticExpression
    }>
    position: ASTPosition
}

export type SemanticExpression =
    | ASTIntegerLiteral
    | ASTTruthValueLiteral
    | ASTStringLiteral
    | ASTIdentifier
    | ASTDataLiteral
    | SemanticArrayLiteral
    | SemanticArrayIndexExpression
    | SemanticBinaryExpression
    | SemanticCopyExpression
    | SemanticCallExpression
    | SemanticWhenExpression
    | SemanticFieldAccess

export interface SemanticValueSet {
    type: string
}

export interface SemanticOwnershipEffects {
    retains?: SemanticExpression[]
    releases?: SemanticExpression[]
    mutates?: SemanticExpression[]
    releaseAtScopeExit?: boolean
    copyValueSemantics?: '__rc_ISOLATED' | '__rc_SHARED'
}

export interface SemanticVariableDeclaration {
    kind: 'var-decl'
    semantics: 'const' | 'mut' | 'ref'
    name: string
    valueSet: SemanticValueSet
    value: SemanticExpression
    ownership: SemanticOwnershipEffects
    position?: ASTPosition
}

export interface SemanticPrintStatement {
    kind: 'print'
    value: SemanticExpression
    dispatchType: string
    position: ASTPosition
}

export interface SemanticAssignment {
    kind: 'assign'
    target: SemanticExpression
    value: SemanticExpression
    ownership: SemanticOwnershipEffects
    position: ASTPosition
}

export interface SemanticIfStatement {
    kind: 'if'
    condition: SemanticExpression
    thenBranch: SemanticStatement[]
    elseBranch?: SemanticStatement[]
    position: ASTPosition
}

export interface SemanticWhileStatement {
    kind: 'while'
    condition: SemanticExpression
    body: SemanticStatement[]
    position: ASTPosition
}

export interface SemanticForInStatement {
    kind: 'for-in'
    loopVar: string
    iterable: SemanticExpression
    elementType: string
    body: SemanticStatement[]
    position: ASTPosition
}

export interface SemanticBreakStatement {
    kind: 'break'
    position: ASTPosition
}

export interface SemanticContinueStatement {
    kind: 'continue'
    position: ASTPosition
}

export interface SemanticReturnStatement {
    kind: 'return'
    value?: SemanticExpression
    position: ASTPosition
}

export type SemanticStatement =
    | SemanticVariableDeclaration
    | SemanticPrintStatement
    | SemanticAssignment
    | SemanticIfStatement
    | SemanticWhileStatement
    | SemanticForInStatement
    | SemanticBreakStatement
    | SemanticContinueStatement
    | SemanticReturnStatement

export interface SemanticDataDeclaration extends Omit<
    ASTDataDeclaration,
    'fields'
> {
    fields: Array<
        ASTDataDeclaration['fields'][number] & {
            isReferenceCounted: boolean
        }
    >
}

export type SemanticFunctionParameter = ASTFunctionParameter

export interface SemanticFunction {
    kind: 'function'
    name: string
    parameters: SemanticFunctionParameter[]
    returnType?: string
    returnSemantics?: 'const' | 'ref'
    body: SemanticStatement[]
}

export type SemanticTypeKind = 'data' | 'object' | 'service'

export interface SemanticFunctionSignature {
    name: string
    ownerType?: string
    ownerKind?: 'object' | 'service'
    visibility: 'public' | 'helper'
    labels: string[]
    returnType?: string
    returnSemantics?: 'const' | 'ref'
    arity: number
    parameterTypes: string[]
    parameterSemantics: Array<'const' | 'mut' | 'ref'>
    effectLevel: 'pure' | 'self-mutation' | 'external'
    isInheritanceInitializer: boolean
}

export interface SemanticModule {
    imports: SemanticImportDeclaration[]
    functions: SemanticFunction[]
    types: SemanticDataDeclaration[]
    objects: ASTObjectDeclaration[]
    services: ASTServiceDeclaration[]
    globals: SemanticVariableDeclaration[]
    typeKinds: Map<string, SemanticTypeKind>
    functionSignatures: Map<string, SemanticFunctionSignature>
}
