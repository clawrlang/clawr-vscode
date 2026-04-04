import { describe, expect, it } from 'bun:test'
import { TokenStream } from '../src/lexer'
import { Parser } from '../src/parser'
import { collectTopLevelBoundIdentifierPositions } from '../src/references/top-level-bound-positions'

describe('collectTopLevelBoundIdentifierPositions', () => {
    it('keeps unresolved uses before local shadowing and excludes shadowed uses', () => {
        const program = parse(`import Thing as Foo from "./dep"
print Foo
func demo() {
print Foo
const Foo = true
print Foo
}`)

        const positions = collectTopLevelBoundIdentifierPositions(
            program,
            new Set(['Foo']),
        )

        expect(toLineColumnList(positions, 'Foo')).toEqual(['2:7', '4:7'])
    })

    it('excludes block-scoped shadowed identifiers and keeps outer references', () => {
        const program = parse(`print Foo
if true {
const Foo = false
print Foo
}
print Foo`)

        const positions = collectTopLevelBoundIdentifierPositions(
            program,
            new Set(['Foo']),
        )

        expect(toLineColumnList(positions, 'Foo')).toEqual(['1:7', '6:7'])
    })

    it('excludes function parameter shadowing and keeps non-shadowed uses', () => {
        const program = parse(`import Thing as Foo from "./dep"
print Foo
func demo(Foo: truthvalue) {
print Foo
}
print Foo`)

        const positions = collectTopLevelBoundIdentifierPositions(
            program,
            new Set(['Foo']),
        )

        expect(toLineColumnList(positions, 'Foo')).toEqual(['2:7', '6:7'])
    })
})

function parse(code: string) {
    const stream = new TokenStream(code, 'test.clawr')
    const parser = new Parser(stream)
    return parser.parse()
}

function toLineColumnList(
    positions: Array<{ name: string; line: number; column: number }>,
    name: string,
): string[] {
    return positions
        .filter((pos) => pos.name === name)
        .map((pos) => `${pos.line}:${pos.column}`)
        .sort()
}
