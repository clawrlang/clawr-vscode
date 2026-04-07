import type { ASTProgram, ASTStatement } from '../ast'

export type CompletionCandidateKind =
    | 'keyword'
    | 'function'
    | 'struct'
    | 'class'
    | 'variable'
    | 'reference'
    | 'field'
    | 'method'

export interface CompletionCandidate {
    label: string
    kind: CompletionCandidateKind
    detail?: string
}

export const CLAWR_KEYWORDS = [
    'import',
    'from',
    'as',
    'const',
    'mut',
    'ref',
    'func',
    'return',
    'if',
    'else',
    'while',
    'for',
    'in',
    'break',
    'continue',
    'when',
    'print',
    'data',
    'object',
    'service',
    'helper',
]

export function buildGeneralCompletionCandidates(
    program: ASTProgram,
    combinedStatements: ASTStatement[],
    source: string,
    line: number,
    character: number,
): CompletionCandidate[] {
    const completionMap = new Map<string, CompletionCandidate>()
    const add = (item: CompletionCandidate): void => {
        if (!completionMap.has(item.label)) {
            completionMap.set(item.label, item)
        }
    }

    for (const keyword of CLAWR_KEYWORDS) {
        add({ label: keyword, kind: 'keyword' })
    }

    for (const stmt of combinedStatements) {
        if (stmt.kind === 'func-decl') {
            add({ label: stmt.name, kind: 'function', detail: 'function' })
        }
        if (stmt.kind === 'data-decl') {
            add({ label: stmt.name, kind: 'struct', detail: 'data type' })
        }
        if (stmt.kind === 'object-decl' || stmt.kind === 'service-decl') {
            add({
                label: stmt.name,
                kind: 'class',
                detail:
                    stmt.kind === 'object-decl'
                        ? 'object type'
                        : 'service type',
            })
        }
        if (stmt.kind === 'var-decl') {
            add({
                label: stmt.name,
                kind: 'variable',
                detail: stmt.valueSet?.type,
            })
        }
    }

    for (const imp of program.imports) {
        for (const imported of imp.items) {
            const label = imported.alias ?? imported.name
            add({ label, kind: 'reference' })
        }
    }

    for (const localName of collectSimpleLocalNamesBeforePosition(
        source,
        line,
        character,
    )) {
        add({ label: localName, kind: 'variable' })
    }

    return [...completionMap.values()]
}

export function collectSimpleTypeHints(
    statements: ASTStatement[],
): Map<string, string> {
    const result = new Map<string, string>()

    const walkStatement = (stmt: ASTStatement): void => {
        if (stmt.kind === 'var-decl' && stmt.valueSet?.type) {
            result.set(stmt.name, stmt.valueSet.type)
        }

        if (stmt.kind === 'func-decl') {
            for (const param of stmt.parameters) {
                result.set(param.name, param.type)
            }

            if (stmt.body.kind === 'block') {
                for (const nested of stmt.body.statements) {
                    walkStatement(nested)
                }
            }
        }

        if (stmt.kind === 'if') {
            for (const nested of stmt.thenBranch) walkStatement(nested)
            for (const nested of stmt.elseBranch ?? []) walkStatement(nested)
        }

        if (stmt.kind === 'while') {
            for (const nested of stmt.body) walkStatement(nested)
        }

        if (stmt.kind === 'for-in') {
            for (const nested of stmt.body) walkStatement(nested)
        }
    }

    for (const stmt of statements) {
        walkStatement(stmt)
    }

    return result
}

export function buildMemberCompletionCandidates(
    statements: ASTStatement[],
    receiverType: string,
): CompletionCandidate[] {
    const items: CompletionCandidate[] = []

    for (const stmt of statements) {
        if (stmt.kind === 'data-decl' && stmt.name === receiverType) {
            for (const field of stmt.fields) {
                items.push({
                    label: field.name,
                    kind: 'field',
                    detail: field.type,
                })
            }
            continue
        }

        if (
            (stmt.kind === 'object-decl' || stmt.kind === 'service-decl') &&
            stmt.name === receiverType
        ) {
            for (const section of stmt.sections) {
                if (section.kind === 'data') {
                    for (const field of section.fields) {
                        items.push({
                            label: field.name,
                            kind: 'field',
                            detail: field.type,
                        })
                    }
                }

                if (
                    section.kind === 'methods' ||
                    section.kind === 'mutating' ||
                    section.kind === 'inheritance'
                ) {
                    for (const method of section.items) {
                        const signature = method.parameters
                            .map(
                                (param) =>
                                    `${param.label ?? '_'}: ${param.type}`,
                            )
                            .join(', ')
                        items.push({
                            label: method.name,
                            kind: 'method',
                            detail: `(${signature})${method.returnType ? ` -> ${method.returnType}` : ''}`,
                        })
                    }
                }
            }
        }
    }

    const deduped = new Map<string, CompletionCandidate>()
    for (const item of items) {
        if (!deduped.has(item.label)) {
            deduped.set(item.label, item)
        }
    }

    return [...deduped.values()]
}

export function collectSimpleLocalNamesBeforePosition(
    source: string,
    line: number,
    character: number,
): string[] {
    const lines = source.split(/\r?\n/)
    const head = lines.slice(0, line)
    const current = lines[line] ?? ''
    head.push(current.slice(0, character))
    const visibleSource = head.join('\n')

    const names = new Set<string>()
    const addMatches = (regex: RegExp): void => {
        for (const match of visibleSource.matchAll(regex)) {
            if (match[1]) names.add(match[1])
        }
    }

    addMatches(/\b(?:const|mut|ref)\s+([A-Za-z_][A-Za-z0-9_]*)/g)
    addMatches(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g)

    for (const match of visibleSource.matchAll(
        /\bfunc\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/g,
    )) {
        const params = match[1]
        for (const part of params.split(',')) {
            const trimmed = part.trim()
            if (!trimmed) continue
            const paramMatch =
                /^(?:[A-Za-z_][A-Za-z0-9_]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(
                    trimmed,
                )
            if (paramMatch?.[1]) names.add(paramMatch[1])
        }
    }

    return [...names.values()]
}
