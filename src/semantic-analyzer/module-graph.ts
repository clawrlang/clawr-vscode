import fs from 'node:fs'
import path from 'node:path'
import { TokenStream } from '../lexer'
import { Parser } from '../parser'
import type {
    ASTDataDeclaration,
    ASTFunctionDeclaration,
    ASTProgram,
} from '../ast'
import type { ASTObjectDeclaration, ASTServiceDeclaration } from '../ast'

export interface ModuleGraph {
    entry: string
    order: string[]
    modules: Map<string, ASTProgram>
}

export async function buildModuleGraph(
    entryFile: string,
): Promise<ModuleGraph> {
    const entry = path.resolve(entryFile)
    const modules = new Map<string, ASTProgram>()
    const importsByModule = new Map<
        string,
        Array<{
            target: string
            importedItems: ASTProgram['imports'][number]['items']
            modulePath: string
        }>
    >()

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const order: string[] = []

    await visit(entry)

    return {
        entry,
        order,
        modules,
    }

    async function visit(filePath: string): Promise<void> {
        if (visited.has(filePath)) return

        if (visiting.has(filePath)) {
            const cycle = [...visiting, filePath]
                .map((p) => path.relative(process.cwd(), p) || p)
                .join(' -> ')
            throw new Error(`Import cycle detected: ${cycle}`)
        }

        visiting.add(filePath)

        const source = await fs.promises.readFile(filePath, 'utf-8')
        const ast = new Parser(new TokenStream(source, filePath)).parse()
        modules.set(filePath, ast)

        const resolvedImports = ast.imports
            .map((imp) => ({
                target: resolveImportPath(filePath, imp.modulePath),
                importedItems: imp.items,
                modulePath: imp.modulePath,
            }))
            .sort((a, b) => a.target.localeCompare(b.target))
        importsByModule.set(filePath, resolvedImports)

        for (const imported of resolvedImports) {
            await visit(imported.target)
        }

        validateImportedSymbols(filePath, resolvedImports)

        visiting.delete(filePath)
        visited.add(filePath)
        order.push(filePath)
    }

    function validateImportedSymbols(
        importerFile: string,
        imports: Array<{
            target: string
            importedItems: ASTProgram['imports'][number]['items']
            modulePath: string
        }>,
    ): void {
        for (const imp of imports) {
            const targetProgram = modules.get(imp.target)
            if (!targetProgram) {
                throw new Error(
                    `Internal error: missing parsed module for ${imp.target}`,
                )
            }

            const exported = exportedDataByName(targetProgram)
            const helper = helperDataByName(targetProgram)

            for (const item of imp.importedItems) {
                if (exported.has(item.name)) continue

                if (helper.has(item.name)) {
                    throw new Error(
                        `${path.relative(process.cwd(), importerFile)} imports '${item.name}' from '${imp.modulePath}', but '${item.name}' is helper-only in ${path.relative(process.cwd(), imp.target)}`,
                    )
                }

                throw new Error(
                    `${path.relative(process.cwd(), importerFile)} imports unknown symbol '${item.name}' from '${imp.modulePath}'`,
                )
            }
        }
    }
}

function exportedDataByName(program: ASTProgram): Set<string> {
    const dataNames = program.body
        .filter((stmt): stmt is ASTDataDeclaration => stmt.kind === 'data-decl')
        .filter((decl) => decl.visibility !== 'helper')
        .map((decl) => decl.name)

    const funcNames = program.body
        .filter(
            (stmt): stmt is ASTFunctionDeclaration => stmt.kind === 'func-decl',
        )
        .filter((decl) => decl.visibility !== 'helper')
        .map((decl) => decl.name)

    const typeNames = program.body
        .filter(
            (stmt): stmt is ASTObjectDeclaration | ASTServiceDeclaration =>
                stmt.kind === 'object-decl' || stmt.kind === 'service-decl',
        )
        .filter((decl) => decl.visibility !== 'helper')
        .map((decl) => decl.name)

    return new Set([...dataNames, ...funcNames, ...typeNames])
}

function helperDataByName(program: ASTProgram): Set<string> {
    const dataNames = program.body
        .filter((stmt): stmt is ASTDataDeclaration => stmt.kind === 'data-decl')
        .filter((decl) => decl.visibility === 'helper')
        .map((decl) => decl.name)

    const funcNames = program.body
        .filter(
            (stmt): stmt is ASTFunctionDeclaration => stmt.kind === 'func-decl',
        )
        .filter((decl) => decl.visibility === 'helper')
        .map((decl) => decl.name)

    const typeNames = program.body
        .filter(
            (stmt): stmt is ASTObjectDeclaration | ASTServiceDeclaration =>
                stmt.kind === 'object-decl' || stmt.kind === 'service-decl',
        )
        .filter((decl) => decl.visibility === 'helper')
        .map((decl) => decl.name)

    return new Set([...dataNames, ...funcNames, ...typeNames])
}

export function resolveImportPath(
    importerFile: string,
    modulePath: string,
): string {
    const baseDir = path.dirname(importerFile)
    const rawCandidate = modulePath.startsWith('.')
        ? path.resolve(baseDir, modulePath)
        : path.resolve(baseDir, modulePath)

    const candidates = [
        rawCandidate,
        `${rawCandidate}.clawr`,
        path.join(rawCandidate, 'index.clawr'),
    ]

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return path.resolve(candidate)
        }
    }

    throw new Error(
        `${path.relative(process.cwd(), importerFile)} imports '${modulePath}', but no module file was found`,
    )
}
