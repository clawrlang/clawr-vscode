import type {
    ASTAssignment,
    ASTDataDeclaration,
    ASTDataLiteral,
    ASTExpression,
    ASTFunctionDeclaration,
    ASTIdentifier,
    ASTProgram,
    ASTReturnStatement,
    ASTStatement,
    ASTVariableDeclaration,
} from '../ast'
import type { ASTObjectDeclaration, ASTServiceDeclaration } from '../ast'
import type {
    SemanticAssignment,
    SemanticCopyExpression,
    SemanticDataDeclaration,
    SemanticExpression,
    SemanticFieldAccess,
    SemanticFunction,
    SemanticModule,
    SemanticOwnershipEffects,
    SemanticPrintStatement,
    SemanticReturnStatement,
    SemanticStatement,
    SemanticVariableDeclaration,
} from './ast'

export type {
    SemanticArrayIndexExpression,
    SemanticAssignment,
    SemanticDataDeclaration,
    SemanticForInStatement,
    SemanticFieldAccess,
    SemanticFunction,
    SemanticModule,
    SemanticOwnershipEffects,
    SemanticPrintStatement,
    SemanticReturnStatement,
    SemanticStatement,
    SemanticExpression,
    SemanticValueSet,
    SemanticVariableDeclaration,
    SemanticTypeKind,
    SemanticFunctionSignature,
} from './ast'

export class CompilerDiagnosticsError extends Error {
    constructor(readonly diagnostics: string[]) {
        super(
            diagnostics.map((diagnostic) => `Error: ${diagnostic}`).join('\n'),
        )
        this.name = 'CompilerDiagnosticsError'
    }
}

function posStr(pos: { file?: string; line: number; column: number }): string {
    return pos.file
        ? `${pos.file}:${pos.line}:${pos.column}`
        : `${pos.line}:${pos.column}`
}

export class SemanticAnalyzer {
    private bindings: BindingMap = new Map()
    private dataTypes: Map<string, BindingMap>
    private functionSignatures: Map<string, FunctionSignature>
    private typeKinds: Map<string, TypeKind>
    private objectSupertypes: Map<string, string>
    private inheritableObjects: Set<string>
    private diagnostics: string[]

    constructor(
        private ast: ASTProgram,
        private parent?: SemanticAnalyzer,
        dataTypes?: Map<string, BindingMap>,
        functionSignatures?: Map<string, FunctionSignature>,
        typeKinds?: Map<string, TypeKind>,
        objectSupertypes?: Map<string, string>,
        inheritableObjects?: Set<string>,
        private loopDepth = 0,
        private currentFunctionReturnType?: string,
        private currentOwnerType?: string,
        private currentOwnerKind?: 'object' | 'service',
        private currentMethodMutating = false,
        private currentInheritanceInitializer = false,
        private currentInheritanceSelfInitialized = true,
        private currentFunctionEffectLevel: EffectLevel | null = null,
        diagnostics?: string[],
    ) {
        this.dataTypes = dataTypes ?? parent?.dataTypes ?? new Map()
        this.functionSignatures =
            functionSignatures ?? parent?.functionSignatures ?? new Map()
        this.typeKinds = typeKinds ?? parent?.typeKinds ?? new Map()
        this.objectSupertypes =
            objectSupertypes ?? parent?.objectSupertypes ?? new Map()
        this.inheritableObjects =
            inheritableObjects ?? parent?.inheritableObjects ?? new Set()
        this.diagnostics = diagnostics ?? parent?.diagnostics ?? []
    }

    analyze(): SemanticModule {
        const types: SemanticDataDeclaration[] = []
        const typeDeclarations = new Map<
            ASTDataDeclaration,
            SemanticDataDeclaration
        >()
        const objects: ASTObjectDeclaration[] = []
        const services: ASTServiceDeclaration[] = []
        const mainBody: SemanticStatement[] = []
        const userFunctions: SemanticFunction[] = []
        const typeMethods: SemanticFunction[] = []

        // First pass: register all type and function names so forward references work.
        for (const stmt of this.ast.body) {
            if (stmt.kind === 'data-decl') {
                this.captureDiagnostic(() => {
                    this.registerDataDeclaration(stmt)
                    const annotated = this.annotateDataDeclaration(stmt)
                    types.push(annotated)
                    typeDeclarations.set(stmt, annotated)
                })
            }
            if (stmt.kind === 'func-decl') {
                this.captureDiagnostic(() => {
                    this.registerTopLevelFunctionDeclaration(stmt)
                })
            }
            if (stmt.kind === 'object-decl') {
                this.captureDiagnostic(() => {
                    this.registerTypeDeclaration('object', stmt)
                    this.registerMethodSignatures(
                        'object',
                        stmt.name,
                        stmt.sections,
                    )
                    objects.push(stmt)
                })
            }
            if (stmt.kind === 'service-decl') {
                this.captureDiagnostic(() => {
                    this.registerTypeDeclaration('service', stmt)
                    this.registerMethodSignatures(
                        'service',
                        stmt.name,
                        stmt.sections,
                    )
                    services.push(stmt)
                })
            }
        }

        for (const stmt of this.ast.body) {
            if (stmt.kind === 'data-decl') {
                const decl = typeDeclarations.get(stmt)
                if (decl) {
                    this.captureDiagnostic(() =>
                        this.validateDataFieldSemantics([decl]),
                    )
                }
                continue
            }

            if (stmt.kind === 'object-decl') {
                this.captureDiagnostic(() =>
                    this.validateTypeFieldSemantics([stmt], []),
                )
                this.captureDiagnostic(() =>
                    this.validateObjectHierarchies([stmt]),
                )
                continue
            }

            if (stmt.kind === 'service-decl') {
                this.captureDiagnostic(() =>
                    this.validateTypeFieldSemantics([], [stmt]),
                )
            }
        }

        // Second pass: analyze function bodies and module-level statements.
        const mainScopedAnalyzer = this.createChildScope()
        for (const stmt of this.ast.body) {
            if (stmt.kind === 'func-decl') {
                const analyzed = this.captureDiagnostic(() =>
                    this.analyzeFunctionDeclaration(stmt),
                )
                if (!analyzed) continue
                const labels = stmt.parameters.map(
                    (param) => param.label ?? '_',
                )
                userFunctions.push({
                    ...analyzed,
                    name: mangleCallableName(stmt.name, labels),
                })
                continue
            }
            if (stmt.kind === 'object-decl') {
                const analyzedMethods = this.captureDiagnostic(() =>
                    this.analyzeTypeMethods(stmt.name, 'object', stmt.sections),
                )
                if (analyzedMethods) typeMethods.push(...analyzedMethods)
                continue
            }
            if (stmt.kind === 'service-decl') {
                const analyzedMethods = this.captureDiagnostic(() =>
                    this.analyzeTypeMethods(
                        stmt.name,
                        'service',
                        stmt.sections,
                    ),
                )
                if (analyzedMethods) typeMethods.push(...analyzedMethods)
                continue
            }
            if (stmt.kind === 'data-decl') continue
            const analyzedStatement = this.captureDiagnostic(() =>
                mainScopedAnalyzer.analyzeStatement(stmt),
            )
            if (analyzedStatement) mainBody.push(analyzedStatement)
        }

        if (this.diagnostics.length > 0) {
            throw new CompilerDiagnosticsError([...this.diagnostics])
        }

        const mainFunction: SemanticFunction = {
            kind: 'function',
            name: 'main',
            parameters: [],
            body: mainBody,
        }

        return {
            imports: this.ast.imports.map((imp) => ({
                ...imp,
                items: imp.items.map((item) => ({ ...item })),
            })),
            functions: [mainFunction, ...userFunctions, ...typeMethods],
            types,
            objects,
            services,
            globals: [],
            typeKinds: this.typeKinds,
            functionSignatures: this.functionSignatures,
        }
    }

    private createChildScope(): SemanticAnalyzer {
        return new SemanticAnalyzer(
            this.ast,
            this,
            this.dataTypes,
            this.functionSignatures,
            this.typeKinds,
            this.objectSupertypes,
            this.inheritableObjects,
            this.loopDepth,
            this.currentFunctionReturnType,
            this.currentOwnerType,
            this.currentOwnerKind,
            this.currentMethodMutating,
            this.currentInheritanceInitializer,
            this.currentInheritanceSelfInitialized,
            this.currentFunctionEffectLevel,
            this.diagnostics,
        )
    }

    private createLoopChildScope(): SemanticAnalyzer {
        return new SemanticAnalyzer(
            this.ast,
            this,
            this.dataTypes,
            this.functionSignatures,
            this.typeKinds,
            this.objectSupertypes,
            this.inheritableObjects,
            this.loopDepth + 1,
            this.currentFunctionReturnType,
            this.currentOwnerType,
            this.currentOwnerKind,
            this.currentMethodMutating,
            this.currentInheritanceInitializer,
            this.currentInheritanceSelfInitialized,
            this.currentFunctionEffectLevel,
            this.diagnostics,
        )
    }

    private createFunctionChildScope(
        returnType?: string,
        ownerType?: string,
        ownerKind?: 'object' | 'service',
        methodMutating = false,
        inheritanceInitializer = false,
    ): SemanticAnalyzer {
        // For free functions, infer effect level; for methods, we already know it
        const inferEffect = ownerType ? null : ('pure' as EffectLevel)
        const inheritanceSelfInitialized = !inheritanceInitializer
        return new SemanticAnalyzer(
            this.ast,
            this,
            this.dataTypes,
            this.functionSignatures,
            this.typeKinds,
            this.objectSupertypes,
            this.inheritableObjects,
            0, // reset loop depth — break/continue inside a nested function is not the outer loop's
            returnType,
            ownerType,
            ownerKind,
            methodMutating,
            inheritanceInitializer,
            inheritanceSelfInitialized,
            inferEffect,
            this.diagnostics,
        )
    }

    private captureDiagnostic<T>(callback: () => T): T | undefined {
        try {
            return callback()
        } catch (error) {
            this.recordDiagnostic(error)
            return undefined
        }
    }

    private recordDiagnostic(error: unknown): void {
        if (error instanceof CompilerDiagnosticsError) {
            this.diagnostics.push(...error.diagnostics)
            return
        }

        if (error instanceof Error) {
            this.diagnostics.push(error.message)
            return
        }

        this.diagnostics.push(String(error))
    }

    private analyzeStatement(stmt: ASTStatement): SemanticStatement {
        switch (stmt.kind) {
            case 'data-decl':
                throw new Error('Unexpected data declaration in statement body')
            case 'func-decl':
                throw new Error(
                    'Unexpected function declaration in statement body',
                )
            case 'object-decl':
                throw new Error(
                    'Unexpected object declaration in statement body',
                )
            case 'service-decl':
                throw new Error(
                    'Unexpected service declaration in statement body',
                )
            case 'var-decl':
                return this.analyzeVariableDeclaration(stmt)
            case 'print':
                return this.analyzePrintStatement(stmt)
            case 'assign':
                return this.analyzeAssignment(stmt)
            case 'if':
                return this.analyzeIfStatement(stmt)
            case 'while':
                return this.analyzeWhileStatement(stmt)
            case 'for-in':
                return this.analyzeForInStatement(stmt)
            case 'break':
                return this.analyzeBreakStatement(stmt)
            case 'continue':
                return this.analyzeContinueStatement(stmt)
            case 'return':
                return this.analyzeReturnStatement(stmt)
            default:
                return stmt
        }
    }

    private analyzeReturnStatement(
        stmt: ASTReturnStatement,
    ): SemanticReturnStatement {
        if (this.currentInheritanceInitializer && stmt.value !== undefined) {
            throw new Error(
                `${posStr(stmt.position)}:Inheritance initializer methods do not return values; assign to 'self' instead`,
            )
        }

        if (stmt.value === undefined) {
            if (this.currentFunctionReturnType !== undefined) {
                throw new Error(
                    `${posStr(stmt.position)}:Return statement requires a value of type '${this.currentFunctionReturnType}'`,
                )
            }

            return { kind: 'return', position: stmt.position }
        }

        // Validate the return expression first so specific diagnostics like
        // unknown identifiers surface before the enclosing function contract.
        const returnType = this.inferExpressionType(stmt.value)

        if (this.currentFunctionReturnType === undefined) {
            throw new Error(
                `${posStr(stmt.position)}:Cannot return a value from a function without a return type annotation`,
            )
        }

        // Now validate data literal fields if this is a data literal
        if (stmt.value.kind === 'data-literal') {
            this.validateDataLiteral(
                stmt.value as ASTDataLiteral,
                this.currentFunctionReturnType,
            )
        } else if (stmt.value.kind === 'array-literal') {
            this.validateArrayLiteral(
                stmt.value,
                this.currentFunctionReturnType,
            )
        }

        if (
            returnType &&
            !this.isTypeAssignable(returnType, this.currentFunctionReturnType)
        ) {
            throw new Error(
                `${posStr(stmt.position)}:Return type mismatch: expected '${this.currentFunctionReturnType}' but got '${returnType}'`,
            )
        }

        return {
            kind: 'return',
            value: this.rewriteExpression(stmt.value),
            position: stmt.position,
        }
    }

    private analyzeIfStatement(
        stmt: Extract<ASTStatement, { kind: 'if' }>,
    ): SemanticStatement {
        this.assertTruthvalueCondition(stmt.condition, stmt.position, 'if')

        const thenAnalyzer = this.createChildScope()
        const thenBranch: SemanticStatement[] = []
        for (const child of stmt.thenBranch) {
            const analyzed = thenAnalyzer.captureDiagnostic(() =>
                thenAnalyzer.analyzeStatement(child),
            )
            if (analyzed) thenBranch.push(analyzed)
        }

        let elseAnalyzer: SemanticAnalyzer | undefined
        const elseBranch = stmt.elseBranch
            ? (() => {
                  elseAnalyzer = this.createChildScope()
                  const analyzedElseBranch: SemanticStatement[] = []
                  for (const child of stmt.elseBranch) {
                      const analyzed = elseAnalyzer!.captureDiagnostic(() =>
                          elseAnalyzer!.analyzeStatement(child),
                      )
                      if (analyzed) analyzedElseBranch.push(analyzed)
                  }
                  return analyzedElseBranch
              })()
            : undefined

        this.mergeInheritanceInitializationAfterIf(
            thenAnalyzer,
            elseAnalyzer,
            Boolean(elseBranch),
        )

        return {
            kind: 'if',
            condition: this.rewriteExpression(stmt.condition),
            thenBranch,
            elseBranch,
            position: stmt.position,
        }
    }

    private mergeInheritanceInitializationAfterIf(
        thenAnalyzer: SemanticAnalyzer,
        elseAnalyzer: SemanticAnalyzer | undefined,
        hasElseBranch: boolean,
    ): void {
        if (!this.currentInheritanceInitializer) return
        if (this.currentInheritanceSelfInitialized) return

        this.currentInheritanceSelfInitialized =
            hasElseBranch &&
            thenAnalyzer.currentInheritanceSelfInitialized &&
            Boolean(elseAnalyzer?.currentInheritanceSelfInitialized)
    }

    private analyzeWhileStatement(
        stmt: Extract<ASTStatement, { kind: 'while' }>,
    ): SemanticStatement {
        this.assertTruthvalueCondition(stmt.condition, stmt.position, 'while')

        const loopAnalyzer = this.createLoopChildScope()
        const body: SemanticStatement[] = []
        for (const child of stmt.body) {
            const analyzed = loopAnalyzer.captureDiagnostic(() =>
                loopAnalyzer.analyzeStatement(child),
            )
            if (analyzed) body.push(analyzed)
        }

        return {
            kind: 'while',
            condition: this.rewriteExpression(stmt.condition),
            body,
            position: stmt.position,
        }
    }

    private analyzeForInStatement(
        stmt: Extract<ASTStatement, { kind: 'for-in' }>,
    ): SemanticStatement {
        const iterableType = this.inferExpressionType(stmt.iterable)
        if (!iterableType) {
            throw new Error(
                `${posStr(stmt.position)}:Cannot infer type for for-in iterable`,
            )
        }

        if (!this.isArrayType(iterableType)) {
            throw new Error(
                `${posStr(stmt.position)}:for-in iterable must be array, got '${iterableType}'`,
            )
        }

        const elementType = this.arrayElementType(iterableType)
        if (!elementType) {
            throw new Error(
                `${posStr(stmt.position)}:Cannot resolve array element type from '${iterableType}'`,
            )
        }

        const loopAnalyzer = this.createLoopChildScope()
        loopAnalyzer.declareBinding(
            stmt.loopVar,
            {
                type: elementType,
                semantics: 'const',
            },
            stmt.position,
        )

        const body: SemanticStatement[] = []
        for (const child of stmt.body) {
            const analyzed = loopAnalyzer.captureDiagnostic(() =>
                loopAnalyzer.analyzeStatement(child),
            )
            if (analyzed) body.push(analyzed)
        }

        return {
            kind: 'for-in',
            loopVar: stmt.loopVar,
            iterable: this.rewriteExpression(stmt.iterable),
            elementType,
            body,
            position: stmt.position,
        }
    }

    private analyzeBreakStatement(
        stmt: Extract<ASTStatement, { kind: 'break' }>,
    ): SemanticStatement {
        if (this.loopDepth <= 0) {
            throw new Error(
                `${posStr(stmt.position)}:break is only allowed inside a while loop`,
            )
        }

        return stmt
    }

    private analyzeContinueStatement(
        stmt: Extract<ASTStatement, { kind: 'continue' }>,
    ): SemanticStatement {
        if (this.loopDepth <= 0) {
            throw new Error(
                `${posStr(stmt.position)}:continue is only allowed inside a while loop`,
            )
        }

        return stmt
    }

    private assertTruthvalueCondition(
        condition: ASTExpression,
        position: { line: number; column: number },
        keyword: 'if' | 'while',
    ): void {
        const conditionType = this.inferExpressionType(condition)
        if (conditionType !== 'truthvalue') {
            throw new Error(
                `${posStr(position)}:${keyword} condition must be truthvalue, got '${conditionType ?? condition.kind}'`,
            )
        }
    }

    private analyzePrintStatement(
        stmt: Extract<ASTStatement, { kind: 'print' }>,
    ): SemanticPrintStatement {
        if (this.currentOwnerKind === 'object') {
            throw new Error(
                `${posStr(stmt.position)}:Object methods may not perform external side-effects (print)`,
            )
        }

        // Mark free functions as external if they contain print
        if (this.currentFunctionEffectLevel !== null) {
            this.currentFunctionEffectLevel = 'external'
        }

        const dispatchType = this.inferExpressionType(stmt.value)
        if (!dispatchType) {
            throw new Error(
                `${posStr(stmt.position)}:Cannot infer print dispatch type from '${stmt.value.kind}'`,
            )
        }

        return {
            ...stmt,
            value: this.rewriteExpression(stmt.value),
            dispatchType,
        }
    }

    private analyzeAssignment(stmt: ASTAssignment): SemanticAssignment {
        if (!this.isAssignableTarget(stmt.target)) {
            throw new Error(
                `${posStr(stmt.position)}:Invalid assignment target kind '${stmt.target.kind}'`,
            )
        }

        this.validateMethodAssignmentRules(stmt.target, stmt.position)
        this.validateAssignmentMutationSemantics(stmt.target)

        const isSelfInitializationAssignment =
            this.isInheritanceSelfInitializationAssignment(stmt)

        if (
            this.currentInheritanceInitializer &&
            stmt.target.kind === 'identifier' &&
            stmt.target.name === 'self' &&
            stmt.value.kind !== 'data-literal'
        ) {
            throw new Error(
                `${posStr(stmt.position)}:Inheritance initializer must initialize 'self' with a data literal before using it`,
            )
        }

        const targetType = isSelfInitializationAssignment
            ? (this.lookupBinding('self')?.type ?? null)
            : this.inferExpressionType(stmt.target)
        const valueType =
            stmt.value.kind === 'data-literal'
                ? targetType
                : this.inferExpressionType(stmt.value)
        const targetSemantics = this.inferExpressionSemantics(stmt.target)
        const valueSemantics = this.inferExpressionSemantics(stmt.value)

        if (!targetType) {
            throw new Error(
                `${posStr(stmt.position)}:Cannot infer type for assignment target '${stmt.target.kind}'`,
            )
        }

        if (!valueType) {
            throw new Error(
                `${posStr(stmt.position)}:Cannot infer type for assignment value '${stmt.value.kind}'`,
            )
        }

        if (stmt.value.kind === 'data-literal') {
            this.validateDataLiteral(stmt.value, targetType)
        }

        if (!this.isTypeAssignable(valueType, targetType)) {
            throw new Error(
                `${posStr(stmt.position)}:Assignment type mismatch: target is '${targetType}' but value is '${valueType}'`,
            )
        }

        const rewrittenTarget = this.rewriteExpression(stmt.target)
        const rewrittenValue = this.rewriteExpression(stmt.value)

        this.validateSemanticBoundary(
            targetType,
            targetSemantics,
            valueSemantics,
            rewrittenValue,
            stmt.position,
        )

        if (isSelfInitializationAssignment) {
            this.currentInheritanceSelfInitialized = true
        }

        return {
            kind: 'assign',
            target: rewrittenTarget,
            value: rewrittenValue,
            ownership: this.buildAssignmentOwnership(
                rewrittenTarget,
                rewrittenValue,
                targetType,
                targetSemantics,
                valueSemantics,
            ),
            position: stmt.position,
        }
    }

    private buildAssignmentOwnership(
        target: SemanticAssignment['target'],
        value: SemanticAssignment['value'],
        targetType: string,
        targetSemantics: ASTVariableDeclaration['semantics'] | null,
        valueSemantics: ASTVariableDeclaration['semantics'] | null,
    ): SemanticOwnershipEffects {
        if (target.kind === 'field-access') {
            const ownership: SemanticOwnershipEffects = {
                mutates: this.collectMutateTargets(target),
            }

            if (
                this.isReferenceType(targetType) &&
                this.isCopyExpression(value)
            ) {
                ownership.copyValueSemantics =
                    this.toRuntimeSemanticsFlag(targetSemantics)
            }

            return ownership
        }

        if (target.kind === 'identifier' && this.isReferenceType(targetType)) {
            if (value.kind === 'data-literal') {
                return {}
            }

            if (this.isCopyExpression(value)) {
                return {
                    releases: [target],
                    copyValueSemantics:
                        this.toRuntimeSemanticsFlag(targetSemantics),
                }
            }

            return {
                retains: [value],
                releases: [target],
            }
        }

        return {}
    }

    private isAssignableTarget(target: ASTExpression): boolean {
        return (
            target.kind === 'identifier' ||
            (target.kind === 'binary' &&
                (target.operator === '.' || target.operator === '[]'))
        )
    }

    private isInheritanceSelfInitializationAssignment(
        stmt: ASTAssignment,
    ): boolean {
        return (
            this.currentInheritanceInitializer &&
            stmt.target.kind === 'identifier' &&
            stmt.target.name === 'self' &&
            stmt.value.kind === 'data-literal'
        )
    }

    private assertSelfReadable(identifier: ASTIdentifier): void {
        if (!this.currentInheritanceInitializer) return
        if (this.currentInheritanceSelfInitialized) return
        if (identifier.name !== 'self') return

        throw new Error(
            `${posStr(identifier.position)}:Cannot use 'self' before it is initialized; assign to 'self' with a data literal first`,
        )
    }

    private rewriteExpression(expr: ASTExpression): SemanticExpression {
        if (expr.kind === 'when') {
            return {
                kind: 'when',
                subject: this.rewriteExpression(expr.subject),
                branches: expr.branches.map((branch) => ({
                    pattern:
                        branch.pattern.kind === 'wildcard-pattern'
                            ? branch.pattern
                            : {
                                  kind: 'value-pattern' as const,
                                  value: this.rewriteExpression(
                                      branch.pattern.value,
                                  ),
                                  position: branch.pattern.position,
                              },
                    value: this.rewriteExpression(branch.value),
                })),
                position: expr.position,
            }
        }

        if (expr.kind === 'array-literal') {
            return {
                kind: 'array-literal',
                elements: expr.elements.map((element) =>
                    this.rewriteExpression(element),
                ),
                position: expr.position,
            }
        }

        if (expr.kind === 'copy') {
            return {
                ...expr,
                value: this.rewriteExpression(expr.value),
            }
        }

        if (expr.kind === 'call') {
            if (
                expr.callee.kind === 'binary' &&
                expr.callee.operator === '.' &&
                expr.callee.right.kind === 'identifier'
            ) {
                const receiverType = this.inferExpressionType(expr.callee.left)
                if (!receiverType) {
                    throw new Error(
                        `${posStr(expr.callee.position)}:Cannot infer type for method call receiver`,
                    )
                }

                const signature = this.resolveMethodSignature(
                    receiverType,
                    expr.callee.right.name,
                    expr.arguments.map((arg) => arg.label ?? '_'),
                )
                if (!signature) {
                    throw new Error(
                        `${posStr(expr.position)}:Function/method not found '${renderFunctionSignature(
                            expr.callee.right.name,
                            expr.arguments.map((arg) => arg.label ?? '_'),
                            receiverType,
                        )}'`,
                    )
                }

                return {
                    kind: 'call',
                    callee: {
                        kind: 'identifier',
                        name: `${signature.ownerType ?? receiverType}·${expr.callee.right.name}`,
                        position: expr.callee.right.position,
                    },
                    arguments: [
                        {
                            value: this.rewriteExpression(expr.callee.left),
                        },
                        ...expr.arguments.map((arg) => ({
                            label: arg.label,
                            value: this.rewriteExpression(arg.value),
                        })),
                    ],
                    dispatch: this.buildCallDispatch(
                        signature,
                        expr.callee.right.name,
                        expr.arguments.map((arg) => arg.label ?? '_'),
                        receiverType,
                    ),
                    position: expr.position,
                }
            }

            return {
                kind: 'call',
                callee: this.rewriteExpression(expr.callee),
                arguments: expr.arguments.map((arg) => ({
                    label: arg.label,
                    value: this.rewriteExpression(arg.value),
                })),
                dispatch: { kind: 'direct' },
                position: expr.position,
            }
        }

        if (expr.kind !== 'binary') return expr

        if (expr.operator === '[]') {
            const arrayType = this.inferExpressionType(expr.left)
            if (!arrayType || !this.isArrayType(arrayType)) {
                throw new Error(
                    `${posStr(expr.position)}:Indexing expects an array value, got '${arrayType ?? expr.left.kind}'`,
                )
            }

            const indexType = this.inferExpressionType(expr.right)
            if (indexType !== 'integer') {
                throw new Error(
                    `${posStr(expr.position)}:Array index must be integer, got '${indexType ?? expr.right.kind}'`,
                )
            }

            const elementType = this.arrayElementType(arrayType)
            if (!elementType) {
                throw new Error(
                    `${posStr(expr.position)}:Invalid array type '${arrayType}'`,
                )
            }

            return {
                kind: 'array-index',
                array: this.rewriteExpression(expr.left),
                index: this.rewriteExpression(expr.right),
                elementType,
                position: expr.position,
            }
        }

        if (expr.operator === '+') {
            const leftType = this.inferExpressionType(expr.left)
            const rightType = this.inferExpressionType(expr.right)
            const operator =
                leftType === 'integer' && rightType === 'integer'
                    ? 'integer-add'
                    : '+'
            return {
                kind: 'binary',
                operator,
                left: this.rewriteExpression(expr.left),
                right: this.rewriteExpression(expr.right),
                position: expr.position,
            }
        }

        if (
            expr.operator === '-' ||
            expr.operator === '*' ||
            expr.operator === '/'
        ) {
            const opMap: Record<string, string> = {
                '-': 'integer-sub',
                '*': 'integer-mul',
                '/': 'integer-div',
            }
            return {
                kind: 'binary',
                operator: opMap[expr.operator],
                left: this.rewriteExpression(expr.left),
                right: this.rewriteExpression(expr.right),
                position: expr.position,
            }
        }

        if (expr.operator === '==' || expr.operator === '!=') {
            const leftType = this.inferExpressionType(expr.left)
            const opPrefix =
                leftType === 'integer'
                    ? 'integer'
                    : leftType === 'string'
                      ? 'string'
                      : 'truthvalue'
            const opSuffix = expr.operator === '==' ? 'eq' : 'ne'
            return {
                kind: 'binary',
                operator: `${opPrefix}-${opSuffix}`,
                left: this.rewriteExpression(expr.left),
                right: this.rewriteExpression(expr.right),
                position: expr.position,
            }
        }

        if (
            expr.operator === '<' ||
            expr.operator === '<=' ||
            expr.operator === '>' ||
            expr.operator === '>='
        ) {
            const opMap: Record<string, string> = {
                '<': 'integer-lt',
                '<=': 'integer-le',
                '>': 'integer-gt',
                '>=': 'integer-ge',
            }
            return {
                kind: 'binary',
                operator: opMap[expr.operator],
                left: this.rewriteExpression(expr.left),
                right: this.rewriteExpression(expr.right),
                position: expr.position,
            }
        }

        if (expr.operator === '&&' || expr.operator === '||') {
            const op =
                expr.operator === '&&' ? 'truthvalue-and' : 'truthvalue-or'
            return {
                kind: 'binary',
                operator: op,
                left: this.rewriteExpression(expr.left),
                right: this.rewriteExpression(expr.right),
                position: expr.position,
            }
        }

        if (expr.operator !== '.') {
            throw new Error(
                `${posStr(expr.position)}:Unsupported binary operator '${expr.operator}'`,
            )
        }
        if (expr.right.kind !== 'identifier') {
            throw new Error(
                `${posStr(expr.right.position)}:Field name must be an identifier`,
            )
        }
        return {
            kind: 'field-access',
            object: this.rewriteExpression(expr.left),
            field: expr.right.name,
            position: expr.position,
        }
    }

    private analyzeFunctionDeclaration(
        stmt: ASTFunctionDeclaration,
    ): SemanticFunction {
        const isInheritanceInitializer =
            this.isInheritanceInitializerFunction(stmt)
        this.validateSelfParameterRestrictions(stmt)
        this.validateMethodDeclarationRules(stmt, isInheritanceInitializer)
        this.validateServiceFunctionRestrictions(stmt)
        this.validateInheritanceInitializerDeclarationRules(
            stmt,
            isInheritanceInitializer,
        )

        const bodyAnalyzer = this.createFunctionChildScope(
            stmt.returnType,
            this.currentOwnerType,
            this.currentOwnerKind,
            this.currentMethodMutating,
            isInheritanceInitializer,
        )

        // Inject parameters as bindings in the function scope.
        if (this.currentOwnerType) {
            bodyAnalyzer.bindings.set('self', {
                type: this.currentOwnerType,
                semantics: this.currentMethodMutating ? 'mut' : 'const',
                declarationPosition: stmt.position,
            })
        }

        for (const param of stmt.parameters) {
            bodyAnalyzer.bindings.set(param.name, {
                type: param.type,
                semantics: param.semantics ?? 'const',
                declarationPosition: param.position,
            })
        }

        const body = this.analyzeFunctionBody(stmt, bodyAnalyzer)

        // Update function signature with inferred effect level for free functions
        if (
            !this.currentOwnerType &&
            bodyAnalyzer.currentFunctionEffectLevel !== null
        ) {
            const labels = stmt.parameters.map((param) => param.label ?? '_')
            const key = buildFunctionSignatureKey(stmt.name, labels)
            const signature = this.functionSignatures.get(key)
            if (signature) {
                signature.effectLevel = bodyAnalyzer.currentFunctionEffectLevel
            }
        }

        return {
            kind: 'function',
            name: stmt.name,
            parameters: stmt.parameters,
            returnType: stmt.returnType,
            returnSemantics: stmt.returnSemantics,
            body,
        }
    }

    private registerTopLevelFunctionDeclaration(
        stmt: ASTFunctionDeclaration,
    ): void {
        const labels = stmt.parameters.map((param) => param.label ?? '_')
        this.assertFunctionSignatureAvailable(stmt.name, labels, stmt.position)

        this.bindings.set(stmt.name, {
            type: 'func',
            semantics: 'const',
            declarationPosition: stmt.position,
        })

        this.functionSignatures.set(
            buildFunctionSignatureKey(stmt.name, labels),
            {
                name: stmt.name,
                visibility: stmt.visibility,
                labels,
                returnType: stmt.returnType,
                returnSemantics: stmt.returnSemantics,
                arity: stmt.parameters.length,
                parameterTypes: stmt.parameters.map((param) => param.type),
                parameterSemantics: stmt.parameters.map(
                    (param) => param.semantics ?? 'const',
                ),
                effectLevel: 'external',
                isInheritanceInitializer: false,
            },
        )
    }

    private validateMethodDeclarationRules(
        stmt: ASTFunctionDeclaration,
        isInheritanceInitializer: boolean,
    ): void {
        if (!this.currentOwnerType) return
        if (isInheritanceInitializer) return
        if (this.currentMethodMutating) return
        if (stmt.returnType !== undefined) return

        throw new Error(
            `${posStr(stmt.position)}:Immutable method '${this.currentOwnerType}.${stmt.name}' must declare a return type`,
        )
    }

    private validateInheritanceInitializerDeclarationRules(
        stmt: ASTFunctionDeclaration,
        isInheritanceInitializer: boolean,
    ): void {
        if (!isInheritanceInitializer) return
        if (stmt.returnType === undefined) return

        throw new Error(
            `${posStr(stmt.position)}:Inheritance initializer '${this.currentOwnerType}.${stmt.name}' must not declare a return type`,
        )
    }

    private isInheritanceInitializerFunction(
        stmt: ASTFunctionDeclaration,
    ): boolean {
        if (!this.currentOwnerType) return false
        const labels = stmt.parameters.map((param) => param.label ?? '_')
        const signature = this.lookupFunctionSignature(
            buildFunctionSignatureKey(stmt.name, labels, this.currentOwnerType),
        )
        return signature?.isInheritanceInitializer ?? false
    }

    private validateSelfParameterRestrictions(
        stmt: ASTFunctionDeclaration,
    ): void {
        const selfParameter = stmt.parameters.find(
            (param) => param.name === 'self' || param.label === 'self',
        )
        if (!selfParameter) return

        throw new Error(
            `${posStr(selfParameter.position)}:Parameter name 'self' is reserved for the implicit receiver and may not be declared explicitly`,
        )
    }

    private analyzeFunctionBody(
        stmt: ASTFunctionDeclaration,
        bodyAnalyzer: SemanticAnalyzer,
    ): SemanticStatement[] {
        if (stmt.body.kind === 'block') {
            const body: SemanticStatement[] = []
            for (const statement of stmt.body.statements) {
                const analyzed = bodyAnalyzer.captureDiagnostic(() =>
                    bodyAnalyzer.analyzeStatement(statement),
                )
                if (analyzed) body.push(analyzed)
            }
            return body
        }

        if (bodyAnalyzer.currentInheritanceInitializer) {
            if (stmt.body.value.kind !== 'data-literal') {
                throw new Error(
                    `${posStr(stmt.position)}:Inheritance initializer shorthand body must be a data literal assigned to self`,
                )
            }

            return [
                bodyAnalyzer.analyzeAssignment({
                    kind: 'assign',
                    target: {
                        kind: 'identifier',
                        name: 'self',
                        position: stmt.body.value.position,
                    },
                    value: stmt.body.value,
                    position: stmt.body.value.position,
                }),
            ]
        }

        // Shorthand `=> expr` body: treat as a single implicit return.
        if (stmt.returnType === undefined) {
            throw new Error(
                `${posStr(stmt.position)}:Shorthand body '=> expr' requires a return type annotation on function '${stmt.name}'`,
            )
        }

        return [
            bodyAnalyzer.analyzeReturnStatement({
                kind: 'return',
                value: stmt.body.value,
                position: stmt.body.value.position,
            }),
        ]
    }

    private registerTypeDeclaration(
        typeKind: 'object' | 'service',
        stmt: ASTObjectDeclaration | ASTServiceDeclaration,
    ) {
        this.assertTypeNameAvailable(stmt.name, stmt.position)

        const dataSection = stmt.sections.find(
            (section): section is Extract<typeof section, { kind: 'data' }> =>
                section.kind === 'data',
        )
        const fields = new Map(
            (dataSection?.fields ?? []).map((field) => [
                field.name,
                {
                    type: field.type,
                    semantics: field.semantics ?? 'mut',
                    declarationPosition: field.position,
                },
            ]),
        )

        // Register the type name so it can be used in variable declarations,
        // literals, and field accesses.
        this.dataTypes.set(stmt.name, fields)
        this.typeKinds.set(stmt.name, typeKind)

        if (
            typeKind === 'object' &&
            stmt.kind === 'object-decl' &&
            stmt.sections.some((section) => section.kind === 'inheritance')
        ) {
            this.inheritableObjects.add(stmt.name)
        }

        if (
            typeKind === 'object' &&
            stmt.kind === 'object-decl' &&
            stmt.supertype
        ) {
            this.objectSupertypes.set(stmt.name, stmt.supertype)
        }
    }

    private validateObjectHierarchies(objects: ASTObjectDeclaration[]): void {
        for (const objectDecl of objects) {
            this.validateDeclaredSupertype(objectDecl)
        }

        for (const objectDecl of objects) {
            this.validateInheritanceCycle(objectDecl)
            this.validateMethodOverrides(objectDecl)
        }
    }

    private validateDeclaredSupertype(objectDecl: ASTObjectDeclaration): void {
        if (!objectDecl.supertype) return

        const supertypeKind = this.lookupTypeKind(objectDecl.supertype)
        if (!supertypeKind) {
            const pos = objectDecl.supertypePosition ?? objectDecl.position
            throw new Error(
                `${posStr(pos)}:Unknown supertype '${objectDecl.supertype}' for object '${objectDecl.name}'`,
            )
        }

        if (supertypeKind !== 'object') {
            throw new Error(
                `${posStr(objectDecl.position)}:Object '${objectDecl.name}' cannot inherit from non-object type '${objectDecl.supertype}'`,
            )
        }

        if (!this.inheritableObjects.has(objectDecl.supertype)) {
            const pos = objectDecl.supertypePosition ?? objectDecl.position
            throw new Error(
                `${posStr(pos)}:Object '${objectDecl.name}' cannot inherit from '${objectDecl.supertype}' because it has no inheritance section`,
            )
        }
    }

    private validateInheritanceCycle(objectDecl: ASTObjectDeclaration): void {
        const seen = new Set<string>()
        let current: string | undefined = objectDecl.name

        while (current) {
            if (seen.has(current)) {
                throw new Error(
                    `${posStr(objectDecl.position)}:Cyclic inheritance involving '${objectDecl.name}'`,
                )
            }

            seen.add(current)
            current = this.lookupObjectSupertype(current)
        }
    }

    private validateMethodOverrides(objectDecl: ASTObjectDeclaration): void {
        for (const section of objectDecl.sections) {
            if (
                section.kind !== 'methods' &&
                section.kind !== 'mutating' &&
                section.kind !== 'inheritance'
            ) {
                continue
            }

            for (const method of section.items) {
                const callableParams =
                    method.parameters[0]?.name === 'self'
                        ? method.parameters.slice(1)
                        : method.parameters
                const labels = callableParams.map((param) => param.label ?? '_')
                const baseSignature = this.lookupInheritedMethodSignature(
                    objectDecl.supertype,
                    method.name,
                    labels,
                )

                if (!baseSignature) continue

                const overrideName = renderFunctionSignature(
                    method.name,
                    labels,
                    objectDecl.name,
                )
                const overrideEffectLevel = this.methodEffectLevel(
                    'object',
                    section.kind,
                )

                if (method.returnType !== baseSignature.returnType) {
                    throw new Error(
                        `${posStr(method.position)}:Override '${overrideName}' must match return type '${baseSignature.returnType ?? 'void'}', got '${method.returnType ?? 'void'}'`,
                    )
                }

                if (method.returnSemantics !== baseSignature.returnSemantics) {
                    throw new Error(
                        `${posStr(method.position)}:Override '${overrideName}' must match return semantics '${baseSignature.returnSemantics ?? 'unique'}', got '${method.returnSemantics ?? 'unique'}'`,
                    )
                }

                if (
                    callableParams.length !==
                        baseSignature.parameterTypes.length ||
                    callableParams.some(
                        (param, index) =>
                            param.type !== baseSignature.parameterTypes[index],
                    )
                ) {
                    throw new Error(
                        `${posStr(method.position)}:Override '${overrideName}' must match parameter types of inherited method`,
                    )
                }

                if (
                    callableParams.some(
                        (param, index) =>
                            (param.semantics ?? 'const') !==
                            baseSignature.parameterSemantics[index],
                    )
                ) {
                    throw new Error(
                        `${posStr(method.position)}:Override '${overrideName}' must match parameter semantics of inherited method`,
                    )
                }

                if (method.visibility !== baseSignature.visibility) {
                    throw new Error(
                        `${posStr(method.position)}:Override '${overrideName}' must keep visibility '${baseSignature.visibility}'`,
                    )
                }

                if (overrideEffectLevel !== baseSignature.effectLevel) {
                    throw new Error(
                        `${posStr(method.position)}:Override '${overrideName}' must match effect level '${baseSignature.effectLevel}', got '${overrideEffectLevel}'`,
                    )
                }
            }
        }
    }

    private registerMethodSignatures(
        ownerKind: 'object' | 'service',
        ownerType: string,
        sections: ASTObjectDeclaration['sections'],
    ) {
        for (const section of sections) {
            if (
                section.kind !== 'methods' &&
                section.kind !== 'mutating' &&
                section.kind !== 'inheritance'
            ) {
                continue
            }

            for (const method of section.items) {
                const callableParams =
                    method.parameters[0]?.name === 'self'
                        ? method.parameters.slice(1)
                        : method.parameters
                const labels = callableParams.map((param) => param.label ?? '_')
                this.assertFunctionSignatureAvailable(
                    method.name,
                    labels,
                    method.position,
                    ownerType,
                )

                this.functionSignatures.set(
                    buildFunctionSignatureKey(method.name, labels, ownerType),
                    {
                        name: method.name,
                        ownerType,
                        ownerKind,
                        visibility: method.visibility,
                        labels,
                        returnType: method.returnType,
                        returnSemantics: method.returnSemantics,
                        arity: callableParams.length,
                        parameterTypes: callableParams.map(
                            (param) => param.type,
                        ),
                        parameterSemantics: callableParams.map(
                            (param) => param.semantics ?? 'const',
                        ),
                        effectLevel: this.methodEffectLevel(
                            ownerKind,
                            section.kind,
                        ),
                        isInheritanceInitializer:
                            section.kind === 'inheritance',
                    },
                )
            }
        }
    }

    private analyzeTypeMethods(
        ownerType: string,
        ownerKind: 'object' | 'service',
        sections: ASTObjectDeclaration['sections'],
    ): SemanticFunction[] {
        const methods: SemanticFunction[] = []
        for (const section of sections) {
            if (
                section.kind !== 'methods' &&
                section.kind !== 'mutating' &&
                section.kind !== 'inheritance'
            ) {
                continue
            }

            for (const method of section.items) {
                const methodAnalyzer = this.createFunctionChildScope(
                    method.returnType,
                    ownerType,
                    ownerKind,
                    section.kind !== 'methods',
                    section.kind === 'inheritance',
                )
                const analyzed =
                    methodAnalyzer.analyzeFunctionDeclaration(method)
                const receiverParameter = {
                    name: 'self',
                    type: ownerType,
                    semantics:
                        section.kind === 'methods'
                            ? ('const' as const)
                            : ('ref' as const),
                    position: method.position,
                }
                const callableParams =
                    method.parameters[0]?.name === 'self'
                        ? method.parameters.slice(1)
                        : method.parameters
                const labels = callableParams.map((param) => param.label ?? '_')
                methods.push({
                    ...analyzed,
                    name: `${ownerType}·${mangleCallableName(method.name, labels)}`,
                    parameters: [receiverParameter, ...analyzed.parameters],
                })
            }
        }
        return methods
    }

    private validateMethodAssignmentRules(
        target: ASTExpression,
        position: { line: number; column: number },
    ): void {
        if (!this.currentOwnerType) return

        if (
            !this.currentMethodMutating &&
            target.kind === 'binary' &&
            target.operator === '.'
        ) {
            throw new Error(
                `${posStr(position)}:Immutable method '${this.currentOwnerType}' may not assign to a field`,
            )
        }

        if (this.currentOwnerKind !== 'object') return

        const root = this.extractRootIdentifier(target)
        if (
            target.kind === 'binary' &&
            target.operator === '.' &&
            root &&
            root.name !== 'self'
        ) {
            throw new Error(
                `${posStr(position)}:Object methods may not mutate external state via '${root.name}'`,
            )
        }
    }

    private validateCallEffects(
        signature: FunctionSignature,
        position: { line: number; column: number },
        callable: { name: string; labels: string[]; ownerType?: string },
    ): void {
        const allowed = this.allowedEffectLevel()
        if (!isEffectLevelAllowed(signature.effectLevel, allowed)) {
            throw new Error(
                `${posStr(position)}:Call to '${renderFunctionSignature(callable.name, callable.labels, callable.ownerType)}' is side-effecting (${signature.effectLevel}) and is not allowed in this method context (${allowed})`,
            )
        }
    }

    private allowedEffectLevel(): EffectLevel {
        if (this.currentOwnerKind === 'service') return 'external'
        if (this.currentOwnerKind === 'object') {
            return this.currentMethodMutating ? 'self-mutation' : 'pure'
        }
        return 'external'
    }

    private methodEffectLevel(
        ownerKind: 'object' | 'service',
        sectionKind: 'methods' | 'mutating' | 'inheritance',
    ): EffectLevel {
        if (ownerKind === 'service') return 'external'
        return sectionKind === 'methods' ? 'pure' : 'self-mutation'
    }

    private buildCallDispatch(
        signature: FunctionSignature,
        methodName: string,
        labels: string[],
        receiverType: string,
    ): {
        kind: 'direct' | 'virtual'
        methodName?: string
        slotName?: string
        ownerType?: string
        receiverType?: string
    } {
        const slotName = mangleCallableName(methodName, labels)
        if (
            signature.ownerKind === 'object' &&
            signature.visibility === 'public'
        ) {
            return {
                kind: 'virtual',
                methodName,
                slotName,
                ownerType: signature.ownerType,
                receiverType,
            }
        }

        return {
            kind: 'direct',
            methodName,
            slotName,
            ownerType: signature.ownerType,
            receiverType,
        }
    }

    private registerDataDeclaration(stmt: ASTDataDeclaration) {
        this.assertTypeNameAvailable(stmt.name, stmt.position)
        this.typeKinds.set(stmt.name, 'data')
        this.dataTypes.set(
            stmt.name,
            new Map(
                stmt.fields.map((field) => [
                    field.name,
                    {
                        type: field.type,
                        semantics: field.semantics ?? 'mut',
                        declarationPosition: field.position,
                    },
                ]),
            ),
        )
    }

    private assertTypeNameAvailable(
        name: string,
        position: { file?: string; line: number; column: number },
    ): void {
        if (!this.lookupTypeKind(name)) return

        throw new Error(
            `${posStr(position)}:Type '${name}' is already declared`,
        )
    }

    private assertFunctionSignatureAvailable(
        name: string,
        labels: string[],
        position: { file?: string; line: number; column: number },
        ownerType?: string,
    ): void {
        const signatureKey = buildFunctionSignatureKey(name, labels, ownerType)
        if (!this.lookupFunctionSignature(signatureKey)) return

        throw new Error(
            `${posStr(position)}:Function '${renderFunctionSignature(name, labels, ownerType)}' is already declared`,
        )
    }

    private annotateDataDeclaration(
        stmt: ASTDataDeclaration,
    ): SemanticDataDeclaration {
        return {
            ...stmt,
            fields: stmt.fields.map((field) => ({
                ...field,
                isReferenceCounted: this.dataTypes.has(field.type),
            })),
        }
    }

    private lookupDataType(name: string): BindingMap | undefined {
        const dataType = this.dataTypes.get(name)
        if (dataType || !this.parent) return dataType
        return this.parent.lookupDataType(name)
    }

    private lookupTypeKind(name: string): TypeKind | undefined {
        const typeKind = this.typeKinds.get(name)
        if (typeKind || !this.parent) return typeKind
        return this.parent.lookupTypeKind(name)
    }

    private lookupObjectSupertype(name: string): string | undefined {
        const supertype = this.objectSupertypes.get(name)
        if (supertype || !this.parent) return supertype
        return this.parent.lookupObjectSupertype(name)
    }

    private validateDataFieldSemantics(
        declarations: SemanticDataDeclaration[],
    ): void {
        for (const decl of declarations) {
            for (const field of decl.fields) {
                const semantics = field.semantics ?? 'mut'

                if (semantics === 'const') {
                    throw new Error(
                        `${posStr(decl.position)}:Field '${field.name}' in data type '${decl.name}' cannot use 'const' semantics`,
                    )
                }

                if (semantics === 'ref' && !this.isReferenceType(field.type)) {
                    throw new Error(
                        `${posStr(decl.position)}:Field '${field.name}' in data type '${decl.name}' cannot use 'ref' semantics with non-reference type '${field.type}'`,
                    )
                }

                if (this.isServiceType(field.type)) {
                    throw new Error(
                        `${posStr(decl.position)}:Data type '${decl.name}' cannot contain service field '${field.name}' of type '${field.type}'`,
                    )
                }
            }
        }
    }

    private validateTypeFieldSemantics(
        objects: ASTObjectDeclaration[],
        services: ASTServiceDeclaration[],
    ): void {
        for (const objectDecl of objects) {
            for (const section of objectDecl.sections) {
                if (section.kind !== 'data') continue

                for (const field of section.fields) {
                    if (!this.isServiceType(field.type)) continue

                    throw new Error(
                        `${posStr(objectDecl.position)}:Object '${objectDecl.name}' cannot contain service field '${field.name}' of type '${field.type}'`,
                    )
                }
            }
        }

        for (const serviceDecl of services) {
            for (const section of serviceDecl.sections) {
                if (section.kind !== 'data') continue

                for (const field of section.fields) {
                    if (!this.isServiceType(field.type)) continue
                    if (field.semantics === 'ref') continue

                    throw new Error(
                        `${posStr(serviceDecl.position)}:Service '${serviceDecl.name}' field '${field.name}' with service type '${field.type}' must use 'ref' semantics`,
                    )
                }
            }
        }
    }

    private analyzeVariableDeclaration(
        stmt: ASTVariableDeclaration,
    ): SemanticVariableDeclaration {
        const explicitType = stmt.valueSet?.type
        const valueSemantics = this.inferExpressionSemantics(stmt.value)

        if (explicitType) {
            this.validateInitializerAgainstType(stmt.value, explicitType)
            this.validateServiceVariableSemantics(
                stmt.name,
                explicitType,
                stmt.semantics,
                stmt.position,
            )
            this.declareBinding(
                stmt.name,
                {
                    type: explicitType,
                    semantics: stmt.semantics,
                },
                stmt.position,
            )
            const rewrittenValue = this.rewriteExpression(stmt.value)

            this.validateSemanticBoundary(
                explicitType,
                stmt.semantics,
                valueSemantics,
                rewrittenValue,
                stmt.position,
            )

            return {
                ...stmt,
                valueSet: { type: explicitType },
                value: rewrittenValue,
                ownership: this.buildVariableOwnership(
                    stmt.name,
                    explicitType,
                    rewrittenValue,
                    stmt.semantics,
                    valueSemantics,
                ),
            }
        }

        const inferredType = this.inferExpressionType(stmt.value)
        if (!inferredType) {
            throw new Error(
                `${posStr(stmt.position)}:Cannot infer type for variable '${stmt.name}' from '${stmt.value.kind}' initializer`,
            )
        }

        this.validateServiceVariableSemantics(
            stmt.name,
            inferredType,
            stmt.semantics,
            stmt.position,
        )
        this.declareBinding(
            stmt.name,
            {
                type: inferredType,
                semantics: stmt.semantics,
            },
            stmt.position,
        )
        const rewrittenValue = this.rewriteExpression(stmt.value)

        this.validateSemanticBoundary(
            inferredType,
            stmt.semantics,
            valueSemantics,
            rewrittenValue,
            stmt.position,
        )

        return {
            ...stmt,
            valueSet: { type: inferredType },
            value: rewrittenValue,
            ownership: this.buildVariableOwnership(
                stmt.name,
                inferredType,
                rewrittenValue,
                stmt.semantics,
                valueSemantics,
            ),
        }
    }

    private buildVariableOwnership(
        name: string,
        type: string,
        value: SemanticVariableDeclaration['value'],
        targetSemantics: ASTVariableDeclaration['semantics'],
        valueSemantics: ASTVariableDeclaration['semantics'] | null,
    ): SemanticOwnershipEffects {
        if (!this.isReferenceType(type)) return {}

        const ownership: SemanticOwnershipEffects = {
            releaseAtScopeExit: true,
        }

        if (this.isCopyExpression(value)) {
            ownership.copyValueSemantics =
                this.toRuntimeSemanticsFlag(targetSemantics)
            return ownership
        }

        ownership.retains =
            value.kind === 'data-literal' || value.kind === 'array-literal'
                ? []
                : [
                      {
                          kind: 'identifier',
                          name,
                          position: value.position,
                      },
                  ]

        return ownership
    }

    private isReferenceType(type: string): boolean {
        return Boolean(this.lookupDataType(type)) || this.isArrayType(type)
    }

    private isServiceType(type: string): boolean {
        return this.lookupTypeKind(type) === 'service'
    }

    private validateServiceVariableSemantics(
        name: string,
        type: string,
        semantics: ASTVariableDeclaration['semantics'],
        position: { line: number; column: number },
    ): void {
        if (!this.isServiceType(type)) return
        if (semantics === 'ref') return

        throw new Error(
            `${posStr(position)}:Service variable '${name}' must be declared as 'ref', got '${semantics}'`,
        )
    }

    private validateServiceFunctionRestrictions(
        stmt: ASTFunctionDeclaration,
    ): void {
        for (const param of stmt.parameters) {
            if (!this.isServiceType(param.type)) continue

            if (param.semantics !== 'ref') {
                throw new Error(
                    `${posStr(param.position)}:Service parameter '${param.name}' must use 'ref' semantics`,
                )
            }
        }

        if (!stmt.returnType || !this.isServiceType(stmt.returnType)) return
        if (stmt.returnSemantics === 'ref') return

        throw new Error(
            `${posStr(stmt.position)}:Function '${this.renderDiagnosticFunctionName(stmt)}' returning service type '${stmt.returnType}' must declare '-> ref ${stmt.returnType}'`,
        )
    }

    private renderDiagnosticFunctionName(stmt: ASTFunctionDeclaration): string {
        if (!this.currentOwnerType) return stmt.name
        return `${this.currentOwnerType}.${stmt.name}`
    }

    private collectMutateTargets(
        target: SemanticFieldAccess,
    ): SemanticFieldAccess['object'][] {
        const mutates: SemanticFieldAccess['object'][] = []

        const collect = (expr: SemanticFieldAccess['object']) => {
            mutates.push(expr)
            if (expr.kind === 'field-access') collect(expr.object)
        }

        collect(target.object)
        return mutates.reverse()
    }

    private validateInitializerAgainstType(
        value: ASTExpression,
        expected: string,
    ) {
        if (value.kind === 'array-literal') {
            this.validateArrayLiteral(value, expected)
            return
        }

        if (value.kind === 'data-literal') {
            this.validateDataLiteral(value, expected)
            return
        }

        const inferred = this.inferExpressionType(value)
        if (inferred && !this.isTypeAssignable(inferred, expected)) {
            throw new Error(
                `${posStr(value.position)}:Type mismatch: expected '${expected}' but got '${inferred}'`,
            )
        }
    }

    private validateDataLiteral(value: ASTDataLiteral, expectedType: string) {
        const expectedFields = this.lookupAllTypeFields(expectedType)
        if (!expectedFields) return

        if (value.superInitializer) {
            this.validateDataLiteralSuperInitializer(value, expectedType)
        }

        const directFields = this.lookupDataType(expectedType)
        const requiredFields = value.superInitializer
            ? (directFields ?? new Map<string, VariableBinding>())
            : expectedFields

        for (const [fieldName, fieldEntry] of Object.entries(value.fields)) {
            const expectedFieldInfo = requiredFields.get(fieldName)
            if (!expectedFieldInfo) {
                const pos = fieldEntry.namePosition
                throw new Error(
                    `${posStr(pos)}:Field ${fieldName} not found in type ${expectedType}`,
                )
            }

            this.validateDataLiteralFieldExpression(fieldEntry.value)

            const inferredFieldType = this.inferExpressionType(fieldEntry.value)
            if (
                !inferredFieldType ||
                !this.isTypeAssignable(
                    inferredFieldType,
                    expectedFieldInfo.type,
                )
            ) {
                const pos = fieldEntry.namePosition
                throw new Error(
                    `${posStr(pos)}:Type mismatch for field '${fieldName}': expected '${expectedFieldInfo.type}' but got '${inferredFieldType ?? fieldEntry.value.kind}'`,
                )
            }
        }

        for (const [fieldName, fieldInfo] of requiredFields.entries()) {
            if (!(fieldName in value.fields)) {
                throw new Error(
                    `${posStr(value.position)}:Missing field '${fieldName}' for data type '${expectedType}'`,
                )
            }
        }
    }

    private validateDataLiteralFieldExpression(
        fieldValue: ASTExpression,
    ): void {
        if (fieldValue.kind === 'call') {
            throw new Error(
                `${posStr(fieldValue.position)}:Call expressions are not supported in data literal fields`,
            )
        }

        if (fieldValue.kind === 'array-literal') {
            throw new Error(
                `${posStr(fieldValue.position)}:Array literals are not supported in data literal fields`,
            )
        }

        if (
            fieldValue.kind === 'binary' &&
            fieldValue.operator === '.' &&
            fieldValue.left.kind === 'call'
        ) {
            throw new Error(
                `${posStr(fieldValue.position)}:Call expressions are not supported in data literal fields`,
            )
        }

        if (fieldValue.kind === 'data-literal') {
            const fields = Object.values(fieldValue.fields)
            for (const nestedField of fields) {
                this.validateDataLiteralFieldExpression(nestedField.value)
            }
        }
    }

    private validateDataLiteralSuperInitializer(
        value: ASTDataLiteral,
        expectedType: string,
    ): void {
        const superInitializer = value.superInitializer
        if (!superInitializer) return

        const declaredSupertype = this.lookupObjectSupertype(expectedType)
        if (!declaredSupertype) {
            throw new Error(
                `${posStr(superInitializer.position)}:Type '${expectedType}' has no direct supertype for a super initializer call`,
            )
        }

        const callee = superInitializer.callee
        if (
            callee.kind !== 'binary' ||
            callee.operator !== '.' ||
            callee.left.kind !== 'identifier' ||
            callee.left.name !== 'super' ||
            callee.right.kind !== 'identifier'
        ) {
            throw new Error(
                `${posStr(superInitializer.position)}:Super initializer must be a direct call in the form super.name(...)`,
            )
        }

        const argumentLabels = superInitializer.arguments.map(
            (arg) => arg.label ?? '_',
        )
        const signature = this.lookupFunctionSignature(
            buildFunctionSignatureKey(
                callee.right.name,
                argumentLabels,
                declaredSupertype,
            ),
        )

        if (!signature || !signature.isInheritanceInitializer) {
            throw new Error(
                `${posStr(superInitializer.position)}:No inheritance initializer '${declaredSupertype}.${callee.right.name}' matches this call`,
            )
        }

        for (let i = 0; i < superInitializer.arguments.length; i++) {
            const argument = superInitializer.arguments[i]
            const expectedType = signature.parameterTypes[i]
            const actualType = this.inferExpressionType(argument.value)
            if (
                expectedType &&
                actualType &&
                !this.isTypeAssignable(actualType, expectedType)
            ) {
                throw new Error(
                    `${posStr(argument.value.position)}:Argument ${i + 1} type mismatch for super initializer '${declaredSupertype}.${callee.right.name}': expected '${expectedType}' but got '${actualType}'`,
                )
            }
        }
    }

    private validateArrayLiteral(
        value: Extract<ASTExpression, { kind: 'array-literal' }>,
        expectedType: string,
    ) {
        if (!this.isArrayType(expectedType)) {
            throw new Error(
                `${posStr(value.position)}:Type mismatch: expected '${expectedType}' but got 'array-literal'`,
            )
        }

        const elementType = this.arrayElementType(expectedType)
        if (!elementType) {
            throw new Error(
                `${posStr(value.position)}:Invalid array type '${expectedType}'`,
            )
        }

        for (const element of value.elements) {
            const inferredElementType = this.inferExpressionType(element)
            if (
                !inferredElementType ||
                !this.isTypeAssignable(inferredElementType, elementType)
            ) {
                throw new Error(
                    `${posStr(element.position)}:Type mismatch for array element: expected '${elementType}' but got '${inferredElementType ?? element.kind}'`,
                )
            }
        }
    }

    private inferExpressionType(
        value: ASTExpression,
        options?: { allowInheritanceInitializerCall?: boolean },
    ): string | null {
        switch (value.kind) {
            case 'truthvalue':
                return 'truthvalue'
            case 'integer':
                return 'integer'
            case 'string':
                return 'string'
            case 'when': {
                const subjectType = this.inferExpressionType(value.subject)
                if (!subjectType) {
                    throw new Error(
                        `${posStr(value.subject.position)}:Cannot infer type for when subject`,
                    )
                }

                if (subjectType === 'string') {
                    throw new Error(
                        `${posStr(value.position)}:when does not yet support string subject patterns`,
                    )
                }

                if (value.branches.length === 0) {
                    throw new Error(
                        `${posStr(value.position)}:when requires at least one branch`,
                    )
                }

                const wildcardIndex = value.branches.findIndex(
                    (branch) => branch.pattern.kind === 'wildcard-pattern',
                )
                if (wildcardIndex === -1) {
                    throw new Error(
                        `${posStr(value.position)}:when expression requires a wildcard '_' branch for exhaustiveness`,
                    )
                }
                if (wildcardIndex !== value.branches.length - 1) {
                    throw new Error(
                        `${posStr(value.position)}:Wildcard pattern '_' must be the last branch in when expression`,
                    )
                }

                let resultType: string | null = null
                for (const branch of value.branches) {
                    if (branch.pattern.kind === 'value-pattern') {
                        const patternType = this.inferExpressionType(
                            branch.pattern.value,
                        )
                        if (!patternType) {
                            throw new Error(
                                `${posStr(branch.pattern.position)}:Cannot infer type for when pattern`,
                            )
                        }

                        if (!this.isTypeAssignable(patternType, subjectType)) {
                            throw new Error(
                                `${posStr(branch.pattern.position)}:when pattern type mismatch: expected '${subjectType}' but got '${patternType}'`,
                            )
                        }
                    }

                    const branchType = this.inferExpressionType(branch.value)
                    if (!branchType) {
                        throw new Error(
                            `${posStr(branch.value.position)}:Cannot infer type for when branch value`,
                        )
                    }

                    if (!resultType) {
                        resultType = branchType
                        continue
                    }

                    if (!this.isTypeAssignable(branchType, resultType)) {
                        throw new Error(
                            `${posStr(branch.value.position)}:when branch type mismatch: expected '${resultType}' but got '${branchType}'`,
                        )
                    }
                }

                return resultType
            }
            case 'array-literal': {
                if (value.elements.length === 0) {
                    throw new Error(
                        `${posStr(value.position)}:Cannot infer type for empty array literal; add an explicit annotation`,
                    )
                }

                const firstType = this.inferExpressionType(value.elements[0])
                if (!firstType) {
                    throw new Error(
                        `${posStr(value.elements[0].position)}:Cannot infer type for array element`,
                    )
                }

                for (let i = 1; i < value.elements.length; i++) {
                    const nextType = this.inferExpressionType(value.elements[i])
                    if (
                        !nextType ||
                        !this.isTypeAssignable(nextType, firstType)
                    ) {
                        throw new Error(
                            `${posStr(value.elements[i].position)}:Array literal element type mismatch: expected '${firstType}' but got '${nextType ?? value.elements[i].kind}'`,
                        )
                    }
                }

                return `[${firstType}]`
            }
            case 'call': {
                const argumentLabels = value.arguments.map(
                    (arg) => arg.label ?? '_',
                )

                let signature: FunctionSignature | undefined
                let calleeName: string

                if (value.callee.kind === 'identifier') {
                    calleeName = value.callee.name
                    const calleeBinding = this.lookupBinding(value.callee.name)
                    if (!calleeBinding) {
                        throw new Error(
                            `${posStr(value.callee.position)}:Unknown identifier '${value.callee.name}'`,
                        )
                    }

                    if (calleeBinding.type !== 'func') {
                        throw new Error(
                            `${posStr(value.callee.position)}:Cannot call non-function identifier '${value.callee.name}'`,
                        )
                    }

                    signature = this.lookupFunctionSignature(
                        buildFunctionSignatureKey(calleeName, argumentLabels),
                    )

                    if (!signature) {
                        const overloads =
                            this.lookupFunctionSignaturesByName(calleeName)
                        const suggestion = buildDidYouMeanSignatureHint(
                            calleeName,
                            overloads,
                        )
                        throw new Error(
                            `${posStr(value.position)}:Function/method not found '${renderFunctionSignature(calleeName, argumentLabels)}'.${suggestion}`,
                        )
                    }
                } else if (
                    value.callee.kind === 'binary' &&
                    value.callee.operator === '.' &&
                    value.callee.right.kind === 'identifier'
                ) {
                    const receiverType = this.inferExpressionType(
                        value.callee.left,
                    )
                    if (!receiverType) {
                        throw new Error(
                            `${posStr(value.callee.position)}:Cannot infer type for method call receiver`,
                        )
                    }

                    calleeName = value.callee.right.name
                    signature = this.resolveMethodSignature(
                        receiverType,
                        calleeName,
                        argumentLabels,
                    )

                    if (!signature) {
                        const overloads = this.lookupFunctionSignaturesByName(
                            calleeName,
                            receiverType,
                        )
                        const suggestion = buildDidYouMeanSignatureHint(
                            calleeName,
                            overloads,
                            receiverType,
                        )
                        throw new Error(
                            `${posStr(value.position)}:Function/method not found '${renderFunctionSignature(calleeName, argumentLabels, receiverType)}'.${suggestion}`,
                        )
                    }
                } else {
                    throw new Error(
                        `${posStr(value.position)}:Unsupported call target '${value.callee.kind}'`,
                    )
                }

                if (
                    signature.ownerType &&
                    signature.visibility === 'helper' &&
                    this.currentOwnerType !== signature.ownerType
                ) {
                    throw new Error(
                        `${posStr(value.position)}:Method '${renderFunctionSignature(calleeName, argumentLabels, signature.ownerType)}' is helper and only callable inside '${signature.ownerType}'`,
                    )
                }

                if (
                    signature.isInheritanceInitializer &&
                    !options?.allowInheritanceInitializerCall
                ) {
                    throw new Error(
                        `${posStr(value.position)}:Inheritance initializer '${renderFunctionSignature(calleeName, argumentLabels, signature.ownerType)}' cannot be called directly; use it as the first entry in a subtype object literal`,
                    )
                }

                this.validateCallEffects(signature, value.position, {
                    name: calleeName,
                    labels: argumentLabels,
                    ownerType: signature.ownerType,
                })

                // Update current free function's effect level if calling external functions
                if (
                    this.currentFunctionEffectLevel !== null &&
                    signature.effectLevel === 'external'
                ) {
                    this.currentFunctionEffectLevel = 'external'
                }

                if (value.arguments.length !== signature.arity) {
                    throw new Error(
                        `${posStr(value.position)}:Function '${calleeName}' expects ${signature.arity} argument(s), got ${value.arguments.length}`,
                    )
                }

                for (const arg of value.arguments) {
                    if (arg.value.kind === 'data-literal') {
                        throw new Error(
                            `${posStr(arg.value.position)}:Data literal arguments are not supported in function calls`,
                        )
                    }
                    this.inferExpressionType(arg.value)
                }

                for (let i = 0; i < value.arguments.length; i++) {
                    const actualType = this.inferExpressionType(
                        value.arguments[i].value,
                    )
                    const expectedType = signature.parameterTypes[i]

                    if (
                        actualType &&
                        expectedType !== undefined &&
                        !this.isTypeAssignable(actualType, expectedType)
                    ) {
                        throw new Error(
                            `${posStr(value.arguments[i].value.position)}:Argument ${i + 1} type mismatch for function '${calleeName}': expected '${expectedType}' but got '${actualType}'`,
                        )
                    }
                }

                if (signature.returnType === undefined) {
                    throw new Error(
                        `${posStr(value.position)}:Function '${calleeName}' has no return type and cannot be used as a value`,
                    )
                }

                return signature.returnType
            }
            case 'identifier': {
                this.assertSelfReadable(value)

                const binding = this.lookupBinding(value.name)
                if (!binding) {
                    throw new Error(
                        `${posStr(value.position)}:Unknown identifier '${value.name}'`,
                    )
                }
                return binding.type
            }
            case 'binary': {
                if (value.operator === '[]') {
                    const arrayType = this.inferExpressionType(value.left)
                    if (!arrayType || !this.isArrayType(arrayType)) {
                        throw new Error(
                            `${posStr(value.position)}:Indexing expects an array value, got '${arrayType ?? value.left.kind}'`,
                        )
                    }

                    const indexType = this.inferExpressionType(value.right)
                    if (indexType !== 'integer') {
                        throw new Error(
                            `${posStr(value.position)}:Array index must be integer, got '${indexType ?? value.right.kind}'`,
                        )
                    }

                    const elementType = this.arrayElementType(arrayType)
                    if (!elementType) {
                        throw new Error(
                            `${posStr(value.position)}:Invalid array type '${arrayType}'`,
                        )
                    }

                    return elementType
                }

                if (value.operator === '+') {
                    const leftType = this.inferExpressionType(value.left)
                    const rightType = this.inferExpressionType(value.right)

                    if (!leftType || !rightType) {
                        throw new Error(
                            `${posStr(value.position)}:Cannot infer operand type for '+'`,
                        )
                    }

                    if (leftType === 'string' && rightType === 'string') {
                        return 'string'
                    }

                    if (leftType === 'integer' && rightType === 'integer') {
                        return 'integer'
                    }

                    if (
                        leftType !== 'string' &&
                        leftType !== 'integer' &&
                        rightType !== 'string' &&
                        rightType !== 'integer'
                    ) {
                        throw new Error(
                            `${posStr(value.position)}:Operator '+' expects string or integer operands, got '${leftType}' and '${rightType}'`,
                        )
                    }

                    throw new Error(
                        `${posStr(value.position)}:Operator '+' requires matching operand types, got '${leftType}' and '${rightType}'`,
                    )
                }

                if (
                    value.operator === '-' ||
                    value.operator === '*' ||
                    value.operator === '/'
                ) {
                    const leftType = this.inferExpressionType(value.left)
                    const rightType = this.inferExpressionType(value.right)

                    if (leftType !== 'integer' || rightType !== 'integer') {
                        throw new Error(
                            `${posStr(value.position)}:Operator '${value.operator}' expects integer operands, got '${leftType}' and '${rightType}'`,
                        )
                    }

                    return 'integer'
                }

                if (value.operator === '==' || value.operator === '!=') {
                    const leftType = this.inferExpressionType(value.left)
                    const rightType = this.inferExpressionType(value.right)

                    if (!leftType || !rightType) {
                        throw new Error(
                            `${posStr(value.position)}:Cannot infer operand type for '${value.operator}'`,
                        )
                    }

                    if (leftType !== rightType) {
                        throw new Error(
                            `${posStr(value.position)}:Operator '${value.operator}' requires matching operand types, got '${leftType}' and '${rightType}'`,
                        )
                    }

                    return 'truthvalue'
                }

                if (
                    value.operator === '<' ||
                    value.operator === '<=' ||
                    value.operator === '>' ||
                    value.operator === '>='
                ) {
                    const leftType = this.inferExpressionType(value.left)
                    const rightType = this.inferExpressionType(value.right)

                    if (leftType !== 'integer' || rightType !== 'integer') {
                        throw new Error(
                            `${posStr(value.position)}:Operator '${value.operator}' expects integer operands, got '${leftType}' and '${rightType}'`,
                        )
                    }

                    return 'truthvalue'
                }

                if (value.operator === '&&' || value.operator === '||') {
                    const leftType = this.inferExpressionType(value.left)
                    const rightType = this.inferExpressionType(value.right)

                    if (
                        leftType !== 'truthvalue' ||
                        rightType !== 'truthvalue'
                    ) {
                        throw new Error(
                            `${posStr(value.position)}:Operator '${value.operator}' expects truthvalue operands, got '${leftType}' and '${rightType}'`,
                        )
                    }

                    return 'truthvalue'
                }

                if (value.operator !== '.') return null
                if (value.right.kind !== 'identifier') return null
                const objectType = this.inferExpressionType(value.left)
                if (!objectType) {
                    throw new Error(
                        `${posStr(value.position)}:Cannot infer type for dot access object`,
                    )
                }
                if (!this.lookupDataType(objectType)) {
                    throw new Error(
                        `${posStr(value.position)}:Cannot resolve field '${value.right.name}' on non-data type '${objectType}'`,
                    )
                }
                const fieldInfo = this.lookupFieldInfo(
                    objectType,
                    value.right.name,
                )
                if (!fieldInfo) {
                    throw new Error(
                        `${posStr(value.position)}:Unknown field '${value.right.name}' on data type '${objectType}'`,
                    )
                }
                return fieldInfo.type
            }
            case 'copy': {
                const copiedType = this.inferExpressionType(value.value)
                if (!copiedType) {
                    throw new Error(
                        `${posStr(value.position)}:Cannot infer type for copy value`,
                    )
                }
                if (!this.isReferenceType(copiedType)) {
                    throw new Error(
                        `${posStr(value.position)}:copy(...) expects a reference-counted value, got '${copiedType}'`,
                    )
                }
                return copiedType
            }
            case 'data-literal':
                return null
            default:
                return null
        }
    }

    private validateAssignmentMutationSemantics(target: ASTExpression): void {
        if (target.kind === 'identifier') {
            this.assertIdentifierIsMutable(target, target.position)
            return
        }

        if (target.kind === 'binary' && target.operator === '.') {
            const rootIdentifier = this.extractRootIdentifier(target)
            if (!rootIdentifier) {
                throw new Error(
                    `${posStr(target.position)}:Invalid field assignment target`,
                )
            }

            const binding = this.lookupBinding(rootIdentifier.name)
            if (!binding) {
                throw new Error(
                    `${posStr(rootIdentifier.position)}:Unknown identifier '${rootIdentifier.name}'`,
                )
            }

            if (binding.semantics === 'const') {
                throw new Error(
                    `${posStr(rootIdentifier.position)}:Cannot mutate field through const variable '${rootIdentifier.name}'`,
                )
            }
        }
    }

    private inferExpressionSemantics(
        value: ASTExpression,
    ): ASTVariableDeclaration['semantics'] | null {
        switch (value.kind) {
            case 'call':
                return null
            case 'when':
                return null
            case 'array-literal':
                return null
            case 'identifier': {
                const binding = this.lookupBinding(value.name)
                if (!binding) {
                    throw new Error(
                        `${posStr(value.position)}:Unknown identifier '${value.name}'`,
                    )
                }
                return binding.semantics
            }
            case 'binary': {
                if (value.operator === '[]') return null
                if (value.operator === '+') return null
                if (value.operator !== '.') return null
                if (value.right.kind !== 'identifier') return null
                const objectType = this.inferExpressionType(value.left)
                if (!objectType) return null
                const fieldInfo = this.lookupFieldInfo(
                    objectType,
                    value.right.name,
                )
                if (!fieldInfo) return null
                return fieldInfo.semantics
            }
            case 'copy':
                return null
            default:
                return null
        }
    }

    private toRuntimeSemanticsFlag(
        semantics: ASTVariableDeclaration['semantics'] | null,
    ): '__rc_ISOLATED' | '__rc_SHARED' {
        return semantics === 'ref' ? '__rc_SHARED' : '__rc_ISOLATED'
    }

    private requiresSemanticCopy(
        targetSemantics: ASTVariableDeclaration['semantics'] | null,
        valueSemantics: ASTVariableDeclaration['semantics'] | null,
    ): boolean {
        if (!targetSemantics || !valueSemantics) return false
        return (
            this.toRuntimeSemanticsFlag(targetSemantics) !==
            this.toRuntimeSemanticsFlag(valueSemantics)
        )
    }

    private validateSemanticBoundary(
        targetType: string,
        targetSemantics: ASTVariableDeclaration['semantics'] | null,
        valueSemantics: ASTVariableDeclaration['semantics'] | null,
        rewrittenValue:
            | SemanticAssignment['value']
            | SemanticVariableDeclaration['value'],
        position: { line: number; column: number },
    ): void {
        if (!this.isReferenceType(targetType)) return
        if (!this.requiresSemanticCopy(targetSemantics, valueSemantics)) return
        if (this.isCopyExpression(rewrittenValue)) return

        const suggestionExpr = this.formatCopySuggestionValue(rewrittenValue)

        throw new Error(
            `${posStr(position)}:Cross-semantics assignment requires explicit copy(...). Use copy(${suggestionExpr}) to state intent.`,
        )
    }

    private formatCopySuggestionValue(
        value:
            | SemanticAssignment['value']
            | SemanticVariableDeclaration['value'],
    ): string {
        switch (value.kind) {
            case 'identifier':
                return value.name
            case 'field-access':
                return `${this.formatCopySuggestionValue(value.object)}.${value.field}`
            default:
                return 'value'
        }
    }

    private isCopyExpression(
        value:
            | SemanticAssignment['value']
            | SemanticVariableDeclaration['value'],
    ): value is SemanticCopyExpression {
        return value.kind === 'copy'
    }

    private assertIdentifierIsMutable(
        identifier: ASTIdentifier,
        position: { line: number; column: number },
    ): void {
        const binding = this.lookupBinding(identifier.name)
        if (!binding) {
            throw new Error(
                `${posStr(position)}:Unknown identifier '${identifier.name}'`,
            )
        }

        if (binding.semantics === 'const') {
            throw new Error(
                `${posStr(position)}:Cannot assign to const variable '${identifier.name}'`,
            )
        }
    }

    private extractRootIdentifier(expr: ASTExpression): ASTIdentifier | null {
        if (expr.kind === 'identifier') return expr
        if (expr.kind === 'binary' && expr.operator === '.') {
            return this.extractRootIdentifier(expr.left)
        }
        return null
    }

    private declareBinding(
        name: string,
        binding: {
            type: string
            semantics: ASTVariableDeclaration['semantics']
        },
        position: { line: number; column: number },
    ): void {
        if (this.bindings.has(name)) {
            throw new Error(
                `${posStr(position)}:Variable '${name}' is already declared in this scope`,
            )
        }

        this.bindings.set(name, binding)
    }

    private lookupBinding(name: string): VariableBinding | undefined {
        const binding = this.bindings.get(name)
        if (binding || !this.parent) return binding
        return this.parent.lookupBinding(name)
    }

    private lookupFunctionSignature(
        signatureKey: string,
    ): FunctionSignature | undefined {
        const signature = this.functionSignatures.get(signatureKey)
        if (signature || !this.parent) return signature
        return this.parent.lookupFunctionSignature(signatureKey)
    }

    private lookupFunctionSignaturesByName(
        name: string,
        ownerType?: string,
    ): FunctionSignature[] {
        const ownerTypes =
            ownerType === undefined
                ? undefined
                : [ownerType, ...this.collectObjectSupertypeChain(ownerType)]
        const signatures = Array.from(this.functionSignatures.values()).filter(
            (signature) => {
                if (signature.name !== name) return false
                if (ownerType === undefined) {
                    return signature.ownerType === undefined
                }

                return (
                    signature.ownerType !== undefined &&
                    ownerTypes?.includes(signature.ownerType)
                )
            },
        )

        if (signatures.length > 0 || !this.parent) return signatures
        return this.parent.lookupFunctionSignaturesByName(name, ownerType)
    }

    private resolveMethodSignature(
        receiverType: string,
        methodName: string,
        labels: string[],
    ): FunctionSignature | undefined {
        const ownerTypes = [
            receiverType,
            ...this.collectObjectSupertypeChain(receiverType),
        ]

        for (const ownerType of ownerTypes) {
            const signature = this.lookupFunctionSignature(
                buildFunctionSignatureKey(methodName, labels, ownerType),
            )
            if (signature) {
                return signature
            }
        }

        return undefined
    }

    private lookupInheritedMethodSignature(
        ownerType: string | undefined,
        methodName: string,
        labels: string[],
    ): FunctionSignature | undefined {
        if (!ownerType) return undefined

        const signature = this.lookupFunctionSignature(
            buildFunctionSignatureKey(methodName, labels, ownerType),
        )
        if (signature?.visibility === 'public') {
            return signature
        }

        return this.lookupInheritedMethodSignature(
            this.lookupObjectSupertype(ownerType),
            methodName,
            labels,
        )
    }

    private collectObjectSupertypeChain(name: string): string[] {
        const chain: string[] = []
        const seen = new Set<string>()
        let current = this.lookupObjectSupertype(name)

        while (current && !seen.has(current)) {
            chain.push(current)
            seen.add(current)
            current = this.lookupObjectSupertype(current)
        }

        return chain
    }

    private isTypeAssignable(actual: string, expected: string): boolean {
        if (actual === expected) return true

        let current = this.lookupObjectSupertype(actual)
        while (current) {
            if (current === expected) {
                return true
            }
            current = this.lookupObjectSupertype(current)
        }

        return false
    }

    private isArrayType(type: string): boolean {
        return /^\[[^\]]+\]$/.test(type)
    }

    private arrayElementType(type: string): string | null {
        const match = type.match(/^\[([^\]]+)\]$/)
        return match ? match[1] : null
    }

    private lookupAllTypeFields(typeName: string): BindingMap | undefined {
        const directFields = this.lookupDataType(typeName)
        const kind = this.lookupTypeKind(typeName)

        if (kind !== 'object') return directFields

        const merged = new Map<string, VariableBinding>()
        const lineage: string[] = []
        let current: string | undefined = typeName
        while (current) {
            lineage.push(current)
            current = this.lookupObjectSupertype(current)
        }

        lineage.reverse()
        for (const name of lineage) {
            const fields = this.lookupDataType(name)
            if (!fields) continue
            for (const [fieldName, fieldInfo] of fields.entries()) {
                merged.set(fieldName, fieldInfo)
            }
        }

        return merged
    }

    private lookupFieldInfo(
        typeName: string,
        fieldName: string,
    ): VariableBinding | undefined {
        const allFields = this.lookupAllTypeFields(typeName)
        return allFields?.get(fieldName)
    }
}

type VariableBinding = {
    type: string
    semantics: ASTVariableDeclaration['semantics']
    declarationPosition?: { line: number; column: number }
}

type BindingMap = Map<string, VariableBinding>

type TypeKind = 'data' | 'object' | 'service'

type EffectLevel = 'pure' | 'self-mutation' | 'external'

type FunctionSignature = {
    name: string
    ownerType?: string
    ownerKind?: 'object' | 'service'
    visibility: 'public' | 'helper'
    labels: string[]
    returnType?: string
    returnSemantics?: 'const' | 'ref'
    arity: number
    parameterTypes: string[]
    parameterSemantics: Array<'const' | 'mut' | 'ref'>
    effectLevel: EffectLevel
    isInheritanceInitializer: boolean
}

function effectRank(level: EffectLevel): number {
    switch (level) {
        case 'pure':
            return 0
        case 'self-mutation':
            return 1
        case 'external':
            return 2
    }
}

function isEffectLevelAllowed(
    actual: EffectLevel,
    allowed: EffectLevel,
): boolean {
    return effectRank(actual) <= effectRank(allowed)
}

function buildFunctionSignatureKey(
    name: string,
    labels: string[],
    ownerType?: string,
): string {
    const qualifier = ownerType ? `${ownerType}.` : ''
    return `${qualifier}${name}(${labels.join(':')})`
}

function renderFunctionSignature(
    name: string,
    labels: string[],
    ownerType?: string,
): string {
    const qualifier = ownerType ? `${ownerType}.` : ''
    if (labels.length === 0) {
        return `${qualifier}${name}()`
    }
    return `${qualifier}${name}(${labels.join(':')}:)`
}

function buildDidYouMeanSignatureHint(
    name: string,
    signatures: FunctionSignature[],
    ownerType?: string,
): string {
    if (signatures.length === 0) return ''
    const first = signatures[0]
    return ` Did you mean '${renderFunctionSignature(name, first.labels, ownerType ?? first.ownerType)}'?`
}

function mangleCallableName(name: string, labels: string[]): string {
    const suffix = labels
        .filter((label) => label !== '_')
        .map((label) => `__${label}`)
        .join('')
    return `${name}${suffix}`
}
