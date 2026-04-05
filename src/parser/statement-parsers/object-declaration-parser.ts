import type {
    ASTFunctionDeclaration,
    ASTObjectDeclaration,
    ASTObjectField,
    ASTObjectSection,
    ASTPosition,
    ASTServiceDeclaration,
    ASTVisibility,
} from '../../ast'
import { FunctionDeclarationParser } from './function-declaration-parser'

export class ObjectDeclarationParser {
    constructor(private stream: import('../../lexer').TokenStream) {}

    isNext(): boolean {
        const token = this.stream.peek()
        return (
            token?.kind === 'KEYWORD' &&
            (token.keyword === 'object' || token.keyword === 'service')
        )
    }

    parse(
        visibility: ASTVisibility = 'public',
    ): ASTObjectDeclaration | ASTServiceDeclaration {
        let isService = false
        let position: ASTPosition

        if (this.stream.isNext('KEYWORD', 'object')) {
            const t = this.stream.expect('KEYWORD', 'object')
            position = {
                file: this.stream.file,
                line: t.line,
                column: t.column,
            }
        } else {
            const t = this.stream.expect('KEYWORD', 'service')
            position = {
                file: this.stream.file,
                line: t.line,
                column: t.column,
            }
            isService = true
        }

        const name = this.stream.expect('IDENTIFIER').identifier

        // Optional supertype `Name: Super` (only for object, not service)
        let supertype: string | undefined
        let supertypePosition: ASTPosition | undefined
        if (!isService && this.stream.isNext('PUNCTUATION', ':')) {
            this.stream.expect('PUNCTUATION', ':')
            const supertypeToken = this.stream.expect('IDENTIFIER')
            supertype = supertypeToken.identifier
            supertypePosition = {
                file: this.stream.file,
                line: supertypeToken.line,
                column: supertypeToken.column,
            }
        }

        this.stream.expect('PUNCTUATION', '{')
        const sections = this.parseSections()
        this.stream.expect('PUNCTUATION', '}')

        if (isService) {
            return {
                kind: 'service-decl',
                name,
                visibility,
                sections,
                position,
            }
        }
        return {
            kind: 'object-decl',
            name,
            supertype,
            supertypePosition,
            visibility,
            sections,
            position,
        }
    }

    private parseSections(): ASTObjectSection[] {
        const sections: ASTObjectSection[] = []
        const funcParser = new FunctionDeclarationParser(this.stream)

        while (!this.stream.isNext('PUNCTUATION', '}')) {
            if (this.stream.isNext('KEYWORD', 'data')) {
                this.stream.expect('KEYWORD', 'data')
                this.stream.expect('PUNCTUATION', ':')
                const fields: ASTObjectField[] = []
                while (!this.isSectionBoundary()) {
                    fields.push(this.parseField())
                }
                sections.push({ kind: 'data', fields })
            } else if (this.stream.isNext('KEYWORD', 'mutating')) {
                this.stream.expect('KEYWORD', 'mutating')
                this.stream.expect('PUNCTUATION', ':')
                const items: ASTFunctionDeclaration[] = []
                while (!this.isSectionBoundary()) {
                    items.push(this.parseMethod(funcParser))
                }
                sections.push({ kind: 'mutating', items })
            } else if (this.stream.isNext('KEYWORD', 'inheritance')) {
                this.stream.expect('KEYWORD', 'inheritance')
                this.stream.expect('PUNCTUATION', ':')
                const items: ASTFunctionDeclaration[] = []
                while (!this.isSectionBoundary()) {
                    items.push(this.parseMethod(funcParser))
                }
                sections.push({ kind: 'inheritance', items })
            } else {
                // Method — coalesce consecutive methods into one section
                const method = this.parseMethod(funcParser)
                const last = sections[sections.length - 1]
                if (last?.kind === 'methods') {
                    last.items.push(method)
                } else {
                    sections.push({ kind: 'methods', items: [method] })
                }
            }
        }

        return sections
    }

    private isSectionBoundary(): boolean {
        const token = this.stream.peek()
        if (!token) return true
        if (token.kind === 'PUNCTUATION' && token.symbol === '}') return true
        return (
            token.kind === 'KEYWORD' &&
            (token.keyword === 'data' ||
                token.keyword === 'mutating' ||
                token.keyword === 'inheritance')
        )
    }

    private parseMethod(
        funcParser: FunctionDeclarationParser,
    ): ASTFunctionDeclaration {
        if (this.stream.isNext('KEYWORD', 'helper')) {
            this.stream.expect('KEYWORD', 'helper')
            if (!funcParser.isNext()) {
                const token = this.stream.peek()
                throw new Error(
                    `${token?.line ?? '?'}:${token?.column ?? '?'}:Expected func after helper inside ${this.stream.peek()?.kind ?? 'body'}`,
                )
            }
            return funcParser.parse('helper')
        }
        if (!funcParser.isNext()) {
            const token = this.stream.peek()
            throw new Error(
                `${token?.line ?? '?'}:${token?.column ?? '?'}:Expected method declaration (func or helper func)`,
            )
        }
        return funcParser.parse('public')
    }

    private parseField(): ASTObjectField {
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
        const fieldNameToken = this.stream.expect('IDENTIFIER')
        this.stream.expect('PUNCTUATION', ':')
        const fieldType = this.stream.expect('IDENTIFIER').identifier

        // Optional comma separator between fields
        if (this.stream.isNext('PUNCTUATION', ',')) {
            this.stream.next()
        } else if (
            !this.stream.isNext('NEWLINE') &&
            !this.isSectionBoundary()
        ) {
            const next = this.stream.peek()!
            throw new Error(
                `${this.stream.file}:${next.line}:${next.column}:Expected ',' or newline to separate fields`,
            )
        }

        return {
            semantics,
            name: fieldNameToken.identifier,
            type: fieldType,
            position: {
                file: this.stream.file,
                line: fieldNameToken.line,
                column: fieldNameToken.column,
            },
        }
    }
}
