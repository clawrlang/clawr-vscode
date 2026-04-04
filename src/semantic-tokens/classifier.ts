type DeclTypeKeyword =
    | 'data'
    | 'object'
    | 'service'
    | 'enum'
    | 'union'
    | 'role'
    | 'trait'

export type SemanticTokenTypeName =
    | 'keyword'
    | 'number'
    | 'string'
    | 'regexp'
    | 'variable'
    | 'operator'
    | 'class'
    | 'struct'
    | 'type'

export type SemanticTokenModifierName = 'declaration'

export type SemanticClassifierState = {
    expectTypeDeclarationName: boolean
    pendingTypeDeclarationKind: DeclTypeKeyword | null
    expectTypeReference: boolean
    knownTypeNames: Set<string>
}

export type SemanticTokenClassification = {
    tokenType: SemanticTokenTypeName | null
    modifiers: SemanticTokenModifierName[]
}

const builtinTypeNames = new Set<string>([
    'truthvalue',
    'integer',
    'string',
    'real',
])

export function createSemanticClassifierState(): SemanticClassifierState {
    return {
        expectTypeDeclarationName: false,
        pendingTypeDeclarationKind: null,
        expectTypeReference: false,
        knownTypeNames: new Set<string>(builtinTypeNames),
    }
}

export function classifyClawrToken(
    tok: any,
    state: SemanticClassifierState,
): SemanticTokenClassification {
    switch (tok.kind) {
        case 'KEYWORD': {
            if (isTypeDeclarationKeyword(tok.keyword)) {
                state.expectTypeDeclarationName = true
                state.pendingTypeDeclarationKind = tok.keyword
            } else if (tok.keyword !== 'helper') {
                state.expectTypeDeclarationName = false
                state.pendingTypeDeclarationKind = null
            }

            const modifiers: SemanticTokenModifierName[] = [
                'func',
                'data',
                'object',
                'service',
                'enum',
                'union',
            ].includes(tok.keyword)
                ? ['declaration']
                : []

            return { tokenType: 'keyword', modifiers }
        }

        case 'IDENTIFIER': {
            if (
                state.expectTypeDeclarationName &&
                state.pendingTypeDeclarationKind
            ) {
                const typeToken = declarationKindToIdentifierType(
                    state.pendingTypeDeclarationKind,
                )
                state.knownTypeNames.add(tok.identifier)
                state.expectTypeDeclarationName = false
                state.pendingTypeDeclarationKind = null
                state.expectTypeReference = false
                return { tokenType: typeToken, modifiers: ['declaration'] }
            }

            const tokenType: SemanticTokenTypeName =
                state.expectTypeReference &&
                state.knownTypeNames.has(tok.identifier)
                    ? 'type'
                    : 'variable'

            state.expectTypeReference = false
            return { tokenType, modifiers: [] }
        }

        case 'STRING_LITERAL':
            state.expectTypeReference = false
            return { tokenType: 'string', modifiers: [] }

        case 'REGEX_LITERAL':
            state.expectTypeReference = false
            return { tokenType: 'regexp', modifiers: [] }

        case 'INTEGER_LITERAL':
        case 'REAL_LITERAL':
        case 'TRUTH_LITERAL':
            state.expectTypeReference = false
            return { tokenType: 'number', modifiers: [] }

        case 'OPERATOR':
            if (tok.operator !== '.') {
                state.expectTypeReference = false
            }
            return { tokenType: 'operator', modifiers: [] }

        case 'PUNCTUATION':
            if (tok.symbol === ':' || tok.symbol === '->') {
                state.expectTypeReference = true
            } else if (tok.symbol !== ',' && tok.symbol !== ')') {
                state.expectTypeReference = false
            }
            return { tokenType: 'operator', modifiers: [] }

        case 'NEWLINE':
            state.expectTypeReference = false
            return { tokenType: null, modifiers: [] }

        default:
            return { tokenType: null, modifiers: [] }
    }
}

function isTypeDeclarationKeyword(keyword: string): keyword is DeclTypeKeyword {
    return (
        keyword === 'data' ||
        keyword === 'object' ||
        keyword === 'service' ||
        keyword === 'enum' ||
        keyword === 'union' ||
        keyword === 'role' ||
        keyword === 'trait'
    )
}

function declarationKindToIdentifierType(
    kind: DeclTypeKeyword,
): 'class' | 'struct' | 'type' {
    if (kind === 'data') return 'struct'
    if (kind === 'object' || kind === 'service') return 'class'
    return 'type'
}
