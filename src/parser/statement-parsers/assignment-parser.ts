import { ASTStatement } from '../../ast'
import { TokenStream } from '../../lexer'
import { ExpressionParser } from '../expression-parser'

export class AssignmentParser {
    constructor(private stream: TokenStream) {}

    isNext(): boolean {
        const token = this.stream.peek()
        return (
            token?.kind === 'IDENTIFIER' ||
            (token?.kind === 'KEYWORD' &&
                (token.keyword === 'self' || token.keyword === 'super'))
        )
    }

    parse(): ASTStatement {
        const firstToken = this.stream.peek()!!
        // Parse the left-hand side (identifier or field-access)
        let target = new ExpressionParser(this.stream).parse()
        // After parseExpression, expect '='
        if (!this.stream.isNext('PUNCTUATION', '=')) {
            throw new Error('Expected = in assignment')
        }
        this.stream.next() // consume '='
        const value = new ExpressionParser(this.stream).parse()
        return {
            kind: 'assign',
            target,
            value,
            position: { file: this.stream.file, line: firstToken.line, column: firstToken.column },
        }
    }
}
