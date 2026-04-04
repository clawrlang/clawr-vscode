import * as vscode from 'vscode'
import { TokenStream } from './lexer'

const semanticTokensLegend = new vscode.SemanticTokensLegend(
    [
        'keyword',
        'number',
        'string',
        'variable',
        'operator',
        'comment',
        'type',
        'function',
        'punctuation',
    ],
    ['control', 'declaration', 'modifier'],
)

class ClawrSemanticTokenProvider
    implements vscode.DocumentSemanticTokensProvider
{
    private fullDocCache = new Map<
        string,
        { version: number; tokens: vscode.SemanticTokens }
    >()

    /**
     * Full document tokenization - only used if range-based fails or for initial load.
     * Returns early if too large to avoid blocking.
     */
    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.SemanticTokens | null {
        // For large files, skip full document tokenization to avoid blocking
        if (document.lineCount > 500) {
            return null // Fall back to range-based
        }

        const uri = document.uri.toString()
        const cached = this.fullDocCache.get(uri)

        if (cached && cached.version === document.version) {
            return cached.tokens
        }

        const result = this.tokenizeRange(document, null, token)
        if (result) {
            this.fullDocCache.set(uri, {
                version: document.version,
                tokens: result,
            })
        }
        return result || null
    }

    /**
     * Range-based tokenization - only tokenizes the requested range.
     * This is much faster for large files since only visible text is processed.
     */
    provideDocumentRangeSemanticTokens(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): vscode.SemanticTokens | null {
        return this.tokenizeRange(document, range, token)
    }

    private tokenizeRange(
        document: vscode.TextDocument,
        range: vscode.Range | null,
        token: vscode.CancellationToken,
    ): vscode.SemanticTokens | null {
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend)

        try {
            // Only get text from the requested range, or full document if no range
            let source: string
            let startLine = 0
            if (range) {
                source = document.getText(range)
                startLine = range.start.line
            } else {
                source = document.getText()
            }

            // Skip tokenization if source is empty
            if (!source.trim()) {
                return builder.build()
            }

            const stream = new TokenStream(source, document.uri.fsPath)

            // Set a very strict timeout for range-based (should be quick)
            const startTime = Date.now()
            const timeoutMs = range ? 100 : 300 // 100ms for ranges, 300ms for full doc

            let tok = stream.next()
            let tokenCount = 0

            while (tok && !token.isCancellationRequested) {
                // Check timeout frequently for range-based
                if (Date.now() - startTime > timeoutMs) {
                    break
                }

                // Abort if we're tokenizing too many tokens (indicates infinite loop)
                if (++tokenCount > 10000) {
                    break
                }

                const [typeIdx, modBits] = this.tokenToLegend(tok)
                if (typeIdx !== -1) {
                    const line = tok.line - 1 + startLine
                    const startChar = tok.column - 1
                    try {
                        builder.push(
                            line,
                            startChar,
                            this.getTokenLength(tok),
                            typeIdx,
                            modBits,
                        )
                    } catch (e) {
                        // Skip tokens that are out of bounds
                    }
                }
                tok = stream.next()
            }
        } catch (e) {
            // Gracefully handle parsing errors
            console.debug(`Tokenization error in ${document.uri.fsPath}:`, e)
        }

        return builder.build()
    }

    private tokenToLegend(tok: any): [typeIdx: number, modBits: number] {
        const typeMap: { [key: string]: number } = {
            keyword: 0,
            number: 1,
            string: 2,
            variable: 3,
            operator: 4,
            comment: 5,
            type: 6,
            function: 7,
            punctuation: 8,
        }

        const modMap: { [key: string]: number } = {
            control: 0,
            declaration: 1,
            modifier: 2,
        }

        let typeIdx = -1
        let modBits = 0

        switch (tok.kind) {
            case 'KEYWORD':
                typeIdx = typeMap['keyword']
                const mods = this.getKeywordModifiers(tok.keyword)
                mods.forEach((mod) => {
                    modBits |= 1 << modMap[mod]
                })
                break
            case 'IDENTIFIER':
                typeIdx = typeMap['variable']
                break
            case 'STRING_LITERAL':
                typeIdx = typeMap['string']
                break
            case 'REGEX_LITERAL':
                typeIdx = typeMap['string']
                break
            case 'INTEGER':
            case 'REAL':
                typeIdx = typeMap['number']
                break
            case 'OPERATOR':
                typeIdx = typeMap['operator']
                break
            case 'PUNCTUATION':
                typeIdx = typeMap['punctuation']
                break
        }

        return [typeIdx, modBits]
    }

    private getKeywordModifiers(keyword: string): string[] {
        if (
            [
                'const',
                'mut',
                'ref',
                'helper',
                'mutating',
                'pure',
                'atomic',
                'concurrent',
            ].includes(keyword)
        ) {
            return ['modifier']
        }
        if (
            ['func', 'data', 'object', 'service', 'enum', 'union'].includes(
                keyword,
            )
        ) {
            return ['declaration']
        }
        if (
            [
                'if',
                'else',
                'while',
                'for',
                'return',
                'break',
                'continue',
                'when',
                'case',
            ].includes(keyword)
        ) {
            return ['control']
        }
        return []
    }

    private getTokenLength(tok: any): number {
        if ('keyword' in tok) return tok.keyword.length
        if ('identifier' in tok) return tok.identifier.length
        if ('value' in tok) return tok.value.length + 2 // string includes quotes
        if ('pattern' in tok) return tok.pattern.length + 2 // regex includes slashes
        if ('number' in tok) return tok.number.toString().length
        if ('operator' in tok) return tok.operator.length
        if ('symbol' in tok) return tok.symbol.length
        return 1
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const hello = vscode.commands.registerCommand('clawr.hello', () => {
        vscode.window.showInformationMessage('Clawr extension is active.')
    })

    context.subscriptions.push(hello)

    const config = vscode.workspace.getConfiguration('clawr')
    const semanticTokensEnabled = config.get<boolean>(
        'semanticTokens.enabled',
        false,
    )

    if (semanticTokensEnabled) {
        const semanticTokenProvider = new ClawrSemanticTokenProvider()
        const disposable =
            vscode.languages.registerDocumentSemanticTokensProvider(
                'clawr',
                semanticTokenProvider,
                semanticTokensLegend,
            )

        context.subscriptions.push(disposable)
    }
}

export function deactivate(): void {}
