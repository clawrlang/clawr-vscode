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
    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.SemanticTokens {
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend)

        try {
            const source = document.getText()
            const stream = new TokenStream(source, document.uri.fsPath)

            let tok = stream.next()
            while (tok && !token.isCancellationRequested) {
                const [typeIdx, modBits] = this.tokenToLegend(tok)
                if (typeIdx !== -1) {
                    const line = tok.line - 1
                    const startChar = tok.column - 1
                    builder.push(
                        line,
                        startChar,
                        this.getTokenLength(tok),
                        typeIdx,
                        modBits,
                    )
                }
                tok = stream.next()
            }
        } catch (e) {
            // Gracefully handle parsing errors
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

    const semanticTokenProvider = new ClawrSemanticTokenProvider()
    const disposable = vscode.languages.registerDocumentSemanticTokensProvider(
        'clawr',
        semanticTokenProvider,
        semanticTokensLegend,
    )

    context.subscriptions.push(hello, disposable)
}

export function deactivate(): void {}
