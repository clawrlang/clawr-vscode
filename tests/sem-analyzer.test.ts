import { describe, expect, it } from 'bun:test'
import { TokenStream } from '../src/lexer'
import { Parser } from '../src/parser'
import { SemanticAnalyzer } from '../src/semantic-analyzer'

describe('SemanticAnalyzer', () => {
    describe('module metadata', () => {
        it('carries imports and declaration visibility into semantic module', () => {
            const module = analyze(
                'import Token as Tok from "lexer/tokens"\nhelper data ParserState { value: truthvalue }\nconst x = ambiguous',
            )

            expect(module.imports).toMatchObject([
                {
                    kind: 'import',
                    items: [{ name: 'Token', alias: 'Tok' }],
                    modulePath: 'lexer/tokens',
                },
            ])

            expect(module.types).toMatchObject([
                {
                    kind: 'data-decl',
                    name: 'ParserState',
                    visibility: 'helper',
                },
            ])
        })

        it('keeps single-module behavior unchanged when no imports/helper are used', () => {
            const module = analyze(
                'data Point { x: truthvalue }\nconst p: Point = { x: true }\nprint p.x',
            )

            expect(module.imports).toEqual([])
            expect(module.types).toMatchObject([
                {
                    kind: 'data-decl',
                    name: 'Point',
                    visibility: 'public',
                    fields: [
                        { semantics: 'mut', name: 'x', type: 'truthvalue' },
                    ],
                },
            ])
            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'p',
                    valueSet: { type: 'Point' },
                    value: { kind: 'data-literal' },
                },
                {
                    kind: 'print',
                    dispatchType: 'truthvalue',
                    value: {
                        kind: 'field-access',
                        object: { kind: 'identifier', name: 'p' },
                        field: 'x',
                    },
                },
            ])
        })

        it('allows helper data usage inside the declaring module', () => {
            const module = analyze(
                'helper data Scratch { tmp: truthvalue }\nconst s: Scratch = { tmp: true }\nprint s.tmp',
            )

            expect(module.types).toMatchObject([
                {
                    kind: 'data-decl',
                    name: 'Scratch',
                    visibility: 'helper',
                },
            ])
            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 's',
                    valueSet: { type: 'Scratch' },
                },
                {
                    kind: 'print',
                    dispatchType: 'truthvalue',
                },
            ])
        })
    })

    describe('data field semantics', () => {
        it('accepts ref field with reference-counted type', () => {
            const module = analyze(
                'data Node {\n  ref next: Node\n  value: truthvalue\n}',
            )

            expect(module.types).toMatchObject([
                {
                    kind: 'data-decl',
                    name: 'Node',
                    fields: [
                        { semantics: 'ref', name: 'next', type: 'Node' },
                        { semantics: 'mut', name: 'value', type: 'truthvalue' },
                    ],
                },
            ])
        })

        it('fails when const field semantics is used', () => {
            expect(() =>
                analyze('data Point {\n  const x: truthvalue\n}'),
            ).toThrow(
                "1:1:Field 'x' in data type 'Point' cannot use 'const' semantics",
            )
        })

        it('fails when ref field semantics is used with non-reference type', () => {
            expect(() =>
                analyze('data Point {\n  ref x: truthvalue\n}'),
            ).toThrow(
                "1:1:Field 'x' in data type 'Point' cannot use 'ref' semantics with non-reference type 'truthvalue'",
            )
        })

        it('reports missing field using declaration field position', () => {
            expect(() =>
                analyze(
                    'data Point {\nx: truthvalue\ny: truthvalue\n}\nconst p: Point = { x: true }',
                ),
            ).toThrow("3:1:Missing field 'y' for data type 'Point'")
        })
    })

    describe('variable declaration type inference', () => {
        it('infers declaration type from truthvalue literal', () => {
            const module = analyze('const x = ambiguous')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    semantics: 'const',
                    name: 'x',
                    valueSet: { type: 'truthvalue' },
                    value: { kind: 'truthvalue', value: 'ambiguous' },
                },
            ])
        })

        it('keeps explicit declaration type when it matches inferred initializer type', () => {
            const module = analyze('const x: truthvalue = ambiguous')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    semantics: 'const',
                    name: 'x',
                    valueSet: { type: 'truthvalue' },
                },
            ])
        })

        it('fails on explicit declaration type mismatch', () => {
            expect(() => analyze('const x: integer = ambiguous')).toThrow(
                "1:20:Type mismatch: expected 'integer' but got 'truthvalue'",
            )
        })

        it('fails when declaration has data literal initializer without annotation', () => {
            expect(() => analyze('const p = { x: true }')).toThrow(
                "1:1:Cannot infer type for variable 'p' from 'data-literal' initializer",
            )
        })

        it('infers declaration type from identifier reference', () => {
            const module = analyze('const x = ambiguous\nconst y = x')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'x',
                    valueSet: { type: 'truthvalue' },
                },
                {
                    kind: 'var-decl',
                    name: 'y',
                    valueSet: { type: 'truthvalue' },
                },
            ])
        })

        it('fails when inferred declaration references unknown identifier', () => {
            expect(() => analyze('const y = x')).toThrow(
                "1:11:Unknown identifier 'x'",
            )
        })

        it('fails when redeclaring a variable in the same scope', () => {
            expect(() => analyze('const x = ambiguous\nmut x = true')).toThrow(
                "2:1:Variable 'x' is already declared in this scope",
            )
        })
    })

    describe('variable assignment', () => {
        it('accepts assignment when target and value types match', () => {
            const module = analyze('mut x = ambiguous\nx = true')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'x',
                    valueSet: { type: 'truthvalue' },
                },
                {
                    kind: 'assign',
                    target: { kind: 'identifier', name: 'x' },
                    value: { kind: 'truthvalue', value: 'true' },
                },
            ])
        })

        it('fails when assignment target and value types differ', () => {
            expect(() => analyze('mut x = ambiguous\nx = y')).toThrow(
                "2:5:Unknown identifier 'y'",
            )
        })

        it('fails when assigning to const variable', () => {
            expect(() => analyze('const x = ambiguous\nx = true')).toThrow(
                "2:1:Cannot assign to const variable 'x'",
            )
        })

        it('fails when assignment target type does not match value type', () => {
            expect(() =>
                analyze(
                    'data Point {\n  x: truthvalue\n}\nmut p: Point = { x: true }\nmut t = ambiguous\nt = p',
                ),
            ).toThrow(
                "6:1:Assignment type mismatch: target is 'truthvalue' but value is 'Point'",
            )
        })

        it('fails when assignment target is unknown identifier', () => {
            expect(() => analyze('unknown = ambiguous')).toThrow(
                "1:1:Unknown identifier 'unknown'",
            )
        })
    })

    describe('print statement dispatch annotation', () => {
        it('annotates print dispatch for identifier values', () => {
            const module = analyze('const x = ambiguous\nprint x')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'x',
                    valueSet: { type: 'truthvalue' },
                },
                {
                    kind: 'print',
                    dispatchType: 'truthvalue',
                },
            ])
        })

        it('annotates print dispatch for truthvalue literal values', () => {
            const module = analyze('print true')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'print',
                    dispatchType: 'truthvalue',
                },
            ])
        })

        it('annotates print dispatch for string concatenation values', () => {
            const module = analyze('print "hello" + " world"')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'print',
                    dispatchType: 'string',
                    value: {
                        kind: 'binary',
                        operator: '+',
                        left: { kind: 'string', value: 'hello' },
                        right: { kind: 'string', value: ' world' },
                    },
                },
            ])
        })
    })

    describe('string concatenation typing', () => {
        it('accepts string + string', () => {
            const module = analyze('const s: string = "a" + "b"')
            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 's',
                    valueSet: { type: 'string' },
                    value: {
                        kind: 'binary',
                        operator: '+',
                    },
                },
            ])
        })

        it('rejects non-string operands for +', () => {
            expect(() => analyze('const s: string = "a" + 1')).toThrow(
                "1:23:Operator '+' requires matching operand types, got 'string' and 'integer'",
            )
        })
    })

    describe('binary operator typing', () => {
        it('rewrites integer arithmetic operators to typed semantic operators', () => {
            const module = analyze('const x: integer = 9 - 3 * 2 / 1')
            expect(module.functions[0].body[0]).toMatchObject({
                kind: 'var-decl',
                name: 'x',
                valueSet: { type: 'integer' },
                value: {
                    kind: 'binary',
                    operator: 'integer-sub',
                },
            })
        })

        it('rewrites integer comparisons to typed semantic operators', () => {
            const module = analyze('const x: truthvalue = 1 <= 2')
            expect(module.functions[0].body[0]).toMatchObject({
                kind: 'var-decl',
                name: 'x',
                valueSet: { type: 'truthvalue' },
                value: {
                    kind: 'binary',
                    operator: 'integer-le',
                },
            })
        })

        it('rewrites string equality and inequality to typed semantic operators', () => {
            const eqModule = analyze('const x: truthvalue = "a" == "b"')
            expect(eqModule.functions[0].body[0]).toMatchObject({
                kind: 'var-decl',
                value: { kind: 'binary', operator: 'string-eq' },
            })

            const neModule = analyze('const x: truthvalue = "a" != "b"')
            expect(neModule.functions[0].body[0]).toMatchObject({
                kind: 'var-decl',
                value: { kind: 'binary', operator: 'string-ne' },
            })
        })

        it('rewrites truthvalue logical operators to typed semantic operators', () => {
            const module = analyze('const x: truthvalue = true && false')
            expect(module.functions[0].body[0]).toMatchObject({
                kind: 'var-decl',
                name: 'x',
                valueSet: { type: 'truthvalue' },
                value: {
                    kind: 'binary',
                    operator: 'truthvalue-and',
                },
            })
        })

        it('rejects non-integer operands for arithmetic operators', () => {
            expect(() => analyze('const x: integer = true - 1')).toThrow(
                "1:25:Operator '-' expects integer operands, got 'truthvalue' and 'integer'",
            )
        })

        it('rejects mismatched equality operand types', () => {
            expect(() => analyze('const x: truthvalue = 1 == true')).toThrow(
                "1:25:Operator '==' requires matching operand types, got 'integer' and 'truthvalue'",
            )
        })

        it('rejects non-truthvalue operands for logical operators', () => {
            expect(() => analyze('const x: truthvalue = true && 1')).toThrow(
                "1:28:Operator '&&' expects truthvalue operands, got 'truthvalue' and 'integer'",
            )
        })
    })

    describe('array literals and annotations', () => {
        it('infers array type from homogeneous literals', () => {
            const module = analyze('const xs = [1, 2, 3]')
            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'xs',
                    valueSet: { type: '[integer]' },
                    value: {
                        kind: 'array-literal',
                    },
                },
            ])
        })

        it('rejects mixed element types in array literals', () => {
            expect(() => analyze('const xs = [1, true]')).toThrow(
                "1:16:Array literal element type mismatch: expected 'integer' but got 'truthvalue'",
            )
        })

        it('accepts [T] annotation with matching literal elements', () => {
            const module = analyze('const xs: [integer] = [1, 2]')
            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'xs',
                    valueSet: { type: '[integer]' },
                },
            ])
        })

        it('rejects array element type mismatch against [T] annotation', () => {
            expect(() => analyze('const xs: [truthvalue] = [true, 1]')).toThrow(
                "1:33:Type mismatch for array element: expected 'truthvalue' but got 'integer'",
            )
        })

        it('rejects empty array literal without explicit type context', () => {
            expect(() => analyze('const xs = []')).toThrow(
                '1:12:Cannot infer type for empty array literal; add an explicit annotation',
            )
        })

        it('infers indexed array element type', () => {
            const module = analyze(
                'const xs: [integer] = [1, 2]\nconst x = xs[1]',
            )
            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'xs',
                    valueSet: { type: '[integer]' },
                },
                {
                    kind: 'var-decl',
                    name: 'x',
                    valueSet: { type: 'integer' },
                    value: {
                        kind: 'array-index',
                        elementType: 'integer',
                    },
                },
            ])
        })

        it('rejects non-integer array index expressions', () => {
            expect(() =>
                analyze('const xs: [integer] = [1, 2]\nconst x = xs[true]'),
            ).toThrow("2:13:Array index must be integer, got 'truthvalue'")
        })

        it('infers when expression type from branch values', () => {
            const module = analyze('const x = when true { true => 1, _ => 2 }')
            expect(module.functions[0].body[0]).toMatchObject({
                kind: 'var-decl',
                name: 'x',
                valueSet: { type: 'integer' },
                value: { kind: 'when' },
            })
        })

        it('rejects when expressions without wildcard branch', () => {
            expect(() => analyze('const x = when true { true => 1 }')).toThrow(
                "1:11:when expression requires a wildcard '_' branch for exhaustiveness",
            )
        })

        it('rejects wildcard branch before final position', () => {
            expect(() =>
                analyze('const x = when true { _ => 1, true => 2 }'),
            ).toThrow(
                "1:11:Wildcard pattern '_' must be the last branch in when expression",
            )
        })

        it('rejects when pattern type mismatch', () => {
            expect(() =>
                analyze('const x = when true { 1 => 1, _ => 2 }'),
            ).toThrow(
                "1:23:when pattern type mismatch: expected 'truthvalue' but got 'integer'",
            )
        })
    })

    describe('field access', () => {
        it('converts binary expressions with dot operator into field access expressions', () => {
            const module = analyze(
                'data Point {\n  x: truthvalue\n}\nconst p: Point = { x: true }\nconst x = p.x',
            )

            expect(module.functions[0].body[1]).toMatchObject({
                kind: 'var-decl',
                name: 'x',
                valueSet: { type: 'truthvalue' },
                value: {
                    kind: 'field-access',
                    object: { kind: 'identifier', name: 'p' },
                    field: 'x',
                },
            })
        })

        it('converts dot operator in assignment target into field assignment', () => {
            const module = analyze(
                'data Point {\n  x: truthvalue\n}\nmut p: Point = { x: true }\np.x = true',
            )
            expect(module.types).toMatchObject([
                {
                    kind: 'data-decl',
                    name: 'Point',
                    fields: [{ name: 'x', type: 'truthvalue' }],
                },
            ])
            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    semantics: 'mut',
                    name: 'p',
                    valueSet: { type: 'Point' },
                    value: {
                        kind: 'data-literal',
                        fields: {
                            x: { kind: 'truthvalue', value: 'true' },
                        },
                    },
                },
                {
                    kind: 'assign',
                    target: {
                        kind: 'field-access',
                        object: { kind: 'identifier', name: 'p' },
                        field: 'x',
                    },
                    value: { kind: 'truthvalue', value: 'true' },
                },
            ])
        })

        it('fails when field assignment has mismatched known types', () => {
            expect(() =>
                analyze(
                    'data Point {\n  x: truthvalue\n}\nmut p: Point = { x: true }\np.x = p',
                ),
            ).toThrow(
                "5:1:Assignment type mismatch: target is 'truthvalue' but value is 'Point'",
            )
        })

        it('fails when mutating field through const variable', () => {
            expect(() =>
                analyze(
                    'data Point {\n  x: truthvalue\n}\nconst p: Point = { x: true }\np.x = false',
                ),
            ).toThrow("5:1:Cannot mutate field through const variable 'p'")
        })
    })

    describe('ownership effects', () => {
        it('annotates reference declaration with retain and release-at-exit effects', () => {
            const module = analyze(
                'data Box {\n  value: truthvalue\n}\nconst other: Box = { value: true }\nconst b: Box = other',
            )

            expect(module.functions[0].body[1]).toMatchObject({
                kind: 'var-decl',
                name: 'b',
                ownership: {
                    releaseAtScopeExit: true,
                    retains: [{ kind: 'identifier', name: 'b' }],
                },
            })
        })

        it('rejects declaration crossing semantics without explicit copy', () => {
            expect(() =>
                analyze(
                    'data Box {\n  value: truthvalue\n}\nref shared: Box = { value: true }\nmut isolated: Box = shared',
                ),
            ).toThrow(
                '5:1:Cross-semantics assignment requires explicit copy(...)',
            )
            expect(() =>
                analyze(
                    'data Box {\n  value: truthvalue\n}\nref shared: Box = { value: true }\nmut isolated: Box = shared',
                ),
            ).toThrow('Use copy(shared) to state intent.')
        })

        it('rejects assignment crossing semantics without explicit copy', () => {
            expect(() =>
                analyze(
                    'data Box {\n  value: truthvalue\n}\nref shared: Box = { value: true }\nmut isolated: Box = { value: true }\nisolated = shared',
                ),
            ).toThrow(
                '6:1:Cross-semantics assignment requires explicit copy(...)',
            )
        })

        it('allows declaration crossing semantics with explicit copy', () => {
            const module = analyze(
                'data Box {\n  value: truthvalue\n}\nref shared: Box = { value: true }\nmut isolated: Box = copy(shared)',
            )

            expect(module.functions[0].body[1]).toMatchObject({
                kind: 'var-decl',
                name: 'isolated',
                value: {
                    kind: 'copy',
                    value: { kind: 'identifier', name: 'shared' },
                },
            })
        })

        it('allows assignment crossing semantics with explicit copy', () => {
            const module = analyze(
                'data Box {\n  value: truthvalue\n}\nref shared: Box = { value: true }\nmut isolated: Box = { value: true }\nisolated = copy(shared)',
            )

            expect(module.functions[0].body[2]).toMatchObject({
                kind: 'assign',
                value: {
                    kind: 'copy',
                    value: { kind: 'identifier', name: 'shared' },
                },
            })
        })

        it('rejects copy(...) for non-reference values', () => {
            expect(() => analyze('mut x = copy(true)')).toThrow(
                "1:9:copy(...) expects a reference-counted value, got 'truthvalue'",
            )
        })

        it('annotates nested field assignment with mutate effects', () => {
            const module = analyze(
                'data Inner {\n  value: truthvalue\n}\ndata Outer {\n  inner: Inner\n}\nconst i: Inner = { value: true }\nmut o: Outer = { inner: i }\no.inner.value = true',
            )

            expect(module.functions[0].body[2]).toMatchObject({
                kind: 'assign',
                ownership: {
                    mutates: [
                        { kind: 'identifier', name: 'o' },
                        {
                            kind: 'field-access',
                            object: { kind: 'identifier', name: 'o' },
                            field: 'inner',
                        },
                    ],
                },
            })
        })
    })

    describe('control-flow semantics', () => {
        it('accepts truthvalue if/while conditions', () => {
            const module = analyze(
                'mut x = true\nif x { print true } else { print false }\nwhile x { break }',
            )

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'x',
                    valueSet: { type: 'truthvalue' },
                },
                {
                    kind: 'if',
                    condition: { kind: 'identifier', name: 'x' },
                    thenBranch: [{ kind: 'print' }],
                    elseBranch: [{ kind: 'print' }],
                },
                {
                    kind: 'while',
                    condition: { kind: 'identifier', name: 'x' },
                    body: [{ kind: 'break' }],
                },
            ])
        })

        it('accepts for-in over arrays and binds loop variable type', () => {
            const module = analyze(
                'const xs: [integer] = [1, 2]\nfor x in xs { print x }',
            )

            expect(module.functions[0].body[1]).toMatchObject({
                kind: 'for-in',
                loopVar: 'x',
                elementType: 'integer',
                iterable: { kind: 'identifier', name: 'xs' },
                body: [
                    {
                        kind: 'print',
                        dispatchType: 'integer',
                        value: { kind: 'identifier', name: 'x' },
                    },
                ],
            })
        })

        it('rejects for-in over non-array iterables', () => {
            expect(() =>
                analyze('const x: integer = 1\nfor y in x { print y }'),
            ).toThrow("2:1:for-in iterable must be array, got 'integer'")
        })

        it('rejects non-truthvalue if condition', () => {
            expect(() =>
                analyze(
                    'data Box { value: truthvalue }\nconst b: Box = { value: true }\nif b { print true }',
                ),
            ).toThrow("3:1:if condition must be truthvalue, got 'Box'")
        })

        it('rejects non-truthvalue while condition', () => {
            expect(() =>
                analyze(
                    'data Box { value: truthvalue }\nconst b: Box = { value: true }\nwhile b { break }',
                ),
            ).toThrow("3:1:while condition must be truthvalue, got 'Box'")
        })

        it('rejects break outside while', () => {
            expect(() => analyze('break')).toThrow(
                '1:1:break is only allowed inside a while loop',
            )
        })

        it('rejects continue outside while', () => {
            expect(() => analyze('continue')).toThrow(
                '1:1:continue is only allowed inside a while loop',
            )
        })
    })

    describe('object and service declarations', () => {
        it('surfaces public object declaration in module.objects', () => {
            const module = analyze(
                'object Money { data: const cents: integer }',
            )
            expect(module.objects).toMatchObject([
                { kind: 'object-decl', name: 'Money', visibility: 'public' },
            ])
            expect(module.services).toEqual([])
        })

        it('surfaces helper object declaration with correct visibility', () => {
            const module = analyze('helper object Internal { }')
            expect(module.objects).toMatchObject([
                { kind: 'object-decl', name: 'Internal', visibility: 'helper' },
            ])
        })

        it('surfaces public service declaration in module.services', () => {
            const module = analyze('service UserRepo { }')
            expect(module.services).toMatchObject([
                {
                    kind: 'service-decl',
                    name: 'UserRepo',
                    visibility: 'public',
                },
            ])
            expect(module.objects).toEqual([])
        })

        it('surfaces helper service declaration with correct visibility', () => {
            const module = analyze('helper service InternalRepo { }')
            expect(module.services).toMatchObject([
                {
                    kind: 'service-decl',
                    name: 'InternalRepo',
                    visibility: 'helper',
                },
            ])
        })

        it('registers object name as a reference type for variable declarations', () => {
            // Object types registered via registerTypeDeclaration enter dataTypes,
            // so the name is tracked and the object appears in module.objects.
            const module = analyze(
                'object Account { data: mut balance: truthvalue }\nobject Ledger { }',
            )
            expect(module.objects).toMatchObject([
                { name: 'Account' },
                { name: 'Ledger' },
            ])
        })

        it('does not expose object or service in module.types', () => {
            const module = analyze(
                'data Point { x: truthvalue }\nobject Shape { }\nservice Renderer { }',
            )
            expect(module.types).toMatchObject([{ name: 'Point' }])
            expect(module.types).toHaveLength(1)
        })
    })

    describe('method constraints', () => {
        it('rejects immutable methods without a return type', () => {
            expect(() => analyze('object Counter { func id() { } }')).toThrow(
                "Immutable method 'Counter.id' must declare a return type",
            )
        })

        it('rejects explicit self parameters in methods', () => {
            expect(() =>
                analyze(
                    'object Counter { func id(self: const Counter) -> truthvalue { return true } }',
                ),
            ).toThrow(
                "Parameter name 'self' is reserved for the implicit receiver and may not be declared explicitly",
            )
        })

        it('rejects immutable methods assigning to self fields', () => {
            expect(() =>
                analyze(
                    'data Box { value: truthvalue }\nobject Counter { func set(b: ref Box) -> truthvalue { b.value = true\nreturn true } }',
                ),
            ).toThrow("Immutable method 'Counter' may not assign to a field")
        })

        it('rejects object methods mutating external state', () => {
            expect(() =>
                analyze(
                    'data Box { value: truthvalue }\nobject Counter { mutating: func leak(b: ref Box) { b.value = true } }\nconst box: Box = { value: false }\nconst counter: Counter = { }',
                ),
            ).toThrow("Object methods may not mutate external state via 'b'")
        })

        it('rejects print statements in object methods as external side-effects', () => {
            expect(() =>
                analyze(
                    'object Counter { mutating: func log() { print true } }',
                ),
            ).toThrow(
                'Object methods may not perform external side-effects (print)',
            )
        })

        it('allows calling pure free functions from immutable object methods', () => {
            const module = analyze(
                'func ping() -> truthvalue { return true }\nobject Counter { func ok() -> truthvalue { return ping() } }',
            )

            expect(module.objects).toMatchObject([{ name: 'Counter' }])
        })

        it('rejects calling free functions with side effects from immutable object methods', () => {
            expect(() =>
                analyze(
                    'func poke() -> truthvalue { print true\nreturn true }\nobject Counter { func ok() -> truthvalue { return poke() } }',
                ),
            ).toThrow("Call to 'poke()' is side-effecting (external)")
        })

        it('allows calling pure object methods from mutating object methods', () => {
            const module = analyze(
                'object Counter { func id() -> truthvalue { return true } mutating: func tick(c: const Counter) -> truthvalue { return c.id() } }',
            )

            expect(module.objects).toMatchObject([{ name: 'Counter' }])
        })

        it('rejects mutating object methods calling service methods (external effects)', () => {
            expect(() =>
                analyze(
                    'service Clock { func now() -> truthvalue { return true } }\nobject Counter { mutating: func tick(c: ref Clock) -> truthvalue { return c.now() } }',
                ),
            ).toThrow("Call to 'Clock.now()' is side-effecting (external)")
        })
    })

    describe('inheritance semantics', () => {
        it('rejects object declarations with unknown supertypes', () => {
            expect(() => analyze('object Student: Entity { }')).toThrow(
                "1:1:Unknown supertype 'Entity' for object 'Student'",
            )
        })

        it('rejects object declarations inheriting from non-object types', () => {
            expect(() =>
                analyze(
                    'data Entity { id: truthvalue }\nobject Student: Entity { }',
                ),
            ).toThrow(
                "2:1:Object 'Student' cannot inherit from non-object type 'Entity'",
            )
        })

        it('rejects cyclic object inheritance', () => {
            expect(() =>
                analyze(
                    'object A: B { inheritance: }\nobject B: A { inheritance: }',
                ),
            ).toThrow("1:1:Cyclic inheritance involving 'A'")
        })

        it('allows calling inherited methods on subtype values', () => {
            const module = analyze(
                'object Entity { inheritance: func id() -> truthvalue { return true } }\nobject Student: Entity { }\nconst student: Student = { }\nconst id: truthvalue = student.id()',
            )

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'student',
                    valueSet: { type: 'Student' },
                },
                {
                    kind: 'var-decl',
                    name: 'id',
                    valueSet: { type: 'truthvalue' },
                    value: {
                        kind: 'call',
                        callee: {
                            kind: 'identifier',
                            name: 'Entity·id',
                        },
                        dispatch: {
                            kind: 'virtual',
                            methodName: 'id',
                            ownerType: 'Entity',
                            receiverType: 'Student',
                        },
                    },
                },
            ])
        })

        it('allows assigning subtype values to supertype variables', () => {
            const module = analyze(
                'object Entity { inheritance: }\nobject Student: Entity { }\nconst student: Student = { }\nconst entity: Entity = student',
            )

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'student',
                    valueSet: { type: 'Student' },
                },
                {
                    kind: 'var-decl',
                    name: 'entity',
                    valueSet: { type: 'Entity' },
                },
            ])
        })

        it('rejects overrides with incompatible return types', () => {
            expect(() =>
                analyze(
                    'object Entity { inheritance: func id() -> truthvalue { return true } }\nobject Student: Entity { func id() -> integer { return 1 } }',
                ),
            ).toThrow(
                "2:26:Override 'Student.id()' must match return type 'truthvalue', got 'integer'",
            )
        })

        it('rejects overrides with incompatible effect levels', () => {
            expect(() =>
                analyze(
                    'object Entity { inheritance: func id() -> truthvalue { return true } }\nobject Student: Entity { mutating: func id() -> truthvalue { return true } }',
                ),
            ).toThrow(
                "2:36:Override 'Student.id()' must match effect level 'pure', got 'self-mutation'",
            )
        })

        it('rejects overrides with incompatible parameter semantics', () => {
            expect(() =>
                analyze(
                    'object Entity { inheritance: func link(other: ref Entity) -> truthvalue { return true } }\nobject Student: Entity { func link(other: const Entity) -> truthvalue { return true } }',
                ),
            ).toThrow(
                "2:26:Override 'Student.link(_:)' must match parameter semantics of inherited method",
            )
        })

        it('rejects overrides with incompatible return semantics', () => {
            expect(() =>
                analyze(
                    'object Entity { inheritance: func id() -> ref Entity { return { } } }\nobject Student: Entity { func id() -> Entity { return { } } }',
                ),
            ).toThrow(
                "2:26:Override 'Student.id()' must match return semantics 'ref', got 'unique'",
            )
        })
    })

    describe('service reference restrictions', () => {
        it('rejects non-ref service variables', () => {
            expect(() =>
                analyze('service Clock { }\nconst clock: Clock = { }'),
            ).toThrow(
                "2:1:Service variable 'clock' must be declared as 'ref', got 'const'",
            )
        })

        it('allows ref service variables', () => {
            const module = analyze('service Clock { }\nref clock: Clock = { }')

            expect(module.functions[0].body).toMatchObject([
                {
                    kind: 'var-decl',
                    name: 'clock',
                    semantics: 'ref',
                    valueSet: { type: 'Clock' },
                },
            ])
        })

        it('rejects non-ref service parameters', () => {
            expect(() =>
                analyze('service Clock { }\nfunc use(clock: Clock) { }'),
            ).toThrow("2:10:Service parameter 'clock' must use 'ref' semantics")
        })

        it('rejects service returns without ref return semantics', () => {
            expect(() =>
                analyze(
                    'service Clock { }\nfunc current() -> Clock { return { } }',
                ),
            ).toThrow(
                "2:1:Function 'current' returning service type 'Clock' must declare '-> ref Clock'",
            )
        })

        it('allows service returns with ref return semantics', () => {
            const module = analyze(
                'service Clock { }\nfunc current() -> ref Clock { return { } }',
            )

            expect(
                module.functions.find((f) => f.name === 'current'),
            ).toMatchObject({ returnType: 'Clock', returnSemantics: 'ref' })
        })

        it('rejects service fields inside data and object types', () => {
            expect(() =>
                analyze('service Logger { }\ndata Audit { logger: Logger }'),
            ).toThrow(
                "2:1:Data type 'Audit' cannot contain service field 'logger' of type 'Logger'",
            )

            expect(() =>
                analyze(
                    'service Logger { }\nobject Audit { data: ref logger: Logger }',
                ),
            ).toThrow(
                "2:1:Object 'Audit' cannot contain service field 'logger' of type 'Logger'",
            )
        })

        it('requires ref semantics for service fields inside services', () => {
            expect(() =>
                analyze(
                    'service Logger { }\nservice Repo { data: logger: Logger }',
                ),
            ).toThrow(
                "2:1:Service 'Repo' field 'logger' with service type 'Logger' must use 'ref' semantics",
            )

            const module = analyze(
                'service Logger { }\nservice Repo { data: ref logger: Logger }',
            )
            expect(
                module.services.find((service) => service.name === 'Repo'),
            ).toBeDefined()
        })
    })
})

describe('Function body analysis', () => {
    it('produces a SemanticFunction with name and parameters for a simple func', () => {
        const module = analyze(
            'func identity(x: truthvalue) -> truthvalue { return x }',
        )
        const fn = module.functions.find((f) => f.name === 'identity')
        expect(fn).toMatchObject({
            kind: 'function',
            name: 'identity',
            returnType: 'truthvalue',
            parameters: [{ name: 'x', type: 'truthvalue' }],
        })
    })

    it('preserves return semantics on semantic functions', () => {
        const module = analyze(
            'service Clock { }\nfunc current() -> ref Clock { return { } }',
        )
        const fn = module.functions.find((f) => f.name === 'current')
        expect(fn).toMatchObject({
            returnType: 'Clock',
            returnSemantics: 'ref',
        })
    })

    it('parameter is in scope inside the function body', () => {
        const module = analyze(
            'func echo(x: truthvalue) -> truthvalue { return x }',
        )
        const fn = module.functions.find((f) => f.name === 'echo')
        expect(fn?.body).toMatchObject([
            { kind: 'return', value: { kind: 'identifier', name: 'x' } },
        ])
    })

    it('body statements are fully analyzed (var-decl and return)', () => {
        const module = analyze(
            'func compute(a: truthvalue) -> truthvalue { const b = a\nreturn b }',
        )
        const fn = module.functions.find((f) => f.name === 'compute')
        expect(fn?.body).toMatchObject([
            { kind: 'var-decl', name: 'b' },
            { kind: 'return', value: { kind: 'identifier', name: 'b' } },
        ])
    })

    it('rejects unknown identifier inside function body', () => {
        expect(() => analyze('func bad() { return nope }')).toThrow(
            "Unknown identifier 'nope'",
        )
    })

    it('function names are visible in module scope (forward reference registered)', () => {
        const module = analyze('func go() { }\nconst x = ambiguous')
        const fn = module.functions.find((f) => f.name === 'go')
        expect(fn).toBeDefined()
    })

    it('shorthand body is lowered to an implicit return statement', () => {
        const module = analyze('func yes() -> truthvalue => true')
        const fn = module.functions.find((f) => f.name === 'yes')
        expect(fn?.body).toMatchObject([
            { kind: 'return', value: { kind: 'truthvalue', value: 'true' } },
        ])
    })

    it('shorthand body without return type annotation is rejected', () => {
        expect(() => analyze('func bad() => true')).toThrow(
            "Shorthand body '=> expr' requires a return type annotation",
        )
    })

    it('rejects returning a value from a function without a return type annotation', () => {
        expect(() => analyze('func bad() { return true }')).toThrow(
            'Cannot return a value from a function without a return type annotation',
        )
    })

    it('rejects bare return in a typed function', () => {
        expect(() => analyze('func bad() -> truthvalue { return }')).toThrow(
            "Return statement requires a value of type 'truthvalue'",
        )
    })

    it('rejects return value whose type does not match the function return type', () => {
        expect(() => analyze('func bad() -> truthvalue { return 1 }')).toThrow(
            "Return type mismatch: expected 'truthvalue' but got 'integer'",
        )
    })

    it('rejects shorthand return value whose type does not match the function return type', () => {
        expect(() => analyze('func bad() -> truthvalue => 1')).toThrow(
            "Return type mismatch: expected 'truthvalue' but got 'integer'",
        )
    })

    it('break inside a function body does not see outer loop depth', () => {
        // break outside a while inside a function body — loop depth is reset to 0.
        expect(() =>
            analyze('func f() { while true { break }\nbreak }'),
        ).toThrow('break is only allowed inside a while loop')
    })
})

describe('Call expression analysis', () => {
    it('infers call expression type from function return type', () => {
        const module = analyze(
            'func yes() -> truthvalue { return true }\nconst x = yes()',
        )

        expect(module.functions[0].body).toMatchObject([
            {
                kind: 'var-decl',
                name: 'x',
                valueSet: { type: 'truthvalue' },
                value: {
                    kind: 'call',
                    callee: { kind: 'identifier', name: 'yes' },
                    arguments: [],
                },
            },
        ])
    })

    it('rejects calling unknown identifiers', () => {
        expect(() => analyze('const x = nope()')).toThrow(
            "Unknown identifier 'nope'",
        )
    })

    it('rejects calling non-function identifiers', () => {
        expect(() => analyze('const value = true\nconst x = value()')).toThrow(
            "Cannot call non-function identifier 'value'",
        )
    })

    it('rejects function calls with wrong arity', () => {
        expect(() =>
            analyze(
                'func choose(x: truthvalue, y: truthvalue) -> truthvalue { return x }\nconst z = choose(true)',
            ),
        ).toThrow("Function/method not found 'choose(_:)'")

        expect(() =>
            analyze(
                'func choose(x: truthvalue, y: truthvalue) -> truthvalue { return x }\nconst z = choose(true)',
            ),
        ).toThrow("Did you mean 'choose(_:_:)'?")
    })

    it('rejects function calls with wrong argument types', () => {
        expect(() =>
            analyze(
                'func choose(x: truthvalue, y: truthvalue) -> truthvalue { return x }\nconst z = choose(1, true)',
            ),
        ).toThrow(
            "Argument 1 type mismatch for function 'choose': expected 'truthvalue' but got 'integer'",
        )
    })

    it('accepts function calls when argument types match the signature', () => {
        const module = analyze(
            'func choose(x: truthvalue, y: truthvalue) -> truthvalue { return y }\nconst z = choose(true, ambiguous)',
        )

        expect(module.functions[0].body).toMatchObject([
            {
                kind: 'var-decl',
                name: 'z',
                valueSet: { type: 'truthvalue' },
                value: {
                    kind: 'call',
                    arguments: [
                        { value: { kind: 'truthvalue', value: 'true' } },
                        {
                            value: {
                                kind: 'truthvalue',
                                value: 'ambiguous',
                            },
                        },
                    ],
                },
            },
        ])
    })

    it('resolves overloaded functions by label signature', () => {
        const module = analyze(
            'func adjust(_ value: integer, up amount: integer) -> integer { return value }\nfunc adjust(_ value: integer, down amount: integer) -> integer { return amount }\nconst z = adjust(1, down: 2)',
        )

        expect(module.functions[0].body).toMatchObject([
            {
                kind: 'var-decl',
                name: 'z',
                valueSet: { type: 'integer' },
                value: {
                    kind: 'call',
                    callee: { kind: 'identifier', name: 'adjust' },
                    arguments: [
                        {
                            label: undefined,
                            value: { kind: 'integer', value: 1n },
                        },
                        {
                            label: 'down',
                            value: { kind: 'integer', value: 2n },
                        },
                    ],
                },
            },
        ])
    })

    it('reports function/method not found for wrong labels and suggests a nearby overload', () => {
        expect(() =>
            analyze(
                'func adjust(_ value: integer, up amount: integer) -> integer { return value }\nconst z = adjust(1, down: 2)',
            ),
        ).toThrow("Function/method not found 'adjust(_:down:)'")

        expect(() =>
            analyze(
                'func adjust(_ value: integer, up amount: integer) -> integer { return value }\nconst z = adjust(1, down: 2)',
            ),
        ).toThrow("Did you mean 'adjust(_:up:)'?")
    })

    it('rejects using void functions as value expressions', () => {
        expect(() => analyze('func log() { return }\nconst x = log()')).toThrow(
            "Function 'log' has no return type and cannot be used as a value",
        )
    })

    it('resolves method calls by owner type and label signature', () => {
        const module = analyze(
            'object Counter { mutating: func adjust(down amount: integer) -> integer { return amount } }\nconst counter: Counter = { }\nconst z = counter.adjust(down: 2)',
        )

        expect(module.functions[0].body).toMatchObject([
            {
                kind: 'var-decl',
                name: 'counter',
                valueSet: { type: 'Counter' },
            },
            {
                kind: 'var-decl',
                name: 'z',
                valueSet: { type: 'integer' },
                value: {
                    kind: 'call',
                    callee: { kind: 'identifier', name: 'Counter·adjust' },
                    dispatch: {
                        kind: 'virtual',
                        methodName: 'adjust',
                        ownerType: 'Counter',
                        receiverType: 'Counter',
                    },
                    arguments: [
                        {
                            value: {
                                kind: 'identifier',
                                name: 'counter',
                            },
                        },
                        {
                            label: 'down',
                            value: { kind: 'integer', value: 2n },
                        },
                    ],
                },
            },
        ])
    })

    it('resolves service method calls as direct dispatch', () => {
        const module = analyze(
            'service Clock { func now() -> truthvalue { return true } }\nref clock: Clock = { }\nconst now = clock.now()',
        )

        expect(module.functions[0].body[1]).toMatchObject({
            kind: 'var-decl',
            name: 'now',
            value: {
                kind: 'call',
                callee: { kind: 'identifier', name: 'Clock·now' },
                dispatch: {
                    kind: 'direct',
                    methodName: 'now',
                    ownerType: 'Clock',
                    receiverType: 'Clock',
                },
            },
        })
    })

    it('reports method not found for wrong method labels and suggests nearby overload', () => {
        expect(() =>
            analyze(
                'object Counter { mutating: func adjust(down amount: integer) -> integer { return amount } }\nconst counter: Counter = { }\nconst z = counter.adjust(up: 2)',
            ),
        ).toThrow("Function/method not found 'Counter.adjust(up:)'")

        expect(() =>
            analyze(
                'object Counter { mutating: func adjust(down amount: integer) -> integer { return amount } }\nconst counter: Counter = { }\nconst z = counter.adjust(up: 2)',
            ),
        ).toThrow("Did you mean 'Counter.adjust(down:)'?")
    })

    it('rejects helper method calls from outside declaring type', () => {
        expect(() =>
            analyze(
                'object Counter { helper func secret() -> integer { return 1 } }\nconst counter: Counter = { }\nconst z = counter.secret()',
            ),
        ).toThrow(
            "Method 'Counter.secret()' is helper and only callable inside 'Counter'",
        )
    })
})

function analyze(code: string) {
    const stream = new TokenStream(code, 'test.clawr')
    const parser = new Parser(stream)
    const analyzer = new SemanticAnalyzer(parser.parse())
    return analyzer.analyze()
}
