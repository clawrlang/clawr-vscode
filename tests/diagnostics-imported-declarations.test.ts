import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { TokenStream } from '../src/lexer'
import { Parser } from '../src/parser'
import { collectImportedDeclarationsForDiagnostics } from '../src/diagnostics/imported-declarations'

const tempRoots: string[] = []

afterEach(() => {
    for (const dir of tempRoots.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

describe('Diagnostics imported declarations', () => {
    it('preloads imported object and service declarations', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import Account, Clock from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(
            mod,
            'object Account { data: const active: truthvalue }\nservice Clock { }',
        )

        const mainProgram = parseFile(main)
        const declarations = await collectImportedDeclarationsForDiagnostics(
            mainProgram,
            main,
            readUtf8,
        )

        expect(declarations).toMatchObject([
            { kind: 'object-decl', name: 'Account', visibility: 'helper' },
            { kind: 'service-decl', name: 'Clock', visibility: 'helper' },
        ])
    })

    it('applies import aliases to preloaded declarations', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import Account as Ledger from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'object Account { }')

        const mainProgram = parseFile(main)
        const declarations = await collectImportedDeclarationsForDiagnostics(
            mainProgram,
            main,
            readUtf8,
        )

        expect(declarations).toHaveLength(1)
        expect(declarations[0]).toMatchObject({
            kind: 'object-decl',
            name: 'Ledger',
            visibility: 'helper',
        })
    })

    it('reports helper-only imported symbol at import item position', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import Internal from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'helper service Internal { }')

        const mainProgram = parseFile(main)

        await expect(
            collectImportedDeclarationsForDiagnostics(
                mainProgram,
                main,
                readUtf8,
            ),
        ).rejects.toThrow("1:8:Imported symbol 'Internal' is helper-only")
    })

    it('reports unknown imported object symbol at import item position', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import MissingObject from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'object Account { }')

        const mainProgram = parseFile(main)

        await expect(
            collectImportedDeclarationsForDiagnostics(
                mainProgram,
                main,
                readUtf8,
            ),
        ).rejects.toThrow(
            "1:8:Imported symbol 'MissingObject' does not exist in './mod'",
        )
    })

    it('reports unknown imported service symbol at import item position', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import MissingService from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'service Clock { }')

        const mainProgram = parseFile(main)

        await expect(
            collectImportedDeclarationsForDiagnostics(
                mainProgram,
                main,
                readUtf8,
            ),
        ).rejects.toThrow(
            "1:8:Imported symbol 'MissingService' does not exist in './mod'",
        )
    })
})

function mkTemp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawr-diag-imports-'))
    tempRoots.push(dir)
    return dir
}

function parseFile(filePath: string) {
    const source = fs.readFileSync(filePath, 'utf-8')
    return new Parser(new TokenStream(source, filePath)).parse()
}

async function readUtf8(filePath: string): Promise<string | null> {
    try {
        return await fs.promises.readFile(filePath, 'utf-8')
    } catch {
        return null
    }
}
