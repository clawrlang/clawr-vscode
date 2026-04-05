import { ASTDataDeclaration, ASTPosition } from '../../ast'
import { TokenStream } from '../../lexer'

export class DataDeclarationParser {
    constructor(private stream: TokenStream) {}

    isNext(): boolean {
        const token = this.stream.peek()
        return token?.kind === 'KEYWORD' && token.keyword === 'data'
    }

    parse(): ASTDataDeclaration {
        const token = this.stream.expect('KEYWORD', 'data')
        const name = this.stream.expect('IDENTIFIER').identifier
        this.stream.expect('PUNCTUATION', '{')
        const fields: {
            semantics: 'const' | 'mut' | 'ref'
            name: string
            type: string
            position: ASTPosition
        }[] = []
        while (!this.stream.isNext('PUNCTUATION', '}')) {
            let fieldSemantics: 'const' | 'mut' | 'ref' = 'mut'
            const maybeSemantics = this.stream.peek()
            if (
                maybeSemantics?.kind === 'KEYWORD' &&
                (maybeSemantics.keyword === 'const' ||
                    maybeSemantics.keyword === 'mut' ||
                    maybeSemantics.keyword === 'ref')
            ) {
                fieldSemantics = maybeSemantics.keyword
                this.stream.next()
            }
            const fieldNameToken = this.stream.expect('IDENTIFIER')
            const fieldName = fieldNameToken.identifier
            this.stream.expect('PUNCTUATION', ':')
            const fieldType = this.stream.expect('IDENTIFIER').identifier
            fields.push({
                semantics: fieldSemantics,
                name: fieldName,
                type: fieldType,
                position: {
                    file: this.stream.file,
                    line: fieldNameToken.line,
                    column: fieldNameToken.column,
                },
            })
            if (this.stream.isNext('PUNCTUATION', ',')) {
                this.stream.next()
            } else if (this.stream.isNext('NEWLINE')) {
                this.stream.next({ stopAtNewline: true })
            } else if (!this.stream.isNext('PUNCTUATION', '}')) {
                const next = this.stream.peek()!
                throw new Error(
                    `${this.stream.file}:${next.line}:${next.column}:Expected ',' or newline to separate fields`,
                )
            }
        }
        this.stream.expect('PUNCTUATION', '}')
        return {
            kind: 'data-decl',
            name,
            visibility: 'public',
            fields,
            position: {
                file: this.stream.file,
                line: token.line,
                column: token.column,
            },
        }
    }
}
