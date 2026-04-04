import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import {
    buildModuleGraph,
    resolveImportPath,
} from '../src/semantic-analyzer/module-graph'

const tempRoots: string[] = []

afterEach(() => {
    for (const dir of tempRoots.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true })
    }
})

describe('Module graph', () => {
    it('resolves imports and returns deterministic post-order', async () => {
        const root = mkTemp()
        const entry = path.join(root, 'main.clawr')
        const lexer = path.join(root, 'lexer.clawr')
        const tokens = path.join(root, 'tokens.clawr')

        fs.writeFileSync(
            entry,
            'import Lexer from "./lexer"\nimport Token from "./tokens"\nconst x = ambiguous',
        )
        fs.writeFileSync(lexer, 'data Lexer { value: truthvalue }')
        fs.writeFileSync(tokens, 'data Token { value: truthvalue }')

        const graph = await buildModuleGraph(entry)

        expect(graph.entry).toBe(path.resolve(entry))
        expect([...graph.modules.keys()].sort()).toEqual(
            [entry, lexer, tokens].map((p) => path.resolve(p)).sort(),
        )
        expect(graph.order).toEqual([
            path.resolve(lexer),
            path.resolve(tokens),
            path.resolve(entry),
        ])
    })

    it('detects import cycles', async () => {
        const root = mkTemp()
        const a = path.join(root, 'a.clawr')
        const b = path.join(root, 'b.clawr')

        fs.writeFileSync(a, 'import B from "./b"\nconst a1 = ambiguous')
        fs.writeFileSync(b, 'import A from "./a"\nconst b1 = true')

        await expect(buildModuleGraph(a)).rejects.toThrow(
            'Import cycle detected',
        )
    })

    it('resolves .clawr extension and index.clawr fallback', () => {
        const root = mkTemp()
        const importer = path.join(root, 'main.clawr')
        const nestedDir = path.join(root, 'pkg')
        const nestedIndex = path.join(nestedDir, 'index.clawr')

        fs.writeFileSync(importer, 'const x = ambiguous')
        fs.mkdirSync(nestedDir)
        fs.writeFileSync(nestedIndex, 'const y = true')

        expect(resolveImportPath(importer, './pkg')).toBe(
            path.resolve(nestedIndex),
        )
    })

    it('fails when importing unknown symbol from module', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import Missing from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'data Known { value: truthvalue }')

        await expect(buildModuleGraph(main)).rejects.toThrow(
            "imports unknown symbol 'Missing'",
        )
    })

    it('fails when importing helper-only symbol from module', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import Hidden from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'helper data Hidden { value: truthvalue }')

        await expect(buildModuleGraph(main)).rejects.toThrow('is helper-only')
    })

    it('allows importing a public object declaration from another module', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(main, 'import Money from "./mod"\nconst x = ambiguous')
        fs.writeFileSync(mod, 'object Money { data: const cents: integer }')

        const graph = await buildModuleGraph(main)
        expect([...graph.modules.keys()]).toHaveLength(2)
    })

    it('fails when importing a helper object from another module', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import Internal from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'helper object Internal { }')

        await expect(buildModuleGraph(main)).rejects.toThrow('is helper-only')
    })

    it('allows importing a public service declaration from another module', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import UserRepo from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'service UserRepo { }')

        const graph = await buildModuleGraph(main)
        expect([...graph.modules.keys()]).toHaveLength(2)
    })

    it('fails when importing a helper service from another module', async () => {
        const root = mkTemp()
        const main = path.join(root, 'main.clawr')
        const mod = path.join(root, 'mod.clawr')

        fs.writeFileSync(
            main,
            'import InternalCache from "./mod"\nconst x = ambiguous',
        )
        fs.writeFileSync(mod, 'helper service InternalCache { }')

        await expect(buildModuleGraph(main)).rejects.toThrow('is helper-only')
    })
})

function mkTemp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawr-module-graph-'))
    tempRoots.push(dir)
    return dir
}
