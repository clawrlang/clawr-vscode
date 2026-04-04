import { describe, expect, it } from 'bun:test'
import { TokenStream } from '../src/lexer'
import {
    classifyClawrToken,
    createSemanticClassifierState,
    type SemanticTokenModifierName,
    type SemanticTokenTypeName,
} from '../src/semantic-tokens/classifier'

type IdentifierClassification = {
    name: string
    line: number
    column: number
    tokenType: SemanticTokenTypeName | null
    modifiers: SemanticTokenModifierName[]
}

describe('semantic token classifier', () => {
    it('classifies data/object/service declaration names by category', () => {
        const source = [
            'data Point { }',
            'object User { }',
            'service Api { }',
        ].join('\n')

        const ids = classifyIdentifiers(source)

        expect(findIdentifier(ids, 'Point', 1)).toMatchObject({
            tokenType: 'struct',
            modifiers: ['declaration'],
        })
        expect(findIdentifier(ids, 'User', 2)).toMatchObject({
            tokenType: 'class',
            modifiers: ['declaration'],
        })
        expect(findIdentifier(ids, 'Api', 3)).toMatchObject({
            tokenType: 'class',
            modifiers: ['declaration'],
        })
    })

    it('classifies builtin types in type annotation and return positions', () => {
        const source = [
            'const x: integer = 1',
            'func ok() -> truthvalue { return true }',
            'const s: string = "a"',
            'const r: real = 1.5',
        ].join('\n')

        const ids = classifyIdentifiers(source)

        expect(findIdentifier(ids, 'integer', 1)?.tokenType).toBe('type')
        expect(findIdentifier(ids, 'truthvalue', 2)?.tokenType).toBe('type')
        expect(findIdentifier(ids, 'string', 3)?.tokenType).toBe('type')
        expect(findIdentifier(ids, 'real', 4)?.tokenType).toBe('type')
    })

    it('classifies user-defined types in later type annotations', () => {
        const source = ['data Box { }', 'const b: Box = copy(source)'].join(
            '\n',
        )

        const ids = classifyIdentifiers(source)

        expect(findIdentifier(ids, 'Box', 1)).toMatchObject({
            tokenType: 'struct',
            modifiers: ['declaration'],
        })
        expect(findIdentifier(ids, 'Box', 2)?.tokenType).toBe('type')
    })
})

function classifyIdentifiers(source: string): IdentifierClassification[] {
    const state = createSemanticClassifierState()
    const stream = new TokenStream(source, 'test.clawr')
    const result: IdentifierClassification[] = []

    let tok = stream.next()
    while (tok) {
        const classification = classifyClawrToken(tok, state)
        if (tok.kind === 'IDENTIFIER') {
            result.push({
                name: tok.identifier,
                line: tok.line,
                column: tok.column,
                tokenType: classification.tokenType,
                modifiers: classification.modifiers,
            })
        }
        tok = stream.next()
    }

    return result
}

function findIdentifier(
    ids: IdentifierClassification[],
    name: string,
    line: number,
): IdentifierClassification | undefined {
    return ids.find((id) => id.name === name && id.line === line)
}
