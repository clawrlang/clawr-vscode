import { describe, expect, it } from 'bun:test'
import { TokenStream } from '../src/lexer'
import { Parser } from '../src/parser'

describe('Parser Tests', () => {
    describe('variable declaration', () => {
        for (const keyword of ['const', 'mut', 'ref'] as const)
            it(`parses ${keyword} truthvalue variable declaration correctly`, () => {
                const program = `${keyword} x: truthvalue = ambiguous`
                const ast = parse(program)
                expect(ast).toMatchObject({
                    body: [
                        {
                            kind: 'var-decl',
                            semantics: keyword,
                            name: 'x',
                            value: { kind: 'truthvalue', value: 'ambiguous' },
                        },
                    ],
                })
            })

        it('parses declaration without explicit value set', () => {
            const ast = parse('const x = ambiguous')
            expect(ast).toMatchObject({
                body: [
                    {
                        kind: 'var-decl',
                        semantics: 'const',
                        name: 'x',
                        valueSet: undefined,
                        value: { kind: 'truthvalue', value: 'ambiguous' },
                    },
                ],
            })
        })
    })

    it('parses print of truthvalue literal correctly', () => {
        const program = `print true`
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'print',
                    value: { kind: 'truthvalue', value: 'true' },
                },
            ],
        })
    })

    it('parses print of truthvalue variable correctly', () => {
        const program = `
            const x: truthvalue = ambiguous
            print x
        `
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'var-decl',
                    semantics: 'const',
                    name: 'x',
                    value: { kind: 'truthvalue', value: 'ambiguous' },
                },
                {
                    kind: 'print',
                    value: { kind: 'identifier', name: 'x' },
                },
            ],
        })
    })

    it('parses data declaration correctly', () => {
        const program = `
            data Point {
                x: truthvalue
                y: truthvalue
            }
        `
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'data-decl',
                    name: 'Point',
                    fields: [
                        { semantics: 'mut', name: 'x', type: 'truthvalue' },
                        { semantics: 'mut', name: 'y', type: 'truthvalue' },
                    ],
                },
            ],
        })
    })

    it('parses field-level semantics in data declaration', () => {
        const program = `
            data Link {
                ref next: Link
                value: truthvalue
            }
        `
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'data-decl',
                    name: 'Link',
                    fields: [
                        { semantics: 'ref', name: 'next', type: 'Link' },
                        { semantics: 'mut', name: 'value', type: 'truthvalue' },
                    ],
                },
            ],
        })
    })

    it('preserves declaration field positions', () => {
        const ast = parse('data Point {\nx: truthvalue\ny: truthvalue\n}')

        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'data-decl',
                    name: 'Point',
                    fields: [
                        { name: 'x', position: { line: 2, column: 1 } },
                        { name: 'y', position: { line: 3, column: 1 } },
                    ],
                },
            ],
        })
    })

    it('parses data literal correctly', () => {
        const program = 'const p: Point = { x: true, y: false }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'var-decl',
                    semantics: 'const',
                    name: 'p',
                    valueSet: { type: 'Point' },
                    value: {
                        kind: 'data-literal',
                        fields: {
                            x: { value: { kind: 'truthvalue', value: 'true' } },
                            y: {
                                value: { kind: 'truthvalue', value: 'false' },
                            },
                        },
                    },
                },
            ],
        })
    })

    it('parses data literal with leading super initializer call', () => {
        const program = 'const p: Sub = { super.new(seed: 42), child: true }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'var-decl',
                    value: {
                        kind: 'data-literal',
                        superInitializer: {
                            kind: 'call',
                            callee: {
                                kind: 'binary',
                                operator: '.',
                                left: {
                                    kind: 'identifier',
                                    name: 'super',
                                },
                                right: {
                                    kind: 'identifier',
                                    name: 'new',
                                },
                            },
                            arguments: [
                                {
                                    label: 'seed',
                                    value: {
                                        kind: 'integer',
                                        value: 42n,
                                    },
                                },
                            ],
                        },
                        fields: {
                            child: {
                                value: {
                                    kind: 'truthvalue',
                                    value: 'true',
                                },
                            },
                        },
                    },
                },
            ],
        })
    })

    it('rejects super initializer when it is not the first literal entry', () => {
        expect(() =>
            parse('const p: Sub = { child: true, super.new(seed: 42) }'),
        ).toThrow()
    })

    it('parses explicit copy expression', () => {
        const ast = parse('mut x: Box = copy(shared)')
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'var-decl',
                    semantics: 'mut',
                    name: 'x',
                    valueSet: { type: 'Box' },
                    value: {
                        kind: 'copy',
                        value: { kind: 'identifier', name: 'shared' },
                    },
                },
            ],
        })
    })

    it('parses field access correctly', () => {
        const program = 'const x: truthvalue = a.b.c.d.e.f'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'var-decl',
                    semantics: 'const',
                    name: 'x',
                    valueSet: { type: 'truthvalue' },
                    value: {
                        kind: 'binary',
                        operator: '.',
                        left: {
                            kind: 'binary',
                            operator: '.',
                            left: {
                                kind: 'binary',
                                operator: '.',
                                left: {
                                    kind: 'binary',
                                    operator: '.',
                                    left: {
                                        kind: 'binary',
                                        operator: '.',
                                        left: {
                                            kind: 'identifier',
                                            name: 'a',
                                        },
                                        right: {
                                            kind: 'identifier',
                                            name: 'b',
                                        },
                                    },
                                    right: { kind: 'identifier', name: 'c' },
                                },
                                right: { kind: 'identifier', name: 'd' },
                            },
                            right: { kind: 'identifier', name: 'e' },
                        },
                        right: { kind: 'identifier', name: 'f' },
                    },
                },
            ],
        })
    })

    it('parses field access chain in body following import block', () => {
        const ast = parse(
            'import Point from "models"\nconst x: truthvalue = p.a.b',
        )
        expect(ast).toMatchObject({
            imports: [{ kind: 'import', items: [{ name: 'Point' }] }],
            body: [
                {
                    kind: 'var-decl',
                    name: 'x',
                    value: {
                        kind: 'binary',
                        operator: '.',
                        left: {
                            kind: 'binary',
                            operator: '.',
                            left: { kind: 'identifier', name: 'p' },
                            right: { kind: 'identifier', name: 'a' },
                        },
                        right: { kind: 'identifier', name: 'b' },
                    },
                },
            ],
        })
    })

    it('parses assignment correctly', () => {
        const program = 'a = true'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'assign',
                    target: { kind: 'identifier', name: 'a' },
                    value: { kind: 'truthvalue', value: 'true' },
                },
            ],
        })
    })

    it('parses field assignment correctly', () => {
        const program = 'p.x = true'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'assign',
                    target: {
                        kind: 'binary',
                        operator: '.',
                        left: { kind: 'identifier', name: 'p' },
                        right: { kind: 'identifier', name: 'x' },
                    },
                    value: { kind: 'truthvalue', value: 'true' },
                },
            ],
        })
    })

    it('parses arithmetic binary operators', () => {
        const ast = parse('const x: integer = 9 - 3 * 2 / 1')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            name: 'x',
            valueSet: { type: 'integer' },
            value: {
                kind: 'binary',
            },
        })
    })

    it('parses comparison binary operators', () => {
        const ast = parse('const x: truthvalue = 1 <= 2')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            name: 'x',
            valueSet: { type: 'truthvalue' },
            value: {
                kind: 'binary',
                operator: '<=',
            },
        })
    })

    it('parses logical binary operators', () => {
        const ast = parse('const x: truthvalue = true && false || ambiguous')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            name: 'x',
            valueSet: { type: 'truthvalue' },
            value: {
                kind: 'binary',
                operator: '||',
            },
        })
    })

    it('parses data declaration and variable initialization correctly', () => {
        const program =
            'data Point { x: truthvalue }\nmut p: Point = { x: true }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'data-decl',
                    name: 'Point',
                    fields: [{ name: 'x', type: 'truthvalue' }],
                },
                {
                    kind: 'var-decl',
                    semantics: 'mut',
                    name: 'p',
                    valueSet: { type: 'Point' },
                    value: {
                        kind: 'data-literal',
                        fields: {
                            x: { value: { kind: 'truthvalue', value: 'true' } },
                        },
                    },
                },
            ],
        })
    })

    it('parses if/else block statements', () => {
        const program = 'if true { print true } else { print false }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'if',
                    condition: { kind: 'truthvalue', value: 'true' },
                    thenBranch: [
                        {
                            kind: 'print',
                            value: { kind: 'truthvalue', value: 'true' },
                        },
                    ],
                    elseBranch: [
                        {
                            kind: 'print',
                            value: { kind: 'truthvalue', value: 'false' },
                        },
                    ],
                },
            ],
        })
    })

    it('parses else-if chains', () => {
        const program = 'if true { print true } else if false { print false }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'if',
                    elseBranch: [
                        {
                            kind: 'if',
                            condition: { kind: 'truthvalue', value: 'false' },
                            thenBranch: [
                                {
                                    kind: 'print',
                                    value: {
                                        kind: 'truthvalue',
                                        value: 'false',
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        })
    })

    it('parses while loops with break and continue', () => {
        const program = 'while ambiguous { continue break }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'while',
                    condition: { kind: 'truthvalue', value: 'ambiguous' },
                    body: [{ kind: 'continue' }, { kind: 'break' }],
                },
            ],
        })
    })

    it('parses for-in loops', () => {
        const program = 'for x in xs { print x }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'for-in',
                    loopVar: 'x',
                    iterable: { kind: 'identifier', name: 'xs' },
                    body: [
                        {
                            kind: 'print',
                            value: { kind: 'identifier', name: 'x' },
                        },
                    ],
                },
            ],
        })
    })

    it('parses when expressions with wildcard branch', () => {
        const program =
            'const x: truthvalue = when true { true => false, _ => true }'
        const ast = parse(program)
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'var-decl',
                    name: 'x',
                    value: {
                        kind: 'when',
                        subject: { kind: 'truthvalue', value: 'true' },
                        branches: [
                            {
                                pattern: {
                                    kind: 'value-pattern',
                                    value: {
                                        kind: 'truthvalue',
                                        value: 'true',
                                    },
                                },
                                value: {
                                    kind: 'truthvalue',
                                    value: 'false',
                                },
                            },
                            {
                                pattern: { kind: 'wildcard-pattern' },
                                value: {
                                    kind: 'truthvalue',
                                    value: 'true',
                                },
                            },
                        ],
                    },
                },
            ],
        })
    })

    it('parses import declarations with aliases before top-level body', () => {
        const program =
            'import Token as Tok, Span from "lexer/tokens"\nconst x = ambiguous'
        const ast = parse(program)

        expect(ast).toMatchObject({
            imports: [
                {
                    kind: 'import',
                    items: [{ name: 'Token', alias: 'Tok' }, { name: 'Span' }],
                    modulePath: 'lexer/tokens',
                },
            ],
            body: [
                {
                    kind: 'var-decl',
                    semantics: 'const',
                    name: 'x',
                    value: { kind: 'truthvalue', value: 'ambiguous' },
                },
            ],
        })
    })

    it('parses single-item import declarations without aliases', () => {
        const ast = parse('import Point from "models/point"\nprint true')

        expect(ast).toMatchObject({
            imports: [
                {
                    kind: 'import',
                    items: [{ name: 'Point' }],
                    modulePath: 'models/point',
                },
            ],
            body: [
                { kind: 'print', value: { kind: 'truthvalue', value: 'true' } },
            ],
        })
    })

    it('parses helper data declarations at top level', () => {
        const program = 'helper data ParserState { value: truthvalue }'
        const ast = parse(program)

        expect(ast).toMatchObject({
            imports: [],
            body: [
                {
                    kind: 'data-decl',
                    visibility: 'helper',
                    name: 'ParserState',
                    fields: [
                        { semantics: 'mut', name: 'value', type: 'truthvalue' },
                    ],
                },
            ],
        })
    })

    it('rejects helper before unsupported top-level declarations', () => {
        expect(() => parse('helper const x = ambiguous')).toThrow(
            '1:1:helper is only supported before data, func, object, or service declarations',
        )
    })

    it('reports malformed import lists precisely', () => {
        expect(() => parse('import Token, from "lexer/tokens"')).toThrow(
            "1:15:Expected identifier after ',' in import list, got 'from'",
        )

        expect(() => parse('import Token Span from "lexer/tokens"')).toThrow(
            "1:14:Expected ',' or 'from' after import item, got identifier 'Span'",
        )
    })

    it('reports missing import module path strings precisely', () => {
        expect(() => parse('import Token from')).toThrow(
            "1:14:Expected module path string literal after 'from', got EOF",
        )

        expect(() => parse('import Token from ambiguous')).toThrow(
            "1:14:Expected module path string literal after 'from', got truth literal 'ambiguous'",
        )
    })
})

describe('Function declaration tests', () => {
    it('parses a simple function with no parameters and no return type', () => {
        const ast = parse('func greet() { print true }')
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'func-decl',
                    name: 'greet',
                    visibility: 'public',
                    parameters: [],
                    returnType: undefined,
                    body: {
                        kind: 'block',
                        statements: [{ kind: 'print' }],
                    },
                },
            ],
        })
    })

    it('parses a function with a return type annotation', () => {
        const ast = parse(
            'func makePoint() -> Point { const p: Point = { x: true } }',
        )
        expect(ast).toMatchObject({
            body: [
                {
                    kind: 'func-decl',
                    name: 'makePoint',
                    returnType: 'Point',
                    returnSemantics: undefined,
                    body: { kind: 'block' },
                },
            ],
        })
    })

    it('parses a function with an array return type annotation', () => {
        const ast = parse('func tokenize() -> [Token] { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'func-decl',
            name: 'tokenize',
            returnType: '[Token]',
        })
    })

    it('parses a function with const and ref return semantics', () => {
        const cow = parse(
            'func sharedPoint() -> const Point { const p: Point = { x: true } }',
        )
        expect(cow.body[0]).toMatchObject({
            kind: 'func-decl',
            returnType: 'Point',
            returnSemantics: 'const',
        })

        const ref = parse(
            'func refPoint() -> ref Point { const p: Point = { x: true } }',
        )
        expect(ref.body[0]).toMatchObject({
            kind: 'func-decl',
            returnType: 'Point',
            returnSemantics: 'ref',
        })
    })

    it('parses a function with unlabeled parameters', () => {
        const ast = parse('func add(a: integer, b: integer) -> integer { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'func-decl',
            name: 'add',
            parameters: [
                { label: undefined, name: 'a', type: 'integer' },
                { label: undefined, name: 'b', type: 'integer' },
            ],
        })
    })

    it('parses a function with labeled parameters', () => {
        const ast = parse('func deposit(amount cents: integer) -> Account { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'func-decl',
            name: 'deposit',
            parameters: [{ label: 'amount', name: 'cents', type: 'integer' }],
        })
    })

    it('parses a function with parameter semantics prefixes', () => {
        const ast = parse(
            'func update(target: ref Point, value: truthvalue) { }',
        )
        expect(ast.body[0]).toMatchObject({
            kind: 'func-decl',
            parameters: [
                { semantics: 'ref', name: 'target', type: 'Point' },
                { semantics: undefined, name: 'value', type: 'truthvalue' },
            ],
        })
    })

    it('parses function parameters with array type annotations', () => {
        const ast = parse('func consume(tokens: [Token]) { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'func-decl',
            parameters: [{ name: 'tokens', type: '[Token]' }],
        })
    })

    it('parses shorthand expression body', () => {
        const ast = parse('func isActive() -> truthvalue => true')
        expect(ast.body[0]).toMatchObject({
            kind: 'func-decl',
            name: 'isActive',
            returnType: 'truthvalue',
            body: {
                kind: 'expression',
                value: { kind: 'truthvalue', value: 'true' },
            },
        })
    })

    it('parses helper function declaration', () => {
        const ast = parse('helper func scanToken() -> Token { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'func-decl',
            name: 'scanToken',
            visibility: 'helper',
        })
    })

    it('rejects helper before unsupported declaration kinds', () => {
        expect(() => parse('helper const x: truthvalue = true')).toThrow(
            'helper is only supported before data, func, object, or service declarations',
        )
    })
})

function parse(code: string) {
    const stream = new TokenStream(code, 'test.clawr')
    const parser = new Parser(stream)
    return parser.parse()
}

describe('Object and service declaration tests', () => {
    it('parses a minimal object with no sections', () => {
        const ast = parse('object Empty { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'object-decl',
            name: 'Empty',
            visibility: 'public',
            supertype: undefined,
            sections: [],
        })
    })

    it('parses an object with only a data section', () => {
        const ast = parse('object Money { data: const cents: integer }')
        expect(ast.body[0]).toMatchObject({
            kind: 'object-decl',
            name: 'Money',
            sections: [
                {
                    kind: 'data',
                    fields: [
                        { semantics: 'const', name: 'cents', type: 'integer' },
                    ],
                },
            ],
        })
    })

    it('parses an object with methods then a data section', () => {
        const ast = parse(
            'object Money { func dollars() -> integer { } data: const cents: integer }',
        )
        const decl = ast.body[0]
        expect(decl).toMatchObject({ kind: 'object-decl', name: 'Money' })
        if (decl.kind !== 'object-decl') throw new Error('unreachable')
        expect(decl.sections[0]).toMatchObject({
            kind: 'methods',
            items: [{ kind: 'func-decl', name: 'dollars' }],
        })
        expect(decl.sections[1]).toMatchObject({
            kind: 'data',
            fields: [{ name: 'cents', type: 'integer' }],
        })
    })

    it('parses an object with a mutating section', () => {
        const ast = parse(
            'object Account { mutating: func deposit(amount: integer) { } }',
        )
        const decl = ast.body[0]
        expect(decl).toMatchObject({ kind: 'object-decl', name: 'Account' })
        if (decl.kind !== 'object-decl') throw new Error('unreachable')
        expect(decl.sections[0]).toMatchObject({
            kind: 'mutating',
            items: [{ kind: 'func-decl', name: 'deposit' }],
        })
    })

    it('parses an object with a supertype', () => {
        const ast = parse('object Student: Entity { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'object-decl',
            name: 'Student',
            supertype: 'Entity',
        })
    })

    it('parses a helper method inside an object', () => {
        const ast = parse(
            'object Foo { helper func internalHelper() -> truthvalue { } }',
        )
        const decl = ast.body[0]
        if (decl.kind !== 'object-decl') throw new Error('unreachable')
        expect(decl.sections[0]).toMatchObject({
            kind: 'methods',
            items: [
                {
                    kind: 'func-decl',
                    name: 'internalHelper',
                    visibility: 'helper',
                },
            ],
        })
    })

    it('parses a helper object declaration', () => {
        const ast = parse('helper object Internal { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'object-decl',
            name: 'Internal',
            visibility: 'helper',
        })
    })

    it('parses a minimal service with no sections', () => {
        const ast = parse('service Empty { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'service-decl',
            name: 'Empty',
            visibility: 'public',
            sections: [],
        })
    })

    it('parses a service with default and mutating sections', () => {
        const ast = parse(
            'service Repo { func getUser(id: integer) -> User { } mutating: func updateUser(user: User) { } }',
        )
        const decl = ast.body[0]
        expect(decl).toMatchObject({ kind: 'service-decl', name: 'Repo' })
        if (decl.kind !== 'service-decl') throw new Error('unreachable')
        expect(decl.sections[0]).toMatchObject({
            kind: 'methods',
            items: [{ kind: 'func-decl', name: 'getUser' }],
        })
        expect(decl.sections[1]).toMatchObject({
            kind: 'mutating',
            items: [{ kind: 'func-decl', name: 'updateUser' }],
        })
    })

    it('parses an object with an inheritance section', () => {
        const ast = parse(
            'object Entity { inheritance: func id() -> integer { return 1 } data: value: integer }',
        )
        const decl = ast.body[0]
        expect(decl).toMatchObject({ kind: 'object-decl', name: 'Entity' })
        if (decl.kind !== 'object-decl') throw new Error('unreachable')
        expect(decl.sections[0]).toMatchObject({
            kind: 'inheritance',
            items: [{ kind: 'func-decl', name: 'id' }],
        })
    })

    it('parses a helper service declaration', () => {
        const ast = parse('helper service InternalRepo { }')
        expect(ast.body[0]).toMatchObject({
            kind: 'service-decl',
            name: 'InternalRepo',
            visibility: 'helper',
        })
    })

    it('rejects method declarations inside data section', () => {
        expect(() => parse('object Bad { data: func nope() { } }')).toThrow(
            'Expected IDENTIFIER, got KEYWORD',
        )
    })

    it('rejects field declarations inside mutating section', () => {
        expect(() =>
            parse('service Bad { mutating: const x: integer }'),
        ).toThrow('Expected method declaration (func or helper func)')
    })
})

describe('Return statement tests', () => {
    it('parses a bare return inside a function body', () => {
        const ast = parse('func quit() { return }')
        const fn = ast.body[0]
        if (fn.kind !== 'func-decl') throw new Error('unreachable')
        expect(fn.body).toMatchObject({
            kind: 'block',
            statements: [{ kind: 'return' }],
        })
        if (fn.body.kind !== 'block') throw new Error('unreachable')
        expect(fn.body.statements[0]).not.toHaveProperty('value')
    })

    it('parses a return with an expression value', () => {
        const ast = parse('func answer() -> integer { return 42 }')
        const fn = ast.body[0]
        if (fn.kind !== 'func-decl') throw new Error('unreachable')
        expect(fn.body).toMatchObject({
            kind: 'block',
            statements: [
                { kind: 'return', value: { kind: 'integer', value: 42n } },
            ],
        })
    })

    it('parses a return with an identifier expression', () => {
        const ast = parse(
            'func identity(x: truthvalue) -> truthvalue { return x }',
        )
        const fn = ast.body[0]
        if (fn.kind !== 'func-decl') throw new Error('unreachable')
        expect(fn.body).toMatchObject({
            kind: 'block',
            statements: [
                { kind: 'return', value: { kind: 'identifier', name: 'x' } },
            ],
        })
    })

    it('parses a return inside a nested if inside a function', () => {
        const ast = parse('func check(x: truthvalue) { if x { return } }')
        const fn = ast.body[0]
        if (fn.kind !== 'func-decl') throw new Error('unreachable')
        expect(fn.body).toMatchObject({
            kind: 'block',
            statements: [
                {
                    kind: 'if',
                    thenBranch: [{ kind: 'return' }],
                },
            ],
        })
    })

    it('parses a shorthand function body with => expression', () => {
        const ast = parse('func double(n: integer) -> integer => n')
        const fn = ast.body[0]
        if (fn.kind !== 'func-decl') throw new Error('unreachable')
        expect(fn.body).toMatchObject({
            kind: 'expression',
            value: { kind: 'identifier', name: 'n' },
        })
    })
})

describe('Call expression tests', () => {
    it('parses a simple call expression in variable initialization', () => {
        const ast = parse('const x: truthvalue = yes()')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            name: 'x',
            value: {
                kind: 'call',
                callee: { kind: 'identifier', name: 'yes' },
                arguments: [],
            },
        })
    })

    it('parses a call expression with positional arguments', () => {
        const ast = parse('const x: truthvalue = choose(true, ambiguous)')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'call',
                callee: { kind: 'identifier', name: 'choose' },
                arguments: [
                    { value: { kind: 'truthvalue', value: 'true' } },
                    { value: { kind: 'truthvalue', value: 'ambiguous' } },
                ],
            },
        })
    })

    it('parses a call expression with mixed unlabeled and labeled arguments', () => {
        const ast = parse('const x: integer = adjust(1, down: 2)')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'call',
                callee: { kind: 'identifier', name: 'adjust' },
                arguments: [
                    { value: { kind: 'integer', value: 1n } },
                    { label: 'down', value: { kind: 'integer', value: 2n } },
                ],
            },
        })
    })

    it('parses method-style call expressions as binary callee + call args', () => {
        const ast = parse('const z: integer = counter.adjust(down: 2)')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'call',
                callee: {
                    kind: 'binary',
                    operator: '.',
                    left: { kind: 'identifier', name: 'counter' },
                    right: { kind: 'identifier', name: 'adjust' },
                },
                arguments: [
                    { label: 'down', value: { kind: 'integer', value: 2n } },
                ],
            },
        })
    })
})

describe('Expression precedence tests', () => {
    it('parses string concatenation expressions', () => {
        const ast = parse('const s: string = "hello" + " world"')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'binary',
                operator: '+',
                left: { kind: 'string', value: 'hello' },
                right: { kind: 'string', value: ' world' },
            },
        })
    })

    it('parses additive expressions as left-associative', () => {
        const ast = parse('const x: integer = a + b + c')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'binary',
                operator: '+',
                left: {
                    kind: 'binary',
                    operator: '+',
                    left: { kind: 'identifier', name: 'a' },
                    right: { kind: 'identifier', name: 'b' },
                },
                right: { kind: 'identifier', name: 'c' },
            },
        })
    })

    it('keeps member access and call precedence above additive', () => {
        const ast = parse('const x: integer = counter.adjust(down: 2) + bump()')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'binary',
                operator: '+',
                left: {
                    kind: 'call',
                    callee: {
                        kind: 'binary',
                        operator: '.',
                        left: { kind: 'identifier', name: 'counter' },
                        right: { kind: 'identifier', name: 'adjust' },
                    },
                    arguments: [
                        {
                            label: 'down',
                            value: { kind: 'integer', value: 2n },
                        },
                    ],
                },
                right: {
                    kind: 'call',
                    callee: { kind: 'identifier', name: 'bump' },
                    arguments: [],
                },
            },
        })
    })

    it('supports parenthesized sub-expressions', () => {
        const ast = parse('const x: integer = (a + b).toInt()')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'call',
                callee: {
                    kind: 'binary',
                    operator: '.',
                    left: {
                        kind: 'binary',
                        operator: '+',
                        left: { kind: 'identifier', name: 'a' },
                        right: { kind: 'identifier', name: 'b' },
                    },
                    right: { kind: 'identifier', name: 'toInt' },
                },
                arguments: [],
            },
        })
    })

    it('parses array literal expressions', () => {
        const ast = parse('const xs = [1, 2, 3]')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'array-literal',
                elements: [
                    { kind: 'integer', value: 1n },
                    { kind: 'integer', value: 2n },
                    { kind: 'integer', value: 3n },
                ],
            },
        })
    })

    it('parses array type annotations as [T]', () => {
        const ast = parse('const xs: [integer] = [1, 2, 3]')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            name: 'xs',
            valueSet: { type: '[integer]' },
            value: {
                kind: 'array-literal',
            },
        })
    })

    it('parses array indexing as postfix expression', () => {
        const ast = parse('const x = xs[1]')
        expect(ast.body[0]).toMatchObject({
            kind: 'var-decl',
            value: {
                kind: 'binary',
                operator: '[]',
                left: { kind: 'identifier', name: 'xs' },
                right: { kind: 'integer', value: 1n },
            },
        })
    })
})
