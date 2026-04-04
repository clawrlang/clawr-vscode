import * as vscode from 'vscode'
import { TokenStream } from './lexer'
import { Parser } from './parser'

const semanticTokensLegend = new vscode.SemanticTokensLegend(
    ['keyword', 'number', 'string', 'regexp', 'variable', 'operator'],
    ['declaration'],
)

type SemanticTokenStopReason =
    | 'completed'
    | 'cache-hit'
    | 'skipped-large-doc'
    | 'empty'
    | 'timeout'
    | 'token-cap'
    | 'cancelled'
    | 'error'

interface SemanticTokenSample {
    fileName: string
    requestType: 'full' | 'range'
    durationMs: number
    tokenCount: number
    sourceLength: number
    requestedLines: number
    reason: SemanticTokenStopReason
}

type DiagnosticsStopReason =
    | 'completed'
    | 'parse-error'
    | 'skipped-large-doc'
    | 'debounced'
    | 'disposed'

interface DiagnosticsSample {
    fileName: string
    durationMs: number
    sourceLength: number
    lineCount: number
    reason: DiagnosticsStopReason
}

class SemanticTokenProfiler {
    private readonly samples: SemanticTokenSample[] = []
    private readonly maxSamples = 200

    constructor(private readonly output: vscode.OutputChannel) {}

    record(sample: SemanticTokenSample): void {
        this.samples.push(sample)
        if (this.samples.length > this.maxSamples) {
            this.samples.shift()
        }

        const traceEnabled = vscode.workspace
            .getConfiguration('clawr')
            .get<boolean>('semanticTokens.trace', false)

        if (traceEnabled) {
            this.output.appendLine(
                `[semantic] ${sample.requestType} ${sample.reason} ${sample.durationMs}ms tokens=${sample.tokenCount} chars=${sample.sourceLength} lines=${sample.requestedLines} file=${sample.fileName}`,
            )
        }
    }

    showSummary(): void {
        if (this.samples.length === 0) {
            this.output.appendLine('[semantic] No samples recorded yet.')
            this.output.show(true)
            return
        }

        const sortedSlowest = [...this.samples]
            .sort((a, b) => b.durationMs - a.durationMs)
            .slice(0, 10)

        const total = this.samples.reduce((sum, s) => sum + s.durationMs, 0)
        const average = total / this.samples.length
        const byReason = new Map<SemanticTokenStopReason, number>()
        for (const sample of this.samples) {
            byReason.set(sample.reason, (byReason.get(sample.reason) ?? 0) + 1)
        }

        this.output.appendLine('=== Clawr Semantic Token Stats ===')
        this.output.appendLine(`Samples: ${this.samples.length}`)
        this.output.appendLine(`Average duration: ${average.toFixed(1)}ms`)
        this.output.appendLine(
            `Max duration: ${sortedSlowest[0]?.durationMs ?? 0}ms`,
        )
        this.output.appendLine('Reason counts:')
        for (const [reason, count] of byReason.entries()) {
            this.output.appendLine(`- ${reason}: ${count}`)
        }
        this.output.appendLine('Top slow requests:')
        for (const sample of sortedSlowest) {
            this.output.appendLine(
                `- ${sample.durationMs}ms ${sample.requestType} ${sample.reason} tokens=${sample.tokenCount} chars=${sample.sourceLength} lines=${sample.requestedLines} file=${sample.fileName}`,
            )
        }
        this.output.appendLine('=== End Semantic Token Stats ===')
        this.output.show(true)
    }
}

class DiagnosticsProfiler {
    private readonly samples: DiagnosticsSample[] = []
    private readonly maxSamples = 200

    constructor(private readonly output: vscode.OutputChannel) {}

    record(sample: DiagnosticsSample): void {
        this.samples.push(sample)
        if (this.samples.length > this.maxSamples) {
            this.samples.shift()
        }

        const traceEnabled = vscode.workspace
            .getConfiguration('clawr')
            .get<boolean>('diagnostics.trace', false)

        if (traceEnabled) {
            this.output.appendLine(
                `[diagnostics] ${sample.reason} ${sample.durationMs}ms chars=${sample.sourceLength} lines=${sample.lineCount} file=${sample.fileName}`,
            )
        }
    }

    showSummary(): void {
        if (this.samples.length === 0) {
            this.output.appendLine('[diagnostics] No samples recorded yet.')
            this.output.show(true)
            return
        }

        const sortedSlowest = [...this.samples]
            .sort((a, b) => b.durationMs - a.durationMs)
            .slice(0, 10)

        const total = this.samples.reduce(
            (sum, sample) => sum + sample.durationMs,
            0,
        )
        const average = total / this.samples.length
        const byReason = new Map<DiagnosticsStopReason, number>()
        for (const sample of this.samples) {
            byReason.set(sample.reason, (byReason.get(sample.reason) ?? 0) + 1)
        }

        this.output.appendLine('=== Clawr Diagnostics Stats ===')
        this.output.appendLine(`Samples: ${this.samples.length}`)
        this.output.appendLine(`Average duration: ${average.toFixed(1)}ms`)
        this.output.appendLine(
            `Max duration: ${sortedSlowest[0]?.durationMs ?? 0}ms`,
        )
        this.output.appendLine('Reason counts:')
        for (const [reason, count] of byReason.entries()) {
            this.output.appendLine(`- ${reason}: ${count}`)
        }
        this.output.appendLine('Top slow requests:')
        for (const sample of sortedSlowest) {
            this.output.appendLine(
                `- ${sample.durationMs}ms ${sample.reason} chars=${sample.sourceLength} lines=${sample.lineCount} file=${sample.fileName}`,
            )
        }
        this.output.appendLine('=== End Diagnostics Stats ===')
        this.output.show(true)
    }
}

class ClawrSemanticTokenProvider
    implements vscode.DocumentSemanticTokensProvider
{
    private fullDocCache = new Map<
        string,
        { version: number; tokens: vscode.SemanticTokens }
    >()

    constructor(private readonly profiler: SemanticTokenProfiler) {}

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
            this.profiler.record({
                fileName: document.fileName,
                requestType: 'full',
                durationMs: 0,
                tokenCount: 0,
                sourceLength: 0,
                requestedLines: document.lineCount,
                reason: 'skipped-large-doc',
            })
            return null // Fall back to range-based
        }

        const uri = document.uri.toString()
        const cached = this.fullDocCache.get(uri)

        if (cached && cached.version === document.version) {
            this.profiler.record({
                fileName: document.fileName,
                requestType: 'full',
                durationMs: 0,
                tokenCount: 0,
                sourceLength: 0,
                requestedLines: document.lineCount,
                reason: 'cache-hit',
            })
            return cached.tokens
        }

        const result = this.tokenizeRange(document, null, token, 'full')
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
        return this.tokenizeRange(document, range, token, 'range')
    }

    private tokenizeRange(
        document: vscode.TextDocument,
        range: vscode.Range | null,
        token: vscode.CancellationToken,
        requestType: 'full' | 'range',
    ): vscode.SemanticTokens | null {
        const startMs = Date.now()
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend)
        let reason: SemanticTokenStopReason = 'completed'
        let sourceLength = 0
        let requestedLines = range
            ? range.end.line - range.start.line + 1
            : document.lineCount
        let tokenCount = 0
        let lastLine = -1
        let lastEndChar = -1

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
            sourceLength = source.length

            // Skip tokenization if source is empty
            if (!source.trim()) {
                reason = 'empty'
                return builder.build()
            }

            const stream = new TokenStream(source, document.uri.fsPath)

            // Set a very strict timeout for range-based (should be quick)
            const startTime = Date.now()
            const timeoutMs = range ? 100 : 300 // 100ms for ranges, 300ms for full doc

            let tok = stream.next()
            while (tok && !token.isCancellationRequested) {
                // Check timeout frequently for range-based
                if (Date.now() - startTime > timeoutMs) {
                    reason = 'timeout'
                    break
                }

                // Abort if we're tokenizing too many tokens (indicates infinite loop)
                if (++tokenCount > 10000) {
                    reason = 'token-cap'
                    break
                }

                const [typeIdx, modBits] = this.tokenToLegend(tok)
                if (typeIdx !== -1) {
                    const line = tok.line - 1 + startLine
                    const startChar = tok.column - 1
                    const length = this.getTokenLength(tok)

                    if (length <= 0) {
                        tok = stream.next()
                        continue
                    }

                    if (line === lastLine && startChar < lastEndChar) {
                        tok = stream.next()
                        continue
                    }

                    try {
                        builder.push(line, startChar, length, typeIdx, modBits)
                        lastLine = line
                        lastEndChar = startChar + length
                    } catch (e) {
                        // Skip tokens that are out of bounds
                    }
                }
                tok = stream.next()
            }

            if (token.isCancellationRequested) {
                reason = 'cancelled'
            }
        } catch (e) {
            // Gracefully handle parsing errors
            reason = 'error'
            console.debug(`Tokenization error in ${document.uri.fsPath}:`, e)
        } finally {
            this.profiler.record({
                fileName: document.fileName,
                requestType,
                durationMs: Date.now() - startMs,
                tokenCount,
                sourceLength,
                requestedLines,
                reason,
            })
        }

        return builder.build()
    }

    private tokenToLegend(tok: any): [typeIdx: number, modBits: number] {
        const typeMap: { [key: string]: number } = {
            keyword: 0,
            number: 1,
            string: 2,
            regexp: 3,
            variable: 4,
            operator: 5,
        }

        const modMap: { [key: string]: number } = {
            declaration: 0,
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
                typeIdx = typeMap['regexp']
                break
            case 'INTEGER_LITERAL':
            case 'REAL_LITERAL':
            case 'TRUTH_LITERAL':
                typeIdx = typeMap['number']
                break
            case 'OPERATOR':
                typeIdx = typeMap['operator']
                break
            case 'PUNCTUATION':
                typeIdx = typeMap['operator']
                break
        }

        return [typeIdx, modBits]
    }

    private getKeywordModifiers(keyword: string): string[] {
        if (
            ['func', 'data', 'object', 'service', 'enum', 'union'].includes(
                keyword,
            )
        ) {
            return ['declaration']
        }
        return []
    }

    private getTokenLength(tok: any): number {
        switch (tok.kind) {
            case 'KEYWORD':
                return tok.keyword.length
            case 'IDENTIFIER':
                return tok.identifier.length
            case 'STRING_LITERAL':
                return tok.value.length + 2
            case 'REGEX_LITERAL':
                return tok.pattern.length + 2 + (tok.modifiers?.size ?? 0)
            case 'INTEGER_LITERAL':
                return tok.value.toString().length
            case 'REAL_LITERAL':
                return tok.source.length
            case 'TRUTH_LITERAL':
                return tok.value.length
            case 'OPERATOR':
                return tok.operator.length
            case 'PUNCTUATION':
                return tok.symbol.length
            default:
                return 1
        }
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('Clawr')
    context.subscriptions.push(output)

    const semanticProfiler = new SemanticTokenProfiler(output)
    const diagnosticsProfiler = new DiagnosticsProfiler(output)

    const hello = vscode.commands.registerCommand('clawr.hello', () => {
        vscode.window.showInformationMessage('Clawr extension is active.')
    })

    const showSemanticStats = vscode.commands.registerCommand(
        'clawr.showSemanticTokenStats',
        () => {
            semanticProfiler.showSummary()
        },
    )

    const showDiagnosticsStats = vscode.commands.registerCommand(
        'clawr.showDiagnosticsStats',
        () => {
            diagnosticsProfiler.showSummary()
        },
    )

    context.subscriptions.push(hello, showSemanticStats, showDiagnosticsStats)

    let diagnosticsDisposable: vscode.Disposable | undefined
    const updateDiagnosticsRegistration = (): void => {
        diagnosticsDisposable?.dispose()
        diagnosticsDisposable = undefined

        const diagnosticsEnabled = vscode.workspace
            .getConfiguration('clawr')
            .get<boolean>('diagnostics.enabled', true)

        if (diagnosticsEnabled) {
            diagnosticsDisposable = registerDiagnostics(diagnosticsProfiler)
            context.subscriptions.push(diagnosticsDisposable)
        }
    }

    updateDiagnosticsRegistration()

    const configListener = vscode.workspace.onDidChangeConfiguration(
        (event) => {
            if (
                event.affectsConfiguration('clawr.diagnostics.enabled') ||
                event.affectsConfiguration('clawr.diagnostics.maxLines')
            ) {
                updateDiagnosticsRegistration()
            }
        },
    )
    context.subscriptions.push(configListener)

    const config = vscode.workspace.getConfiguration('clawr')
    const semanticTokensEnabled = config.get<boolean>(
        'semanticTokens.enabled',
        false,
    )

    if (semanticTokensEnabled) {
        const semanticTokenProvider = new ClawrSemanticTokenProvider(
            semanticProfiler,
        )
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

function registerDiagnostics(profiler: DiagnosticsProfiler): vscode.Disposable {
    const diagnostics = vscode.languages.createDiagnosticCollection('clawr')
    const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const diagnosticRunId = new Map<string, number>()

    const runDiagnostics = (document: vscode.TextDocument): void => {
        if (document.languageId !== 'clawr') return

        const key = document.uri.toString()
        const previousTimer = pendingTimers.get(key)
        if (previousTimer) {
            clearTimeout(previousTimer)
            profiler.record({
                fileName: document.fileName,
                durationMs: 0,
                sourceLength: 0,
                lineCount: document.lineCount,
                reason: 'debounced',
            })
        }

        const nextRun = (diagnosticRunId.get(key) ?? 0) + 1
        diagnosticRunId.set(key, nextRun)

        const timer = setTimeout(() => {
            pendingTimers.delete(key)

            if (diagnosticRunId.get(key) !== nextRun) return

            const startMs = Date.now()

            const maxLines = vscode.workspace
                .getConfiguration('clawr')
                .get<number>('diagnostics.maxLines', 2000)

            // Keep diagnostics lightweight and non-blocking for very large files.
            if (document.lineCount > maxLines) {
                diagnostics.delete(document.uri)
                profiler.record({
                    fileName: document.fileName,
                    durationMs: Date.now() - startMs,
                    sourceLength: 0,
                    lineCount: document.lineCount,
                    reason: 'skipped-large-doc',
                })
                return
            }

            try {
                const source = document.getText()
                const parser = new Parser(
                    new TokenStream(source, document.uri.fsPath),
                )
                parser.parse()
                diagnostics.delete(document.uri)
                profiler.record({
                    fileName: document.fileName,
                    durationMs: Date.now() - startMs,
                    sourceLength: source.length,
                    lineCount: document.lineCount,
                    reason: 'completed',
                })
            } catch (error) {
                diagnostics.set(document.uri, [toDiagnostic(error, document)])
                profiler.record({
                    fileName: document.fileName,
                    durationMs: Date.now() - startMs,
                    sourceLength: document.getText().length,
                    lineCount: document.lineCount,
                    reason: 'parse-error',
                })
            }
        }, 250)

        pendingTimers.set(key, timer)
    }

    const openListener = vscode.workspace.onDidOpenTextDocument((doc) => {
        runDiagnostics(doc)
    })

    const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
        runDiagnostics(event.document)
    })

    const closeListener = vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString()
        const timer = pendingTimers.get(key)
        if (timer) {
            clearTimeout(timer)
            pendingTimers.delete(key)
        }
        diagnosticRunId.delete(key)
        diagnostics.delete(doc.uri)
    })

    const active = vscode.window.activeTextEditor?.document
    if (active) {
        runDiagnostics(active)
    }

    return new vscode.Disposable(() => {
        for (const timer of pendingTimers.values()) {
            clearTimeout(timer)
        }
        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === 'clawr') {
                profiler.record({
                    fileName: document.fileName,
                    durationMs: 0,
                    sourceLength: 0,
                    lineCount: document.lineCount,
                    reason: 'disposed',
                })
            }
        }
        pendingTimers.clear()
        diagnosticRunId.clear()
        diagnostics.clear()
        diagnostics.dispose()
        openListener.dispose()
        changeListener.dispose()
        closeListener.dispose()
    })
}

function toDiagnostic(
    error: unknown,
    document: vscode.TextDocument,
): vscode.Diagnostic {
    const message = error instanceof Error ? error.message : String(error)

    // Expected formats:
    // file:line:column:message
    // line:column:message
    const withFile = /^(.*):(\d+):(\d+):(.*)$/.exec(message)
    const lineColOnly = /^(\d+):(\d+):(.*)$/.exec(message)

    let line = 0
    let column = 0
    let text = message

    if (withFile) {
        line = Math.max(0, Number.parseInt(withFile[2], 10) - 1)
        column = Math.max(0, Number.parseInt(withFile[3], 10) - 1)
        text = withFile[4].trim() || message
    } else if (lineColOnly) {
        line = Math.max(0, Number.parseInt(lineColOnly[1], 10) - 1)
        column = Math.max(0, Number.parseInt(lineColOnly[2], 10) - 1)
        text = lineColOnly[3].trim() || message
    }

    if (line >= document.lineCount) {
        line = Math.max(0, document.lineCount - 1)
        column = 0
    }

    const lineText = document.lineAt(line).text
    const safeColumn = Math.min(column, lineText.length)
    const endColumn = Math.min(safeColumn + 1, lineText.length)
    const range = new vscode.Range(line, safeColumn, line, endColumn)

    return new vscode.Diagnostic(range, text, vscode.DiagnosticSeverity.Error)
}
