export function positionedError(message: string, position: Position) {
    return new Error(
        `${position.file}:${position.line}:${position.column}:${message}`,
    )
}

type Position = {
    file: string
    line: number
    column: number
}
