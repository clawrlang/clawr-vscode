import { TokenStream } from '../lexer'
import { Parser } from '../parser'
import type {
    ASTDataDeclaration,
    ASTFunctionDeclaration,
    ASTObjectDeclaration,
    ASTProgram,
    ASTServiceDeclaration,
    ASTStatement,
} from '../ast'
import { resolveImportPath } from '../semantic-analyzer/module-graph'

export type DiagnosticsFileReader = (filePath: string) => Promise<string | null>

export async function collectImportedDeclarationsForDiagnostics(
    program: ASTProgram,
    importerFilePath: string,
    readFileText: DiagnosticsFileReader,
): Promise<ASTStatement[]> {
    const importedDeclarations: ASTStatement[] = []
    const importedNames = new Set<string>()

    for (const imp of program.imports) {
        let importedFile: string
        try {
            importedFile = resolveImportPath(importerFilePath, imp.modulePath)
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error)
            throw new Error(
                `${imp.position.line}:${imp.position.column}:${message}`,
            )
        }

        const source = await readFileText(importedFile)
        if (!source) {
            throw new Error(
                `${imp.position.line}:${imp.position.column}:Unable to read imported module '${imp.modulePath}'`,
            )
        }

        const importedProgram = new Parser(
            new TokenStream(source, importedFile),
        ).parse()

        const publicSymbols = new Set<string>()
        const helperSymbols = new Set<string>()
        const exportedData = new Map<string, ASTDataDeclaration>()
        const exportedFunctions = new Map<string, ASTFunctionDeclaration>()
        const exportedObjects = new Map<string, ASTObjectDeclaration>()
        const exportedServices = new Map<string, ASTServiceDeclaration>()

        for (const stmt of importedProgram.body) {
            const isTopLevelNamedDecl =
                stmt.kind === 'data-decl' ||
                stmt.kind === 'func-decl' ||
                stmt.kind === 'object-decl' ||
                stmt.kind === 'service-decl'

            if (!isTopLevelNamedDecl) continue

            if (stmt.visibility === 'helper') {
                helperSymbols.add(stmt.name)
                continue
            }

            publicSymbols.add(stmt.name)

            if (stmt.kind === 'data-decl') {
                exportedData.set(stmt.name, stmt)
            } else if (stmt.kind === 'func-decl') {
                exportedFunctions.set(stmt.name, stmt)
            } else if (stmt.kind === 'object-decl') {
                exportedObjects.set(stmt.name, stmt)
            } else if (stmt.kind === 'service-decl') {
                exportedServices.set(stmt.name, stmt)
            }
        }

        for (const item of imp.items) {
            if (!publicSymbols.has(item.name)) {
                if (helperSymbols.has(item.name)) {
                    throw new Error(
                        `${item.position.line}:${item.position.column}:Imported symbol '${item.name}' is helper-only in '${imp.modulePath}'`,
                    )
                }

                throw new Error(
                    `${item.position.line}:${item.position.column}:Imported symbol '${item.name}' does not exist in '${imp.modulePath}'`,
                )
            }

            const localName = item.alias ?? item.name
            if (importedNames.has(localName)) continue

            importedNames.add(localName)

            const exportedDataDecl = exportedData.get(item.name)
            if (exportedDataDecl) {
                importedDeclarations.push({
                    ...exportedDataDecl,
                    name: localName,
                    visibility: 'helper',
                })
                continue
            }

            const exportedFunctionDecl = exportedFunctions.get(item.name)
            if (exportedFunctionDecl) {
                importedDeclarations.push(
                    createImportedFunctionDeclaration(
                        exportedFunctionDecl,
                        localName,
                    ),
                )
                continue
            }

            const exportedObjectDecl = exportedObjects.get(item.name)
            if (exportedObjectDecl) {
                importedDeclarations.push({
                    ...exportedObjectDecl,
                    name: localName,
                    visibility: 'helper',
                })
                continue
            }

            const exportedServiceDecl = exportedServices.get(item.name)
            if (exportedServiceDecl) {
                importedDeclarations.push({
                    ...exportedServiceDecl,
                    name: localName,
                    visibility: 'helper',
                })
            }
        }
    }

    return importedDeclarations
}

function createImportedFunctionDeclaration(
    declaration: ASTFunctionDeclaration,
    localName: string,
): ASTFunctionDeclaration {
    return {
        kind: 'func-decl',
        name: localName,
        visibility: 'helper',
        parameters: declaration.parameters.map((param) => ({ ...param })),
        returnType: declaration.returnType,
        returnSemantics: declaration.returnSemantics,
        body: {
            kind: 'block',
            statements: [],
        },
        position: declaration.position,
    }
}
