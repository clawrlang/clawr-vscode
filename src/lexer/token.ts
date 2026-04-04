import type {
    Keyword,
    Operator,
    PunctuationSymbol,
    TruthLiteral,
} from './kinds'
import { decimal } from 'decimalish'

interface TokenData {
    kind: string
    line: number
    column: number
}

export type Token =
    | NewlineToken
    | KeywordToken
    | IdentifierToken
    | RealLiteralToken
    | IntegerLiteralToken
    | TruthValueLiteralToken
    | StringLiteralToken
    | RegexLiteralToken
    | PunctuationToken
    | OperatorToken

export interface NewlineToken extends TokenData {
    kind: 'NEWLINE'
}
export interface KeywordToken extends TokenData {
    kind: 'KEYWORD'
    keyword: Keyword
}
export interface IdentifierToken extends TokenData {
    kind: 'IDENTIFIER'
    identifier: string
}
export interface RealLiteralToken extends TokenData {
    kind: 'REAL_LITERAL'
    value: decimal
    source: string
}
export interface TruthValueLiteralToken extends TokenData {
    kind: 'TRUTH_LITERAL'
    value: TruthLiteral
}
export interface IntegerLiteralToken extends TokenData {
    kind: 'INTEGER_LITERAL'
    value: bigint
}
export interface StringLiteralToken extends TokenData {
    kind: 'STRING_LITERAL'
    value: string
}
export interface RegexLiteralToken extends TokenData {
    kind: 'REGEX_LITERAL'
    pattern: string
    modifiers?: Set<string>
}
export interface PunctuationToken extends TokenData {
    kind: 'PUNCTUATION'
    symbol: PunctuationSymbol
}
export interface OperatorToken extends TokenData {
    kind: 'OPERATOR'
    operator: Operator
}
