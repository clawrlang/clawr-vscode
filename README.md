# Clawr Extension for Visual Studio Code

![Rawr!|150](./images/rawr.png)

[MIT License](./LICENSE)
[How to contribute](./CONTRIBUTING)

> [!quote]
> Let us change our traditional attitude to the construction of programs: Instead of imagining that our main task is to instruct a computer what to do, let us concentrate rather on explaining to human beings what we want a computer to do.
> — Donald Knuth

Clawr is a language with goals of clarity, a modelling focus and easy refactoring. The name is a portmanteau of the word ”clarity,” and a lion’s roar. For more information, see the [concept documentation](https://github.com/clawrlang/clawr-concept)).

## Getting started

This project is written in TypeScript for [Node.js](https://nodejs.org/en/download).

Run `npm install` to fetch needed NPM packages
Run `npm test` to run automated tests

There is a tasks.jaon file that is set up to run `npm test` as a default test task.

- ⇧⌘U: Run unit tests (Mac)

### Run The Extension

Use the built-in launch configuration to run this project as a VS Code extension during development.

1. Run `npm install`.
2. Press `F5` and select **Run Clawr Extension**.
3. In the Extension Development Host window, open the Command Palette and run **Clawr: Hello**.
