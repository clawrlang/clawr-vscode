import { describe, expect, it } from 'bun:test'
import { TokenStream } from '../src/lexer'
import { Parser } from '../src/parser'
import {
    buildGeneralCompletionCandidates,
    buildMemberCompletionCandidates,
    collectSimpleLocalNamesBeforePosition,
    collectSimpleTypeHints,
} from '../src/completion/candidates'
import type { ASTProgram, ASTStatement } from '../src/ast'

describe('completion candidates', () => {
    it('builds general candidates from declarations, imports, and locals', () => {
        const source = [
            'import Point as P from "./point"',
            'const a: integer = 1',
            'func add(x: integer) -> integer {',
            '  const y: integer = x',
            '  return y',
            '}',
        ].join('\n')

        const program = parseProgram(source)
        const candidates = buildGeneralCompletionCandidates(
            program,
            program.body,
            source,
            4,
            9,
        )

        const labels = new Set(candidates.map((candidate) => candidate.label))
        expect(labels.has('return')).toBeTrue()
        expect(labels.has('a')).toBeTrue()
        expect(labels.has('add')).toBeTrue()
        expect(labels.has('P')).toBeTrue()
        expect(labels.has('x')).toBeTrue()
        expect(labels.has('y')).toBeTrue()
    })

    it('collects member candidates for object fields and methods', () => {
        const statements: ASTStatement[] = [
            {
                kind: 'object-decl',
                name: 'User',
                visibility: 'public',
                sections: [
                    {
                        kind: 'data',
                        fields: [
                            {
                                name: 'name',
                                type: 'string',
                                position: { line: 1, column: 1 },
                            },
                        ],
                    },
                    {
                        kind: 'methods',
                        items: [
                            {
                                kind: 'func-decl',
                                name: 'greet',
                                visibility: 'public',
                                parameters: [],
                                returnType: 'string',
                                body: {
                                    kind: 'expression',
                                    value: {
                                        kind: 'string',
                                        value: 'hi',
                                        position: { line: 1, column: 1 },
                                    },
                                },
                                position: { line: 1, column: 1 },
                            },
                        ],
                    },
                ],
                position: { line: 1, column: 1 },
            },
        ]

        const items = buildMemberCompletionCandidates(statements, 'User')
        expect(items).toMatchObject([
            { label: 'name', kind: 'field', detail: 'string' },
            { label: 'greet', kind: 'method', detail: '() -> string' },
        ])
    })

    it('collects simple type hints from declarations and parameters', () => {
        const source = [
            'const a: integer = 1',
            'func id(x: string) -> string {',
            '  const y: truthvalue = true',
            '  return x',
            '}',
        ].join('\n')

        const program = parseProgram(source)
        const hints = collectSimpleTypeHints(program.body)

        expect(hints.get('a')).toBe('integer')
        expect(hints.get('x')).toBe('string')
        expect(hints.get('y')).toBe('truthvalue')
    })

    it('collects only names visible before cursor position', () => {
        const source = [
            'const first: integer = 1',
            'func test(a: integer) -> integer {',
            '  const second: integer = a',
            '  return second',
            '}',
            'const third: integer = 3',
        ].join('\n')

        const names = collectSimpleLocalNamesBeforePosition(source, 3, 6)

        expect(names).toContain('first')
        expect(names).toContain('a')
        expect(names).toContain('second')
        expect(names).not.toContain('third')
    })
})

function parseProgram(source: string): ASTProgram {
    return new Parser(new TokenStream(source, 'test.clawr')).parse()
}
