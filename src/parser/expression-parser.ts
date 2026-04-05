import {
    ASTBinaryExpression,
    ASTCallArgument,
    ASTCallExpression,
    ASTDataLiteralField,
    ASTExpression,
} from '../ast'
import { TokenStream } from '../lexer'

export class ExpressionParser {
    constructor(private stream: TokenStream) {}

    parse(): ASTExpression {
        return this.parseLogicalOrExpression()
    }

    private parseLogicalOrExpression(): ASTExpression {
        let expr = this.parseLogicalAndExpression()

        while (this.stream.isNext('OPERATOR', ['||'])) {
            const op = this.stream.expect('OPERATOR', ['||'])
            const right = this.parseLogicalAndExpression()
            expr = {
                kind: 'binary',
                operator: '||',
                left: expr,
                right,
                position: { line: op.line, column: op.column },
            }
        }

        return expr
    }

    private parseLogicalAndExpression(): ASTExpression {
        let expr = this.parseEqualityExpression()

        while (this.stream.isNext('OPERATOR', ['&&'])) {
            const op = this.stream.expect('OPERATOR', ['&&'])
            const right = this.parseEqualityExpression()
            expr = {
                kind: 'binary',
                operator: '&&',
                left: expr,
                right,
                position: { line: op.line, column: op.column },
            }
        }

        return expr
    }

    private parseEqualityExpression(): ASTExpression {
        let expr = this.parseComparisonExpression()

        while (this.stream.isNext('OPERATOR', ['==', '!='])) {
            const op = this.stream.expect('OPERATOR', ['==', '!='])
            const right = this.parseComparisonExpression()
            expr = {
                kind: 'binary',
                operator: op.operator,
                left: expr,
                right,
                position: { line: op.line, column: op.column },
            }
        }

        return expr
    }

    private parseComparisonExpression(): ASTExpression {
        let expr = this.parseAdditiveExpression()

        while (this.stream.isNext('OPERATOR', ['<', '<=', '>', '>='])) {
            const op = this.stream.expect('OPERATOR', ['<', '<=', '>', '>='])
            const right = this.parseAdditiveExpression()
            expr = {
                kind: 'binary',
                operator: op.operator,
                left: expr,
                right,
                position: { line: op.line, column: op.column },
            }
        }

        return expr
    }

    private parseAdditiveExpression(): ASTExpression {
        let expr = this.parseMultiplicativeExpression()

        while (true) {
            if (!this.stream.isNext('OPERATOR', ['+', '-'])) {
                break
            }

            const op = this.stream.expect('OPERATOR', ['+', '-'])
            const right = this.parseMultiplicativeExpression()
            expr = {
                kind: 'binary',
                operator: op.operator,
                left: expr,
                right,
                position: { line: op.line, column: op.column },
            }
        }

        return expr
    }

    private parseMultiplicativeExpression(): ASTExpression {
        let expr = this.parsePostfixExpression()

        while (true) {
            if (!this.stream.isNext('OPERATOR', ['*', '/'])) {
                break
            }

            const op = this.stream.expect('OPERATOR', ['*', '/'])
            const right = this.parsePostfixExpression()
            expr = {
                kind: 'binary',
                operator: op.operator,
                left: expr,
                right,
                position: { line: op.line, column: op.column },
            }
        }

        return expr
    }

    // Postfix operators have the highest precedence in the current grammar.
    private parsePostfixExpression(): ASTExpression {
        let expr = this.parsePrimaryExpression()

        while (true) {
            if (this.stream.isNext('PUNCTUATION', '(')) {
                const lparen = this.stream.expect('PUNCTUATION', '(')
                const args: ASTCallArgument[] = []

                while (!this.stream.isNext('PUNCTUATION', ')')) {
                    args.push(this.parseCallArgument())
                    if (this.stream.isNext('PUNCTUATION', ',')) {
                        this.stream.next()
                    } else {
                        break
                    }
                }

                this.stream.expect('PUNCTUATION', ')')
                expr = {
                    kind: 'call',
                    callee: expr,
                    arguments: args,
                    position: { line: lparen.line, column: lparen.column },
                }
                continue
            }

            if (this.stream.isNext('OPERATOR', ['.'])) {
                const dotToken = this.stream.expect('OPERATOR')
                const right = this.parsePrimaryExpression()
                const binary: ASTBinaryExpression = {
                    kind: 'binary',
                    operator: '.',
                    left: expr,
                    right,
                    position: { line: dotToken.line, column: dotToken.column },
                }
                expr = binary
                continue
            }

            if (this.stream.isNext('PUNCTUATION', '[')) {
                const lbracket = this.stream.expect('PUNCTUATION', '[')
                const indexExpr = this.parse()
                this.stream.expect('PUNCTUATION', ']')
                expr = {
                    kind: 'binary',
                    operator: '[]',
                    left: expr,
                    right: indexExpr,
                    position: { line: lbracket.line, column: lbracket.column },
                }
                continue
            }

            break
        }
        return expr
    }

    private parseCallArgument(): ASTCallArgument {
        const labeled = this.stream.attempt((clone) => {
            if (!clone.isNext('IDENTIFIER')) return null
            const labelToken = clone.expect('IDENTIFIER')
            if (!clone.isNext('PUNCTUATION', ':')) return null
            clone.expect('PUNCTUATION', ':')
            const value = new ExpressionParser(clone).parse()
            return { label: labelToken.identifier, value }
        })

        if (labeled) return labeled
        return { value: this.parse() }
    }

    private parsePrimaryExpression(): ASTExpression {
        const token = this.stream.peek()
        switch (token?.kind) {
            case 'KEYWORD':
                if (token.keyword === 'when') {
                    return this.parseWhenExpression()
                }
                if (token.keyword === 'self' || token.keyword === 'super') {
                    this.stream.next()
                    return {
                        kind: 'identifier',
                        name: token.keyword,
                        position: { line: token.line, column: token.column },
                    }
                }
                throw new Error(
                    `${token.line}:${token.column}:Unexpected keyword [${token.keyword}] in expression`,
                )
            case 'INTEGER_LITERAL':
                this.stream.next()
                return {
                    kind: 'integer',
                    value: token.value,
                    position: { line: token.line, column: token.column },
                }
            case 'TRUTH_LITERAL':
                this.stream.next()
                return {
                    kind: 'truthvalue',
                    value: token.value,
                    position: { line: token.line, column: token.column },
                }
            case 'STRING_LITERAL':
                this.stream.next()
                return {
                    kind: 'string',
                    value: token.value,
                    position: { line: token.line, column: token.column },
                }
            case 'IDENTIFIER':
                this.stream.next()
                if (token.identifier === 'copy') {
                    this.stream.expect('PUNCTUATION', '(')
                    const value = this.parse()
                    this.stream.expect('PUNCTUATION', ')')
                    return {
                        kind: 'copy',
                        value,
                        position: { line: token.line, column: token.column },
                    }
                }
                return {
                    kind: 'identifier',
                    name: token.identifier,
                    position: { line: token.line, column: token.column },
                }
            case 'PUNCTUATION':
                if (token.symbol === '(') {
                    this.stream.next()
                    const value = this.parse()
                    this.stream.expect('PUNCTUATION', ')')
                    return value
                }

                if (token.symbol === '[') {
                    this.stream.next()
                    const elements: ASTExpression[] = []

                    while (!this.stream.isNext('PUNCTUATION', ']')) {
                        elements.push(this.parse())
                        if (this.stream.isNext('PUNCTUATION', ',')) {
                            this.stream.next()
                        } else {
                            break
                        }
                    }

                    this.stream.expect('PUNCTUATION', ']')
                    return {
                        kind: 'array-literal',
                        elements,
                        position: { line: token.line, column: token.column },
                    }
                }

                if (token.symbol === '{') {
                    this.stream.next()
                    const fields: { [field: string]: ASTDataLiteralField } = {}
                    let superInitializer: ASTCallExpression | undefined

                    while (!this.stream.isNext('PUNCTUATION', '}')) {
                        if (
                            !superInitializer &&
                            Object.keys(fields).length === 0 &&
                            this.stream.isNext('KEYWORD', 'super')
                        ) {
                            const maybeSuperInitializer = this.parse()
                            if (
                                !this.isSuperInitializerCall(
                                    maybeSuperInitializer,
                                )
                            ) {
                                throw new Error(
                                    `${maybeSuperInitializer.position.line}:${maybeSuperInitializer.position.column}:Expected super initializer call 'super.name(...)' as the first literal entry`,
                                )
                            }

                            superInitializer = maybeSuperInitializer
                            if (this.stream.isNext('PUNCTUATION', ',')) {
                                this.stream.next()
                            }
                            if (this.stream.isNext('NEWLINE')) {
                                this.stream.next({ stopAtNewline: true })
                            }
                            continue
                        }

                        if (this.stream.isNext('KEYWORD', 'super')) {
                            const token = this.stream.peek()
                            throw new Error(
                                `${token?.line ?? '?'}:${token?.column ?? '?'}:super initializer call must be the first literal entry`,
                            )
                        }

                        const fieldNameToken = this.stream.expect('IDENTIFIER')
                        const fieldName = fieldNameToken.identifier
                        this.stream.expect('PUNCTUATION', ':')
                        const fieldValue = this.parse()
                        fields[fieldName] = {
                            value: fieldValue,
                            namePosition: {
                                line: fieldNameToken.line,
                                column: fieldNameToken.column,
                            },
                        }
                        if (this.stream.isNext('PUNCTUATION', ','))
                            this.stream.next()

                        if (this.stream.isNext('NEWLINE')) {
                            this.stream.next({ stopAtNewline: true })
                        }
                    }
                    this.stream.expect('PUNCTUATION', '}')
                    return {
                        kind: 'data-literal',
                        fields,
                        superInitializer,
                        position: { line: token.line, column: token.column },
                    }
                } else {
                    throw new Error(
                        `${token.line}:${token.column}:Unexpected punctuation [${token.symbol}] in expression`,
                    )
                }
            default:
                throw new Error(
                    `${token?.line}:${token?.column}:Unexpected token [${token?.kind}] in expression`,
                )
        }
    }

    private parseWhenExpression(): ASTExpression {
        const whenToken = this.stream.expect('KEYWORD', 'when')
        const subject = this.parse()
        this.stream.expect('PUNCTUATION', '{')

        const branches: Array<{
            pattern:
                | {
                      kind: 'wildcard-pattern'
                      position: { line: number; column: number }
                  }
                | {
                      kind: 'value-pattern'
                      value: ASTExpression
                      position: { line: number; column: number }
                  }
            value: ASTExpression
        }> = []

        while (!this.stream.isNext('PUNCTUATION', '}')) {
            const patternExpr = this.parse()
            const pattern =
                patternExpr.kind === 'identifier' && patternExpr.name === '_'
                    ? {
                          kind: 'wildcard-pattern' as const,
                          position: patternExpr.position,
                      }
                    : {
                          kind: 'value-pattern' as const,
                          value: patternExpr,
                          position: patternExpr.position,
                      }

            this.stream.expect('PUNCTUATION', '=>')
            const value = this.parse()
            branches.push({ pattern, value })

            if (this.stream.isNext('PUNCTUATION', ',')) {
                this.stream.next()
            }

            if (this.stream.isNext('NEWLINE')) {
                this.stream.next({ stopAtNewline: true })
            }
        }

        this.stream.expect('PUNCTUATION', '}')
        return {
            kind: 'when',
            subject,
            branches,
            position: { line: whenToken.line, column: whenToken.column },
        }
    }

    private isSuperInitializerCall(
        value: ASTExpression,
    ): value is ASTCallExpression {
        return (
            value.kind === 'call' &&
            value.callee.kind === 'binary' &&
            value.callee.operator === '.' &&
            value.callee.left.kind === 'identifier' &&
            value.callee.left.name === 'super' &&
            value.callee.right.kind === 'identifier'
        )
    }
}
