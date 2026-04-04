declare module 'bun:test' {
    export const describe: DescribeFunction
    export const test: TestFunction
    export const it: TestFunction
    export function expect(value: any): any
    export function afterEach(fn: () => void): void
}

interface DescribeFunction {
    (name: string, fn: () => void): void
    only: (name: string, fn: () => void) => void
    skip: (name: string, fn: () => void) => void
}

interface TestFunction {
    (name: string, fn: () => void): void
    only: (name: string, fn: () => void) => void
    skip: (name: string, fn: () => void) => void
}
