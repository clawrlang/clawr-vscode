import type {
    ASTExpression,
    ASTFunctionDeclaration,
    ASTProgram,
    ASTStatement,
} from '../ast'

export type IdentifierPosition = {
    name: string
    line: number
    column: number
}

export function collectTopLevelBoundIdentifierPositions(
    program: ASTProgram,
    boundNames: Set<string>,
): IdentifierPosition[] {
    const positions: IdentifierPosition[] = []
    if (boundNames.size === 0) return positions

    const scopes: Array<Set<string>> = [new Set()]
    const bindName = (name: string): void => {
        scopes[scopes.length - 1].add(name)
    }
    const isShadowed = (name: string): boolean => {
        for (let i = scopes.length - 1; i >= 0; i--) {
            if (scopes[i].has(name)) return true
        }
        return false
    }
    const withScope = (work: () => void): void => {
        scopes.push(new Set())
        try {
            work()
        } finally {
            scopes.pop()
        }
    }

    const walkExpression = (expr: ASTExpression): void => {
        switch (expr.kind) {
            case 'identifier':
                if (boundNames.has(expr.name) && !isShadowed(expr.name)) {
                    positions.push({
                        name: expr.name,
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
                for (const val of Object.values(expr.fields)) {
                    walkExpression(val.value)
                }
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

    const walkFunctionBody = (func: ASTFunctionDeclaration): void => {
        withScope(() => {
            for (const param of func.parameters) {
                bindName(param.name)
            }

            if (func.body.kind === 'expression') {
                walkExpression(func.body.value)
            } else {
                walkStatements(func.body.statements, false)
            }
        })
    }

    const walkStatements = (
        statements: ASTStatement[],
        isTopLevel: boolean,
    ): void => {
        for (const stmt of statements) {
            switch (stmt.kind) {
                case 'var-decl':
                    walkExpression(stmt.value)
                    if (!isTopLevel) {
                        bindName(stmt.name)
                    }
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
                    withScope(() => walkStatements(stmt.thenBranch, false))
                    if (stmt.elseBranch) {
                        withScope(() => walkStatements(stmt.elseBranch!, false))
                    }
                    break
                case 'while':
                    walkExpression(stmt.condition)
                    withScope(() => walkStatements(stmt.body, false))
                    break
                case 'for-in':
                    walkExpression(stmt.iterable)
                    withScope(() => {
                        bindName(stmt.loopVar)
                        walkStatements(stmt.body, false)
                    })
                    break
                case 'func-decl':
                    if (!isTopLevel) {
                        bindName(stmt.name)
                    }
                    walkFunctionBody(stmt)
                    break
                case 'object-decl':
                case 'service-decl':
                    if (!isTopLevel) {
                        bindName(stmt.name)
                    }
                    for (const section of stmt.sections) {
                        if (
                            section.kind === 'methods' ||
                            section.kind === 'mutating'
                        ) {
                            for (const method of section.items) {
                                walkFunctionBody(method)
                            }
                        }
                    }
                    break
                default:
                    break
            }
        }
    }

    walkStatements(program.body, true)
    return positions
}
