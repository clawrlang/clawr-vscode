import { describe, expect, it, test } from 'bun:test'
import { Token, TokenStream } from '../src/lexer'
import { decimal } from 'decimalish'

describe('it tokenizes', () => {
    describe('integers', () => {
        const tests = {
            '1': { int: 1n, s: '1' },
            'big integer': {
                int: 1_208_925_819_614_629_174_706_176n,
                s: '1_208_925_819_614_629_174_706_176',
            },
        }
        for (const [name, { s, int }] of Object.entries(tests)) {
            test(name, () => {
                const tokens = [...tokenize(s)]
                expect(tokens.length).toBe(1)
                expect(tokens[0]).toMatchObject({
                    kind: 'INTEGER_LITERAL',
                    value: int,
                })
            })
        }
    })

    describe('real numbers', () => {
        const tests = {
            '1.1': { real: decimal(1.1), s: '1.1' },
            'big decimal': {
                real: decimal('1.234567890e123456'),
                s: '1.234_567_890e123_456',
            },
            'signed exponent': {
                real: decimal('2.5e+3'),
                s: '2.5e+3',
            },
        }
        for (const [name, { s, real }] of Object.entries(tests)) {
            test(name, () => {
                const tokens = [...tokenize(s)]
                expect(tokens.length).toBe(1)
                expect(tokens[0]).toMatchObject({
                    kind: 'REAL_LITERAL',
                    value: real,
                })
            })
        }
    })

    describe('truth-values', () => {
        const tests = ['false', 'ambiguous', 'true']
        for (const keyword of tests) {
            test(keyword, () => {
                const tokens = [...tokenize(keyword)]
                expect(tokens.length).toBe(1)
                expect(tokens[0]).toMatchObject({
                    kind: 'TRUTH_LITERAL',
                    value: keyword,
                })
            })
        }
    })

    describe('strings', () => {
        test('simple string', () => {
            const tokens = [...tokenize('1 "string" 1')]
            expect(tokens.length).toBe(3)
            expect(tokens[1]).toMatchObject({
                kind: 'STRING_LITERAL',
                value: 'string',
            })
        })
        test('escaped double-quote', () => {
            const tokens = [...tokenize('"str\\"ing" 1')]
            expect(tokens.length).toBe(2)
            expect(tokens[0]).toMatchObject({
                kind: 'STRING_LITERAL',
                value: 'str\\"ing',
            })
        })
        test('escaped backslash', () => {
            const tokens = [...tokenize('"str\\\\" 1')]
            expect(tokens.length).toBe(2)
            expect(tokens[0]).toMatchObject({
                kind: 'STRING_LITERAL',
                value: 'str\\\\',
            })
        })
    })

    describe('regular expressions', () => {
        test('simple regex', () => {
            const tokens = [...tokenize('( /regex/ )')]
            expect(tokens.length).toBe(3)
            expect(tokens[1]).toMatchObject({
                kind: 'REGEX_LITERAL',
                pattern: 'regex',
            })
        })
        test('escaped slash', () => {
            const tokens = [...tokenize('/reg\\/ex/ 1')]
            expect(tokens.length).toBe(2)
            expect(tokens[0]).toMatchObject({
                kind: 'REGEX_LITERAL',
                pattern: 'reg\\/ex',
            })
        })
        test('class category slash', () => {
            const tokens = [...tokenize('/reg[/]ex/ 1')]
            expect(tokens.length).toBe(2)
            expect(tokens[0]).toMatchObject({
                kind: 'REGEX_LITERAL',
                pattern: 'reg[/]ex',
            })
        })
        test('escaped backslash', () => {
            const tokens = [...tokenize('/reg\\\\/ex/ 1')]
            expect(tokens.length).toBeGreaterThanOrEqual(2)
            expect(tokens[0]).toMatchObject({
                kind: 'REGEX_LITERAL',
                pattern: 'reg\\\\',
            })
            expect(tokens[1]).toMatchObject({
                kind: 'IDENTIFIER',
                identifier: 'ex',
            })
        })
        it('allows modifiers', () => {
            const tokens = [...tokenize('/regex/gmi')]
            expect(tokens.length).toBe(1)
            expect(tokens[0]).toMatchObject({
                kind: 'REGEX_LITERAL',
                pattern: 'regex',
                modifiers: new Set('gmi'),
            })
        })
    })

    describe('keywords', () => {
        const tests = ['const', 'mut', 'ref', 'helper', 'import', 'from', 'as']
        for (const keyword of tests) {
            test(keyword, () => {
                const tokens = [...tokenize(keyword)]
                expect(tokens.length).toBe(1)
                expect(tokens[0]).toMatchObject({
                    kind: 'KEYWORD',
                    keyword,
                })
            })
        }

        it('tokenizes import syntax keyword combinations in sequence', () => {
            const tokens = [
                ...tokenize('import Token as Tok from "lexer/tokens"'),
            ]
            expect(tokens).toMatchObject([
                { kind: 'KEYWORD', keyword: 'import' },
                { kind: 'IDENTIFIER', identifier: 'Token' },
                { kind: 'KEYWORD', keyword: 'as' },
                { kind: 'IDENTIFIER', identifier: 'Tok' },
                { kind: 'KEYWORD', keyword: 'from' },
                { kind: 'STRING_LITERAL', value: 'lexer/tokens' },
            ])
        })
    })

    describe('punctuation', () => {
        const tests = [
            '=',
            '[',
            ']',
            '(',
            ')',
            '{',
            '}',
            ',',
            ':',
            '@',
            '->',
            '=>',
        ]
        for (const symbol of tests) {
            test(symbol, () => {
                const tokens = [...tokenize(symbol)]
                expect(tokens.length).toBe(1)
                expect(tokens[0]).toMatchObject({
                    kind: 'PUNCTUATION',
                    symbol,
                })
            })
        }

        for (const symbol of ['()', '[]', '{}']) {
            it(`separates brackets ${symbol}`, () => {
                const tokens = [...tokenize(symbol)]

                expect(tokens).toMatchObject([
                    {
                        kind: 'PUNCTUATION',
                        symbol: symbol[0],
                        line: 1,
                        column: 1,
                    },
                    {
                        kind: 'PUNCTUATION',
                        symbol: symbol[1],
                        line: 1,
                        column: 2,
                    },
                ])
            })
        }
    })

    describe('operators', () => {
        const tests = ['+', '-', '&&', '<<', '|']
        for (const operator of tests) {
            test(operator, () => {
                const tokens = [...tokenize(operator)]
                expect(tokens.length).toBe(1)
                expect(tokens[0]).toMatchObject({
                    kind: 'OPERATOR',
                    operator,
                })
            })
        }

        test('/', () => {
            const tokens = [...tokenize('1 / 2')]
            expect(tokens.length).toBe(3)
            expect(tokens[1]).toMatchObject({
                kind: 'OPERATOR',
                operator: '/',
            })
        })
    })

    describe('identifiers', () => {
        const tests = ['x', 'y']
        for (const identifier of tests) {
            test(identifier, () => {
                const tokens = [...tokenize(identifier)]
                expect(tokens.length).toBe(1)
                expect(tokens[0]).toMatchObject({
                    kind: 'IDENTIFIER',
                    identifier,
                })
            })
        }

        test('allows unicode script identifiers', () => {
            const tokens = [...tokenize('变量')]
            expect(tokens.length).toBe(1)
            expect(tokens[0]).toMatchObject({
                kind: 'IDENTIFIER',
                identifier: '变量',
            })
        })

        test('normalizes identifiers to NFC', () => {
            const decomposed = 'e\u0301'
            const tokens = [...tokenize(decomposed)]
            expect(tokens.length).toBe(1)
            expect(tokens[0]).toMatchObject({
                kind: 'IDENTIFIER',
                identifier: 'é',
            })
        })
    })

    it('dot operator', () => {
        const tokens = [...tokenize('3a.b')]
        expect(tokens.length).toBe(3)
        expect(tokens[1]).toMatchObject({
            kind: 'OPERATOR',
            operator: '.',
        })
    })

    test('multiple tokens', () => {
        const tokens = [...tokenize('const x: 1\n1.1')]
        expect(tokens.length).toBe(6)
        expect(tokens[0]).toMatchObject({
            kind: 'KEYWORD',
            keyword: 'const',
            line: 1,
            column: 1,
        })
        expect(tokens[1]).toMatchObject({
            kind: 'IDENTIFIER',
            identifier: 'x',
            line: 1,
            column: 7,
        })
        expect(tokens[2]).toMatchObject({
            kind: 'PUNCTUATION',
            symbol: ':',
            line: 1,
            column: 8,
        })
        expect(tokens[3]).toMatchObject({
            kind: 'INTEGER_LITERAL',
            value: 1n,
            line: 1,
            column: 10,
        })
        expect(tokens[4]).toMatchObject({
            kind: 'NEWLINE',
        })
        expect(tokens[5]).toMatchObject({
            kind: 'REAL_LITERAL',
            value: decimal(1.1),
            line: 2,
            column: 1,
        })
    })
})

describe('it ignores', () => {
    describe('comments', () => {
        test('C comments: /* */', () => {
            const tokens = [...tokenize('/* C comment */ 1')]
            expect(tokens.length).toBe(1)
            expect(tokens[0]).toMatchObject({
                kind: 'INTEGER_LITERAL',
                value: 1n,
                line: 1,
                column: 17,
            })
        })

        test('C++ comments: //', () => {
            const tokens = [...tokenize('// C++ comment \n1')]
            expect(tokens.length).toBe(1)
            expect(tokens[0]).toMatchObject({
                kind: 'INTEGER_LITERAL',
                value: 1n,
                line: 2,
                column: 1,
            })
        })
    })

    test('non-breaking space', () => {
        const tokens = [...tokenize('  \u00a0 1')]
        expect(tokens.length).toBe(1)
        expect(tokens[0]).toMatchObject({
            kind: 'INTEGER_LITERAL',
            line: 1,
            column: 5,
        })
    })

    test('whitespace around newline', () => {
        const tokens = [...tokenize(' \n  \n')]
        expect(tokens.length).toBe(1)
        expect(tokens[0]).toMatchObject({
            kind: 'NEWLINE',
            line: 1,
            column: 2,
        })
    })
})

describe('reserved implementation glyphs', () => {
    for (const glyph of ['·', '¸', 'ˇ', '˛']) {
        test(`rejects ${glyph}`, () => {
            expect(() => [...tokenize(`x${glyph}y`)]).toThrowError(
                /Reserved implementation glyph/,
            )
        })
    }

    test('includes source position', () => {
        expect(() => [...tokenize('abc·def')]).toThrowError(/test:1:4:/)
    })
})

describe('forbidden unicode identifier code points', () => {
    test('rejects zero-width non-joiner in identifier', () => {
        expect(() => [...tokenize('ab\u200Ccd')]).toThrowError(
            /Forbidden Unicode character/,
        )
    })
})

function* tokenize(source: string): Generator<Token> {
    const stream = new TokenStream(source, 'test')
    while (true) {
        const t = stream.next({ stopAtNewline: true })
        if (!t) return
        yield t
    }
}
