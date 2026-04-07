import * as vscode from 'vscode'
import fs from 'node:fs'
import path from 'node:path'
import { TokenStream } from './lexer'
import { Parser } from './parser'
import type {
    ASTExpression,
    ASTDataDeclaration,
    ASTFunctionBody,
    ASTFunctionDeclaration,
    ASTObjectDeclaration,
    ASTProgram,
    ASTServiceDeclaration,
    ASTStatement,
    ASTVariableDeclaration,
} from './ast'
import { SemanticAnalyzer, CompilerDiagnosticsError } from './semantic-analyzer'
import { resolveImportPath } from './semantic-analyzer/module-graph'
import { collectImportedDeclarationsForDiagnostics } from './diagnostics/imported-declarations'
import {
    buildGeneralCompletionCandidates,
    buildMemberCompletionCandidates,
    collectSimpleTypeHints,
    type CompletionCandidate,
} from './completion/candidates'
import { collectTopLevelBoundIdentifierPositions } from './references/top-level-bound-positions'
import {
    classifyClawrToken,
    createSemanticClassifierState,
    type SemanticClassifierState,
} from './semantic-tokens/classifier'

const semanticTokensLegend = new vscode.SemanticTokensLegend(
    [
        'keyword',
        'number',
        'string',
        'regexp',
        'variable',
        'operator',
        'class',
        'struct',
        'type',
    ],
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
        const classifierState: SemanticClassifierState =
            createSemanticClassifierState()

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

                const [typeIdx, modBits] = this.tokenToLegend(
                    tok,
                    classifierState,
                )
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

    private tokenToLegend(
        tok: any,
        state: SemanticClassifierState,
    ): [typeIdx: number, modBits: number] {
        const typeMap: { [key: string]: number } = {
            keyword: 0,
            number: 1,
            string: 2,
            regexp: 3,
            variable: 4,
            operator: 5,
            class: 6,
            struct: 7,
            type: 8,
        }

        const modMap: { [key: string]: number } = {
            declaration: 0,
        }

        const classification = classifyClawrToken(tok, state)
        if (!classification.tokenType) return [-1, 0]

        const typeIdx = typeMap[classification.tokenType]
        let modBits = 0
        for (const modifier of classification.modifiers) {
            modBits |= 1 << modMap[modifier]
        }

        return [typeIdx, modBits]
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

    const definitionProvider = vscode.languages.registerDefinitionProvider(
        'clawr',
        {
            async provideDefinition(document, position) {
                return provideClawrDefinition(document, position)
            },
        },
    )
    const referenceProvider = vscode.languages.registerReferenceProvider(
        'clawr',
        {
            async provideReferences(document, position, context) {
                return provideClawrReferences(document, position, context)
            },
        },
    )
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'clawr',
        {
            async provideCompletionItems(document, position) {
                return provideClawrCompletions(document, position)
            },
        },
        '.',
    )
    context.subscriptions.push(
        definitionProvider,
        referenceProvider,
        completionProvider,
    )

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

        const timer = setTimeout(async () => {
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
                const ast = parser.parse()

                const importedPrelude =
                    await collectImportedDeclarationsForDiagnostics(
                        ast,
                        path.resolve(document.uri.fsPath),
                        (filePath) => readWorkspaceFileText(filePath, document),
                    )

                if (diagnosticRunId.get(key) !== nextRun) return

                const diagnosticAst: ASTProgram = {
                    ...ast,
                    body: [...importedPrelude, ...ast.body],
                }

                new SemanticAnalyzer(diagnosticAst).analyze()
                diagnostics.delete(document.uri)
                profiler.record({
                    fileName: document.fileName,
                    durationMs: Date.now() - startMs,
                    sourceLength: source.length,
                    lineCount: document.lineCount,
                    reason: 'completed',
                })
            } catch (error) {
                if (error instanceof CompilerDiagnosticsError) {
                    diagnostics.set(
                        document.uri,
                        error.diagnostics.map((d) => toDiagnostic(d, document)),
                    )
                } else {
                    diagnostics.set(document.uri, [
                        toDiagnostic(error, document),
                    ])
                }
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

async function provideClawrDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<vscode.Location | null> {
    const wordRange = document.getWordRangeAtPosition(
        position,
        /[A-Za-z_][A-Za-z0-9_]*/,
    )
    if (!wordRange) return null

    const symbol = document.getText(wordRange)
    const source = document.getText()
    const program = parseProgram(source, document.uri.fsPath)
    if (!program) return null

    const localScoped = findLocalScopedDefinition(
        program,
        symbol,
        document.uri.fsPath,
        wordRange.start.line + 1,
        wordRange.start.character + 1,
    )
    if (localScoped) {
        return localScoped
    }

    const local = findTopLevelDeclaration(program.body, symbol)
    if (local) {
        return declarationToLocation(document.uri.fsPath, local)
    }

    for (const imp of program.imports) {
        for (const item of imp.items) {
            const importedName = item.alias ?? item.name
            if (importedName !== symbol) continue

            const targetFile = resolveImportPath(
                document.uri.fsPath,
                imp.modulePath,
            )
            const targetSource = await fs.promises.readFile(targetFile, 'utf-8')
            const targetProgram = parseProgram(targetSource, targetFile)
            if (!targetProgram) continue

            const targetDecl = findTopLevelDeclaration(
                targetProgram.body,
                item.name,
            )
            if (targetDecl) {
                return declarationToLocation(targetFile, targetDecl)
            }
        }
    }

    return null
}

async function provideClawrCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<vscode.CompletionItem[]> {
    const source = document.getText()
    const program = parseProgram(source, document.uri.fsPath)
    if (!program) return []

    const importedPrelude = await collectImportedDeclarationsForDiagnostics(
        program,
        path.resolve(document.uri.fsPath),
        (filePath) => readWorkspaceFileText(filePath, document),
    ).catch(() => [])

    const combinedStatements: ASTStatement[] = [
        ...importedPrelude,
        ...program.body,
    ]

    const lineText = document.lineAt(position.line).text
    const linePrefix = lineText.slice(0, position.character)
    const memberContext = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z_0-9]*$/.exec(
        linePrefix,
    )

    if (memberContext) {
        const receiver = memberContext[1]
        const typeByName = collectSimpleTypeHints(combinedStatements)
        const receiverType = typeByName.get(receiver)
        if (!receiverType) return []
        return buildMemberCompletionCandidates(
            combinedStatements,
            receiverType,
        ).map(completionCandidateToItem)
    }

    return buildGeneralCompletionCandidates(
        program,
        combinedStatements,
        source,
        position.line,
        position.character,
    ).map(completionCandidateToItem)
}

function completionCandidateToItem(
    candidate: CompletionCandidate,
): vscode.CompletionItem {
    const kindMap: Record<
        CompletionCandidate['kind'],
        vscode.CompletionItemKind
    > = {
        keyword: vscode.CompletionItemKind.Keyword,
        function: vscode.CompletionItemKind.Function,
        struct: vscode.CompletionItemKind.Struct,
        class: vscode.CompletionItemKind.Class,
        variable: vscode.CompletionItemKind.Variable,
        reference: vscode.CompletionItemKind.Reference,
        field: vscode.CompletionItemKind.Field,
        method: vscode.CompletionItemKind.Method,
    }

    const item = new vscode.CompletionItem(
        candidate.label,
        kindMap[candidate.kind],
    )
    item.detail = candidate.detail
    return item
}

function parseProgram(source: string, filePath: string): ASTProgram | null {
    try {
        return new Parser(new TokenStream(source, filePath)).parse()
    } catch {
        return null
    }
}

function findTopLevelDeclaration(
    body: ASTStatement[],
    symbol: string,
):
    | ASTDataDeclaration
    | ASTFunctionDeclaration
    | ASTObjectDeclaration
    | ASTServiceDeclaration
    | ASTVariableDeclaration
    | null {
    for (const stmt of body) {
        if (stmt.kind === 'data-decl' && stmt.name === symbol) return stmt
        if (stmt.kind === 'func-decl' && stmt.name === symbol) return stmt
        if (stmt.kind === 'object-decl' && stmt.name === symbol) return stmt
        if (stmt.kind === 'service-decl' && stmt.name === symbol) return stmt
        if (stmt.kind === 'var-decl' && stmt.name === symbol) return stmt
    }
    return null
}

function declarationToLocation(
    filePath: string,
    declaration:
        | ASTDataDeclaration
        | ASTFunctionDeclaration
        | ASTObjectDeclaration
        | ASTServiceDeclaration
        | ASTVariableDeclaration,
): vscode.Location {
    const line = Math.max(0, declaration.position.line - 1)
    const fallbackChar = Math.max(0, declaration.position.column - 1)
    let nameChar = fallbackChar

    try {
        const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
        const lineText = lines[line] ?? ''
        const fromDeclaration = lineText.indexOf(declaration.name, fallbackChar)
        nameChar =
            fromDeclaration >= 0
                ? fromDeclaration
                : Math.max(0, lineText.indexOf(declaration.name))

        if (nameChar < 0) {
            nameChar = fallbackChar
        }
    } catch {
        nameChar = fallbackChar
    }

    const range = new vscode.Range(
        line,
        nameChar,
        line,
        nameChar + declaration.name.length,
    )
    return new vscode.Location(vscode.Uri.file(filePath), range)
}

type ScopedDecl = {
    name: string
    line: number
    column: number
}

function findLocalScopedDefinition(
    program: ASTProgram,
    symbol: string,
    filePath: string,
    targetLine: number,
    targetColumn: number,
): vscode.Location | null {
    for (const context of collectFunctionContexts(program)) {
        const found = resolveInFunctionScope(
            context.func,
            symbol,
            filePath,
            targetLine,
            targetColumn,
            program.body,
            context.owner,
        )
        if (found) return found
    }
    return null
}

type FunctionContext = {
    func: ASTFunctionDeclaration
    owner?: ASTObjectDeclaration | ASTServiceDeclaration
}

function collectFunctionContexts(program: ASTProgram): FunctionContext[] {
    const contexts: FunctionContext[] = []

    for (const stmt of program.body) {
        if (stmt.kind === 'func-decl') {
            contexts.push({ func: stmt })
            continue
        }

        if (stmt.kind === 'object-decl' || stmt.kind === 'service-decl') {
            for (const section of stmt.sections) {
                if (section.kind === 'methods' || section.kind === 'mutating') {
                    for (const method of section.items) {
                        contexts.push({ func: method, owner: stmt })
                    }
                }
            }
        }
    }

    return contexts
}

function resolveInFunctionScope(
    func: ASTFunctionDeclaration,
    symbol: string,
    filePath: string,
    targetLine: number,
    targetColumn: number,
    topLevelBody: ASTStatement[],
    owner?: ASTObjectDeclaration | ASTServiceDeclaration,
): vscode.Location | null {
    const scopes: Array<Map<string, ScopedDecl>> = [new Map()]
    const declare = (name: string, line: number, column: number): void => {
        scopes[scopes.length - 1].set(name, { name, line, column })
    }
    const lookup = (name: string): ScopedDecl | null => {
        for (let i = scopes.length - 1; i >= 0; i--) {
            const hit = scopes[i].get(name)
            if (hit) return hit
        }
        return null
    }
    const withScope = (
        work: () => vscode.Location | null,
    ): vscode.Location | null => {
        scopes.push(new Map())
        try {
            return work()
        } finally {
            scopes.pop()
        }
    }

    for (const param of func.parameters) {
        declare(param.name, param.position.line, param.position.column)
    }

    if (owner) {
        declare('self', owner.position.line, owner.position.column)
        if (owner.kind === 'object-decl' && owner.supertype) {
            declare('super', owner.position.line, owner.position.column)
        }
    }

    const parameterTarget = resolveParameterDefinitionLocation(
        filePath,
        func,
        symbol,
        targetLine,
        targetColumn,
    )
    if (parameterTarget) {
        return parameterTarget
    }

    const resolveExpression = (expr: ASTExpression): vscode.Location | null => {
        switch (expr.kind) {
            case 'identifier': {
                if (
                    expr.name === symbol &&
                    expr.position.line === targetLine &&
                    expr.position.column === targetColumn
                ) {
                    if (symbol === 'self' && owner) {
                        return declarationToLocation(filePath, owner)
                    }

                    if (
                        symbol === 'super' &&
                        owner?.kind === 'object-decl' &&
                        owner.supertype
                    ) {
                        const superDecl = findTopLevelDeclaration(
                            topLevelBody,
                            owner.supertype,
                        )
                        if (superDecl) {
                            return declarationToLocation(filePath, superDecl)
                        }
                        return declarationToLocation(filePath, owner)
                    }

                    const decl = lookup(symbol)
                    if (!decl) return null
                    return nameToLocation(
                        filePath,
                        decl.name,
                        decl.line,
                        decl.column,
                    )
                }
                return null
            }
            case 'binary':
                return (
                    resolveExpression(expr.left) ??
                    resolveExpression(expr.right)
                )
            case 'call': {
                const callee = resolveExpression(expr.callee)
                if (callee) return callee
                for (const arg of expr.arguments) {
                    const match = resolveExpression(arg.value)
                    if (match) return match
                }
                return null
            }
            case 'copy':
                return resolveExpression(expr.value)
            case 'array-literal':
                for (const element of expr.elements) {
                    const match = resolveExpression(element)
                    if (match) return match
                }
                return null
            case 'data-literal':
                for (const value of Object.values(expr.fields)) {
                    const match = resolveExpression(value.value)
                    if (match) return match
                }
                return null
            case 'when': {
                const subject = resolveExpression(expr.subject)
                if (subject) return subject
                for (const branch of expr.branches) {
                    if (branch.pattern.kind === 'value-pattern') {
                        const patternMatch = resolveExpression(
                            branch.pattern.value,
                        )
                        if (patternMatch) return patternMatch
                    }
                    const valueMatch = resolveExpression(branch.value)
                    if (valueMatch) return valueMatch
                }
                return null
            }
            default:
                return null
        }
    }

    const resolveStatements = (
        statements: ASTStatement[],
    ): vscode.Location | null => {
        for (const stmt of statements) {
            switch (stmt.kind) {
                case 'var-decl': {
                    const inValue = resolveExpression(stmt.value)
                    if (inValue) return inValue
                    declare(stmt.name, stmt.position.line, stmt.position.column)
                    break
                }
                case 'assign': {
                    const inTarget = resolveExpression(stmt.target)
                    if (inTarget) return inTarget
                    const inValue = resolveExpression(stmt.value)
                    if (inValue) return inValue
                    break
                }
                case 'print': {
                    const inValue = resolveExpression(stmt.value)
                    if (inValue) return inValue
                    break
                }
                case 'return': {
                    if (stmt.value) {
                        const inValue = resolveExpression(stmt.value)
                        if (inValue) return inValue
                    }
                    break
                }
                case 'if': {
                    const inCondition = resolveExpression(stmt.condition)
                    if (inCondition) return inCondition
                    const inThen = withScope(() =>
                        resolveStatements(stmt.thenBranch),
                    )
                    if (inThen) return inThen
                    if (stmt.elseBranch) {
                        const inElse = withScope(() =>
                            resolveStatements(stmt.elseBranch!),
                        )
                        if (inElse) return inElse
                    }
                    break
                }
                case 'while': {
                    const inCondition = resolveExpression(stmt.condition)
                    if (inCondition) return inCondition
                    const inBody = withScope(() => resolveStatements(stmt.body))
                    if (inBody) return inBody
                    break
                }
                case 'for-in': {
                    const inIterable = resolveExpression(stmt.iterable)
                    if (inIterable) return inIterable
                    const inBody = withScope(() => {
                        declare(
                            stmt.loopVar,
                            stmt.position.line,
                            stmt.position.column,
                        )
                        return resolveStatements(stmt.body)
                    })
                    if (inBody) return inBody
                    break
                }
                default:
                    break
            }
        }

        return null
    }

    return resolveFunctionBody(func.body, resolveExpression, resolveStatements)
}

function resolveParameterDefinitionLocation(
    filePath: string,
    func: ASTFunctionDeclaration,
    symbol: string,
    targetLine: number,
    targetColumn: number,
): vscode.Location | null {
    for (const param of func.parameters) {
        if (param.position.line !== targetLine) continue

        const label = param.label
        const lineText = tryReadLine(filePath, targetLine)

        if (label && label === symbol) {
            const labelStart = Math.max(1, param.position.column)
            const labelEnd = labelStart + label.length - 1
            if (targetColumn >= labelStart && targetColumn <= labelEnd) {
                const internalCol =
                    findInternalParameterColumn(lineText, label, param.name) ??
                    labelStart
                return nameToLocation(
                    filePath,
                    param.name,
                    targetLine,
                    internalCol,
                )
            }
        }

        if (param.name === symbol) {
            const nameCol =
                label && lineText
                    ? findInternalParameterColumn(lineText, label, param.name)
                    : param.position.column

            const start = Math.max(1, nameCol ?? param.position.column)
            const end = start + param.name.length - 1
            if (targetColumn >= start && targetColumn <= end) {
                return nameToLocation(filePath, param.name, targetLine, start)
            }
        }
    }

    return null
}

function tryReadLine(filePath: string, line1Based: number): string {
    try {
        const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
        return lines[Math.max(0, line1Based - 1)] ?? ''
    } catch {
        return ''
    }
}

function findInternalParameterColumn(
    lineText: string,
    label: string,
    internalName: string,
): number | null {
    if (!lineText) return null
    const re = new RegExp(
        `\\b${escapeRegExp(label)}\\s+${escapeRegExp(internalName)}\\b`,
    )
    const match = re.exec(lineText)
    if (!match || match.index < 0) return null
    const offset = match[0].indexOf(internalName)
    if (offset < 0) return null
    return match.index + offset + 1
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolveFunctionBody(
    body: ASTFunctionBody,
    resolveExpression: (expr: ASTExpression) => vscode.Location | null,
    resolveStatements: (statements: ASTStatement[]) => vscode.Location | null,
): vscode.Location | null {
    if (body.kind === 'expression') {
        return resolveExpression(body.value)
    }
    return resolveStatements(body.statements)
}

function nameToLocation(
    filePath: string,
    name: string,
    line1Based: number,
    column1Based: number,
): vscode.Location {
    const line = Math.max(0, line1Based - 1)
    const fallbackChar = Math.max(0, column1Based - 1)
    let nameChar = fallbackChar

    try {
        const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
        const lineText = lines[line] ?? ''
        const fromColumn = lineText.indexOf(name, fallbackChar)
        nameChar =
            fromColumn >= 0 ? fromColumn : Math.max(0, lineText.indexOf(name))
        if (nameChar < 0) {
            nameChar = fallbackChar
        }
    } catch {
        nameChar = fallbackChar
    }

    const range = new vscode.Range(line, nameChar, line, nameChar + name.length)
    return new vscode.Location(vscode.Uri.file(filePath), range)
}

type LocalSymbolTarget = {
    name: string
    declaration: ScopedDecl
    func: ASTFunctionDeclaration
    owner?: ASTObjectDeclaration | ASTServiceDeclaration
}

async function provideClawrReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
): Promise<vscode.Location[]> {
    const wordRange = document.getWordRangeAtPosition(
        position,
        /[A-Za-z_][A-Za-z0-9_]*/,
    )
    if (!wordRange) return []

    const symbol = document.getText(wordRange)
    const source = document.getText()
    const program = parseProgram(source, document.uri.fsPath)
    if (!program) return []

    const targetLine = wordRange.start.line + 1
    const targetColumn = wordRange.start.character + 1

    const localTarget = findLocalScopedTarget(
        program,
        symbol,
        document.uri.fsPath,
        targetLine,
        targetColumn,
    )
    if (localTarget) {
        return collectLocalScopedReferences(
            document.uri.fsPath,
            localTarget,
            context.includeDeclaration,
        )
    }

    const definition = await provideClawrDefinition(document, position)
    if (!definition) return []

    const topLevelTarget = resolveTopLevelReferenceTarget(
        program,
        document.uri.fsPath,
        symbol,
        definition,
    )

    if (topLevelTarget) {
        return collectTopLevelModuleReferences(
            document,
            topLevelTarget,
            context.includeDeclaration,
        )
    }

    const results: vscode.Location[] = []
    if (context.includeDeclaration) results.push(definition)

    for (const pos of collectIdentifierPositions(program, symbol)) {
        results.push(
            nameToLocation(document.uri.fsPath, symbol, pos.line, pos.column),
        )
    }

    return dedupeLocations(results)
}

type TopLevelReferenceTarget = {
    declarationFile: string
    declarationName: string
}

function resolveTopLevelReferenceTarget(
    program: ASTProgram,
    currentFile: string,
    symbol: string,
    definition: vscode.Location,
): TopLevelReferenceTarget | null {
    const currentAbs = path.resolve(currentFile)

    for (const imp of program.imports) {
        let importedFile: string
        try {
            importedFile = resolveImportPath(currentAbs, imp.modulePath)
        } catch {
            continue
        }

        for (const item of imp.items) {
            const importedName = item.alias ?? item.name
            if (importedName !== symbol) continue

            const definitionAbs = path.resolve(definition.uri.fsPath)
            if (definitionAbs !== importedFile) continue

            return {
                declarationFile: importedFile,
                declarationName: item.name,
            }
        }
    }

    if (findTopLevelDeclaration(program.body, symbol)) {
        return {
            declarationFile: currentAbs,
            declarationName: symbol,
        }
    }

    if (!definition.uri.fsPath) {
        return null
    }

    const definitionProgram = readProgramFromFile(definition.uri.fsPath)
    if (!definitionProgram) {
        return null
    }

    const definitionLine = definition.range.start.line + 1
    const targetDecl = findTopLevelDeclarationByLine(
        definitionProgram.body,
        definitionLine,
    )
    if (!targetDecl) {
        return null
    }

    return {
        declarationFile: path.resolve(definition.uri.fsPath),
        declarationName: targetDecl.name,
    }
}

async function collectTopLevelModuleReferences(
    currentDocument: vscode.TextDocument,
    target: TopLevelReferenceTarget,
    includeDeclaration: boolean,
): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = []
    const declarationFile = path.resolve(target.declarationFile)

    const uris = await vscode.workspace.findFiles(
        '**/*.clawr',
        '**/{node_modules,dist,out,.git}/**',
    )

    const allFiles = new Set<string>(
        uris.map((uri) => path.resolve(uri.fsPath)),
    )
    allFiles.add(declarationFile)
    allFiles.add(path.resolve(currentDocument.uri.fsPath))

    for (const filePath of allFiles) {
        const source = await readWorkspaceFileText(filePath, currentDocument)
        if (!source) continue

        const program = parseProgram(source, filePath)
        if (!program) continue

        const boundNames = new Set<string>()

        const localDecl = findTopLevelDeclaration(
            program.body,
            target.declarationName,
        )
        if (path.resolve(filePath) === declarationFile && localDecl) {
            if (includeDeclaration) {
                locations.push(declarationToLocation(filePath, localDecl))
            }
            boundNames.add(target.declarationName)
        }

        for (const imp of program.imports) {
            let importedFile: string
            try {
                importedFile = resolveImportPath(filePath, imp.modulePath)
            } catch {
                continue
            }

            if (path.resolve(importedFile) !== declarationFile) continue

            for (const item of imp.items) {
                if (item.name !== target.declarationName) continue

                const localName = item.alias ?? item.name
                boundNames.add(localName)
                locations.push(
                    nameToLocation(
                        filePath,
                        localName,
                        item.position.line,
                        item.position.column,
                    ),
                )
            }
        }

        for (const pos of collectTopLevelBoundIdentifierPositions(
            program,
            boundNames,
        )) {
            locations.push(
                nameToLocation(filePath, pos.name, pos.line, pos.column),
            )
        }
    }

    return dedupeLocations(locations)
}

function readProgramFromFile(filePath: string): ASTProgram | null {
    try {
        const source = fs.readFileSync(filePath, 'utf-8')
        return parseProgram(source, filePath)
    } catch {
        return null
    }
}

function findTopLevelDeclarationByLine(
    body: ASTStatement[],
    line: number,
):
    | ASTDataDeclaration
    | ASTFunctionDeclaration
    | ASTObjectDeclaration
    | ASTServiceDeclaration
    | ASTVariableDeclaration
    | null {
    for (const stmt of body) {
        const isTopLevelDecl =
            stmt.kind === 'data-decl' ||
            stmt.kind === 'func-decl' ||
            stmt.kind === 'object-decl' ||
            stmt.kind === 'service-decl' ||
            stmt.kind === 'var-decl'

        if (isTopLevelDecl && stmt.position.line === line) {
            return stmt
        }
    }

    return null
}

async function readWorkspaceFileText(
    filePath: string,
    currentDocument: vscode.TextDocument,
): Promise<string | null> {
    const absolute = path.resolve(filePath)
    if (path.resolve(currentDocument.uri.fsPath) === absolute) {
        return currentDocument.getText()
    }

    const openDoc = vscode.workspace.textDocuments.find(
        (doc) =>
            doc.uri.scheme === 'file' &&
            path.resolve(doc.uri.fsPath) === absolute,
    )
    if (openDoc) {
        return openDoc.getText()
    }

    try {
        return await fs.promises.readFile(absolute, 'utf-8')
    } catch {
        return null
    }
}

function dedupeLocations(locations: vscode.Location[]): vscode.Location[] {
    const seen = new Set<string>()
    const result: vscode.Location[] = []

    for (const loc of locations) {
        const key = `${loc.uri.toString()}#${loc.range.start.line}:${loc.range.start.character}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push(loc)
    }

    return result
}

function findLocalScopedTarget(
    program: ASTProgram,
    symbol: string,
    filePath: string,
    targetLine: number,
    targetColumn: number,
): LocalSymbolTarget | null {
    for (const context of collectFunctionContexts(program)) {
        const target = resolveLocalTargetInFunction(
            context.func,
            context.owner,
            symbol,
            targetLine,
            targetColumn,
            filePath,
            program.body,
        )
        if (target) return target
    }
    return null
}

function resolveLocalTargetInFunction(
    func: ASTFunctionDeclaration,
    owner: ASTObjectDeclaration | ASTServiceDeclaration | undefined,
    symbol: string,
    targetLine: number,
    targetColumn: number,
    filePath: string,
    topLevelBody: ASTStatement[],
): LocalSymbolTarget | null {
    const scopes: Array<Map<string, ScopedDecl>> = [new Map()]
    const declare = (name: string, line: number, column: number): void => {
        scopes[scopes.length - 1].set(name, { name, line, column })
    }
    const lookup = (name: string): ScopedDecl | null => {
        for (let i = scopes.length - 1; i >= 0; i--) {
            const hit = scopes[i].get(name)
            if (hit) return hit
        }
        return null
    }
    const withScope = <T>(work: () => T): T => {
        scopes.push(new Map())
        try {
            return work()
        } finally {
            scopes.pop()
        }
    }

    for (const param of func.parameters) {
        declare(param.name, param.position.line, param.position.column)
        const lineText = tryReadLine(filePath, param.position.line)
        if (param.label && symbol === param.label) {
            const labelStart = Math.max(1, param.position.column)
            const labelEnd = labelStart + param.label.length - 1
            if (
                targetLine === param.position.line &&
                targetColumn >= labelStart &&
                targetColumn <= labelEnd
            ) {
                return {
                    name: param.name,
                    declaration: {
                        name: param.name,
                        line: param.position.line,
                        column:
                            findInternalParameterColumn(
                                lineText,
                                param.label,
                                param.name,
                            ) ?? param.position.column,
                    },
                    func,
                    owner,
                }
            }
        }
    }

    if (owner) {
        declare('self', owner.position.line, owner.position.column)
        if (owner.kind === 'object-decl' && owner.supertype) {
            const superDecl = findTopLevelDeclaration(
                topLevelBody,
                owner.supertype,
            )
            if (superDecl) {
                declare(
                    'super',
                    superDecl.position.line,
                    superDecl.position.column,
                )
            } else {
                declare('super', owner.position.line, owner.position.column)
            }
        }
    }

    for (const param of func.parameters) {
        if (param.name === symbol) {
            const nameColumn = param.label
                ? (findInternalParameterColumn(
                      tryReadLine(filePath, param.position.line),
                      param.label,
                      param.name,
                  ) ?? param.position.column)
                : param.position.column

            const start = Math.max(1, nameColumn)
            const end = start + param.name.length - 1
            if (
                targetLine === param.position.line &&
                targetColumn >= start &&
                targetColumn <= end
            ) {
                return {
                    name: param.name,
                    declaration: {
                        name: param.name,
                        line: param.position.line,
                        column: start,
                    },
                    func,
                    owner,
                }
            }
        }
    }

    const checkIdentifier = (
        name: string,
        line: number,
        column: number,
    ): LocalSymbolTarget | null => {
        if (name !== symbol || line !== targetLine || column !== targetColumn) {
            return null
        }
        const decl = lookup(name)
        if (!decl) return null
        return { name, declaration: decl, func, owner }
    }

    const walkExpression = (expr: ASTExpression): LocalSymbolTarget | null => {
        switch (expr.kind) {
            case 'identifier':
                return checkIdentifier(
                    expr.name,
                    expr.position.line,
                    expr.position.column,
                )
            case 'binary':
                return walkExpression(expr.left) ?? walkExpression(expr.right)
            case 'call': {
                const callee = walkExpression(expr.callee)
                if (callee) return callee
                for (const arg of expr.arguments) {
                    const hit = walkExpression(arg.value)
                    if (hit) return hit
                }
                return null
            }
            case 'copy':
                return walkExpression(expr.value)
            case 'array-literal':
                for (const el of expr.elements) {
                    const hit = walkExpression(el)
                    if (hit) return hit
                }
                return null
            case 'data-literal':
                for (const val of Object.values(expr.fields)) {
                    const hit = walkExpression(val.value)
                    if (hit) return hit
                }
                return null
            case 'when': {
                const subject = walkExpression(expr.subject)
                if (subject) return subject
                for (const branch of expr.branches) {
                    if (branch.pattern.kind === 'value-pattern') {
                        const p = walkExpression(branch.pattern.value)
                        if (p) return p
                    }
                    const v = walkExpression(branch.value)
                    if (v) return v
                }
                return null
            }
            default:
                return null
        }
    }

    const walkStatements = (
        statements: ASTStatement[],
    ): LocalSymbolTarget | null => {
        for (const stmt of statements) {
            switch (stmt.kind) {
                case 'var-decl': {
                    const inValue = walkExpression(stmt.value)
                    if (inValue) return inValue

                    if (stmt.name === symbol) {
                        const start = stmt.position.column
                        const end = start + stmt.name.length - 1
                        if (
                            stmt.position.line === targetLine &&
                            targetColumn >= start &&
                            targetColumn <= end
                        ) {
                            return {
                                name: stmt.name,
                                declaration: {
                                    name: stmt.name,
                                    line: stmt.position.line,
                                    column: stmt.position.column,
                                },
                                func,
                                owner,
                            }
                        }
                    }

                    declare(stmt.name, stmt.position.line, stmt.position.column)
                    break
                }
                case 'assign': {
                    const inTarget = walkExpression(stmt.target)
                    if (inTarget) return inTarget
                    const inValue = walkExpression(stmt.value)
                    if (inValue) return inValue
                    break
                }
                case 'print': {
                    const inValue = walkExpression(stmt.value)
                    if (inValue) return inValue
                    break
                }
                case 'return': {
                    if (stmt.value) {
                        const inValue = walkExpression(stmt.value)
                        if (inValue) return inValue
                    }
                    break
                }
                case 'if': {
                    const inCondition = walkExpression(stmt.condition)
                    if (inCondition) return inCondition
                    const inThen = withScope(() =>
                        walkStatements(stmt.thenBranch),
                    )
                    if (inThen) return inThen
                    if (stmt.elseBranch) {
                        const inElse = withScope(() =>
                            walkStatements(stmt.elseBranch!),
                        )
                        if (inElse) return inElse
                    }
                    break
                }
                case 'while': {
                    const inCondition = walkExpression(stmt.condition)
                    if (inCondition) return inCondition
                    const inBody = withScope(() => walkStatements(stmt.body))
                    if (inBody) return inBody
                    break
                }
                case 'for-in': {
                    const inIterable = walkExpression(stmt.iterable)
                    if (inIterable) return inIterable
                    const inBody = withScope(() => {
                        declare(
                            stmt.loopVar,
                            stmt.position.line,
                            stmt.position.column,
                        )
                        return walkStatements(stmt.body)
                    })
                    if (inBody) return inBody
                    break
                }
                default:
                    break
            }
        }
        return null
    }

    if (func.body.kind === 'expression') {
        return walkExpression(func.body.value)
    }

    return walkStatements(func.body.statements)
}

function collectLocalScopedReferences(
    filePath: string,
    target: LocalSymbolTarget,
    includeDeclaration: boolean,
): vscode.Location[] {
    const scopes: Array<Map<string, ScopedDecl>> = [new Map()]
    const refs: vscode.Location[] = []

    const declare = (name: string, line: number, column: number): void => {
        scopes[scopes.length - 1].set(name, { name, line, column })
    }
    const lookup = (name: string): ScopedDecl | null => {
        for (let i = scopes.length - 1; i >= 0; i--) {
            const hit = scopes[i].get(name)
            if (hit) return hit
        }
        return null
    }
    const withScope = (work: () => void): void => {
        scopes.push(new Map())
        try {
            work()
        } finally {
            scopes.pop()
        }
    }
    const isTargetDecl = (decl: ScopedDecl | null): boolean => {
        return (
            !!decl &&
            decl.name === target.declaration.name &&
            decl.line === target.declaration.line &&
            decl.column === target.declaration.column
        )
    }
    const addRef = (name: string, line: number, column: number): void => {
        refs.push(nameToLocation(filePath, name, line, column))
    }

    for (const param of target.func.parameters) {
        declare(param.name, param.position.line, param.position.column)
    }
    if (target.owner) {
        declare(
            'self',
            target.owner.position.line,
            target.owner.position.column,
        )
        if (target.owner.kind === 'object-decl' && target.owner.supertype) {
            declare(
                'super',
                target.owner.position.line,
                target.owner.position.column,
            )
        }
    }

    if (includeDeclaration) {
        addRef(
            target.declaration.name,
            target.declaration.line,
            target.declaration.column,
        )
    }

    const walkExpression = (expr: ASTExpression): void => {
        switch (expr.kind) {
            case 'identifier': {
                const decl = lookup(expr.name)
                if (isTargetDecl(decl)) {
                    addRef(expr.name, expr.position.line, expr.position.column)
                }
                return
            }
            case 'binary':
                walkExpression(expr.left)
                walkExpression(expr.right)
                return
            case 'call':
                walkExpression(expr.callee)
                for (const arg of expr.arguments) walkExpression(arg.value)
                return
            case 'copy':
                walkExpression(expr.value)
                return
            case 'array-literal':
                for (const el of expr.elements) walkExpression(el)
                return
            case 'data-literal':
                for (const val of Object.values(expr.fields))
                    walkExpression(val.value)
                return
            case 'when':
                walkExpression(expr.subject)
                for (const branch of expr.branches) {
                    if (branch.pattern.kind === 'value-pattern') {
                        walkExpression(branch.pattern.value)
                    }
                    walkExpression(branch.value)
                }
                return
            default:
                return
        }
    }

    const walkStatements = (statements: ASTStatement[]): void => {
        for (const stmt of statements) {
            switch (stmt.kind) {
                case 'var-decl': {
                    walkExpression(stmt.value)
                    declare(stmt.name, stmt.position.line, stmt.position.column)
                    if (
                        includeDeclaration &&
                        stmt.name === target.declaration.name &&
                        stmt.position.line === target.declaration.line &&
                        stmt.position.column === target.declaration.column
                    ) {
                        addRef(
                            stmt.name,
                            stmt.position.line,
                            stmt.position.column,
                        )
                    }
                    break
                }
                case 'assign':
                    walkExpression(stmt.target)
                    walkExpression(stmt.value)
                    break
                case 'print':
                    walkExpression(stmt.value)
                    break
                case 'return':
                    if (stmt.value) walkExpression(stmt.value)
                    break
                case 'if':
                    walkExpression(stmt.condition)
                    withScope(() => walkStatements(stmt.thenBranch))
                    if (stmt.elseBranch) {
                        withScope(() => walkStatements(stmt.elseBranch!))
                    }
                    break
                case 'while':
                    walkExpression(stmt.condition)
                    withScope(() => walkStatements(stmt.body))
                    break
                case 'for-in':
                    walkExpression(stmt.iterable)
                    withScope(() => {
                        declare(
                            stmt.loopVar,
                            stmt.position.line,
                            stmt.position.column,
                        )
                        walkStatements(stmt.body)
                    })
                    break
                default:
                    break
            }
        }
    }

    if (target.func.body.kind === 'expression') {
        walkExpression(target.func.body.value)
    } else {
        walkStatements(target.func.body.statements)
    }

    return dedupeLocations(refs)
}

function collectIdentifierPositions(
    program: ASTProgram,
    symbol: string,
): Array<{ line: number; column: number }> {
    const positions: Array<{ line: number; column: number }> = []

    const walkExpression = (expr: ASTExpression): void => {
        switch (expr.kind) {
            case 'identifier':
                if (expr.name === symbol) {
                    positions.push({
                        line: expr.position.line,
                        column: expr.position.column,
                    })
                }
                return
            case 'binary':
                walkExpression(expr.left)
                walkExpression(expr.right)
                return
            case 'call':
                walkExpression(expr.callee)
                for (const arg of expr.arguments) walkExpression(arg.value)
                return
            case 'copy':
                walkExpression(expr.value)
                return
            case 'array-literal':
                for (const el of expr.elements) walkExpression(el)
                return
            case 'data-literal':
                for (const val of Object.values(expr.fields))
                    walkExpression(val.value)
                return
            case 'when':
                walkExpression(expr.subject)
                for (const branch of expr.branches) {
                    if (branch.pattern.kind === 'value-pattern') {
                        walkExpression(branch.pattern.value)
                    }
                    walkExpression(branch.value)
                }
                return
            default:
                return
        }
    }

    const walkStatements = (statements: ASTStatement[]): void => {
        for (const stmt of statements) {
            switch (stmt.kind) {
                case 'var-decl':
                    walkExpression(stmt.value)
                    break
                case 'assign':
                    walkExpression(stmt.target)
                    walkExpression(stmt.value)
                    break
                case 'print':
                    walkExpression(stmt.value)
                    break
                case 'return':
                    if (stmt.value) walkExpression(stmt.value)
                    break
                case 'if':
                    walkExpression(stmt.condition)
                    walkStatements(stmt.thenBranch)
                    if (stmt.elseBranch) walkStatements(stmt.elseBranch)
                    break
                case 'while':
                    walkExpression(stmt.condition)
                    walkStatements(stmt.body)
                    break
                case 'for-in':
                    walkExpression(stmt.iterable)
                    walkStatements(stmt.body)
                    break
                case 'func-decl':
                    if (stmt.body.kind === 'expression') {
                        walkExpression(stmt.body.value)
                    } else {
                        walkStatements(stmt.body.statements)
                    }
                    break
                case 'object-decl':
                case 'service-decl':
                    for (const section of stmt.sections) {
                        if (
                            section.kind === 'methods' ||
                            section.kind === 'mutating'
                        ) {
                            for (const method of section.items) {
                                if (method.body.kind === 'expression') {
                                    walkExpression(method.body.value)
                                } else {
                                    walkStatements(method.body.statements)
                                }
                            }
                        }
                    }
                    break
                default:
                    break
            }
        }
    }

    walkStatements(program.body)
    return positions
}
