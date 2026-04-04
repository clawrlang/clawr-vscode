import type {
    ASTFunctionDeclaration,
    ASTFunctionParameter,
    ASTVisibility,
} from '../../ast'
import { TokenStream } from '../../lexer'
import { ExpressionParser } from '../expression-parser'
import { Parser } from '../index'

export class FunctionDeclarationParser {
    constructor(private stream: TokenStream) {}

    isNext(): boolean {
        const token = this.stream.peek()
        return token?.kind === 'KEYWORD' && token.keyword === 'func'
    }

    parse(visibility: ASTVisibility = 'public'): ASTFunctionDeclaration {
        const funcToken = this.stream.expect('KEYWORD', 'func')
        const name = this.stream.expect('IDENTIFIER').identifier

        const parameters = this.parseParameters()

        // Optional return type annotation `-> Type` or `-> const Type` / `-> ref Type`
        let returnType: string | undefined
        let returnSemantics: 'const' | 'ref' | undefined

        if (this.stream.isNext('PUNCTUATION', '->')) {
            this.stream.expect('PUNCTUATION', '->')
            const maybeSemantics = this.stream.peek()
            if (
                maybeSemantics?.kind === 'KEYWORD' &&
                (maybeSemantics.keyword === 'const' ||
                    maybeSemantics.keyword === 'ref')
            ) {
                returnSemantics = maybeSemantics.keyword
                this.stream.next()
            }
            returnType = this.parseTypeReference()
        }

        // Body: `=> expr` or `{ stmts }`
        if (this.stream.isNext('PUNCTUATION', '=>')) {
            this.stream.expect('PUNCTUATION', '=>')
            const value = new ExpressionParser(this.stream).parse()
            return {
                kind: 'func-decl',
                name,
                visibility,
                parameters,
                returnType,
                returnSemantics,
                body: { kind: 'expression', value },
                position: { line: funcToken.line, column: funcToken.column },
            }
        }

        this.stream.expect('PUNCTUATION', '{')
        const statements = []
        const bodyParser = new Parser(this.stream)
        while (!this.stream.isNext('PUNCTUATION', '}')) {
            const stmt = bodyParser.parseStatement()
            if (!stmt) {
                throw new Error(
                    `Unexpected token in function body: ${JSON.stringify(this.stream.peek())}`,
                )
            }
            statements.push(stmt)
        }
        this.stream.expect('PUNCTUATION', '}')

        return {
            kind: 'func-decl',
            name,
            visibility,
            parameters,
            returnType,
            returnSemantics,
            body: { kind: 'block', statements },
            position: { line: funcToken.line, column: funcToken.column },
        }
    }

    private parseParameters(): ASTFunctionParameter[] {
        this.stream.expect('PUNCTUATION', '(')
        const params: ASTFunctionParameter[] = []

        while (!this.stream.isNext('PUNCTUATION', ')')) {
            if (params.length > 0) {
                this.stream.expect('PUNCTUATION', ',')
            }

            // Either `label name: [semantics] Type` or `name: [semantics] Type`
            const firstToken = this.parseParameterNameToken()
            let label: string | undefined
            let paramName: string

            if (
                this.stream.isNext('IDENTIFIER') ||
                this.stream.isNext('KEYWORD', 'self')
            ) {
                label = firstToken.identifier
                paramName = this.parseParameterNameToken().identifier
            } else {
                paramName = firstToken.identifier
            }

            this.stream.expect('PUNCTUATION', ':')

            // Optional semantics after ':': `name: const Type` / `name: ref Type`
            let semantics: 'const' | 'mut' | 'ref' | undefined
            const maybeSem = this.stream.peek()
            if (
                maybeSem?.kind === 'KEYWORD' &&
                (maybeSem.keyword === 'const' ||
                    maybeSem.keyword === 'mut' ||
                    maybeSem.keyword === 'ref')
            ) {
                semantics = maybeSem.keyword
                this.stream.next()
            }

            const paramType = this.parseTypeReference()

            params.push({
                label,
                name: paramName,
                type: paramType,
                semantics,
                position: {
                    line: firstToken.line,
                    column: firstToken.column,
                },
            })
        }

        this.stream.expect('PUNCTUATION', ')')
        return params
    }

    private parseParameterNameToken(): {
        identifier: string
        line: number
        column: number
    } {
        if (this.stream.isNext('IDENTIFIER')) {
            const token = this.stream.expect('IDENTIFIER')
            return {
                identifier: token.identifier,
                line: token.line,
                column: token.column,
            }
        }

        if (this.stream.isNext('KEYWORD', 'self')) {
            const token = this.stream.expect('KEYWORD', 'self')
            return {
                identifier: token.keyword,
                line: token.line,
                column: token.column,
            }
        }

        const token = this.stream.peek()
        throw new Error(
            `Expected parameter name, got ${JSON.stringify(token ?? 'EOF')}`,
        )
    }

    private parseTypeReference(): string {
        if (this.stream.isNext('PUNCTUATION', '[')) {
            this.stream.expect('PUNCTUATION', '[')
            const elementType = this.stream.expect('IDENTIFIER').identifier
            this.stream.expect('PUNCTUATION', ']')
            return `[${elementType}]`
        }

        return this.stream.expect('IDENTIFIER').identifier
    }
}
