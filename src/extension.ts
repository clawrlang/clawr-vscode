import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext): void {
    const hello = vscode.commands.registerCommand('clawr.hello', () => {
        vscode.window.showInformationMessage('Clawr extension is active.')
    })

    context.subscriptions.push(hello)
}

export function deactivate(): void {}
