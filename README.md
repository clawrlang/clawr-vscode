# Clawr Compiler

![Rawr!|150](./images/rawr.png)

[MIT License](./LICENSE)
[How to contribute](./CONTRIBUTING)

> [!quote]
> Let us change our traditional attitude to the construction of programs: Instead of imagining that our main task is to instruct a computer what to do, let us concentrate rather on explaining to human beings what we want a computer to do.
> — Donald Knuth

Clawr is a language with goals of clarity, a modelling focus and easy refactoring. The name is a portmanteau of the word ”clarity,” and a lion’s roar. For more information, see the [concept documentation](https://github.com/clawrlang/clawr-concept)).

## CLang

The _codegen_ step of this PoC compiler outputs C code which is then fed to a mainstream C compiler for final binary generation.

I have elected to use the `clang` compiler. This is mainly because I use a Mac, and `clang` is the default Mac compiler. For greater portability, `gcc` or `cc` might be preferred. (Though such change is unlikely to be performed for some time, as `clang` is quite sufficient for now, and I have not yet studied the prevalence nor compatibility of alternative compilers.)

## Getting started

This project is written in TypeScript for [Node.js](https://nodejs.org/en/download).

```sh
npm install
npm run build     # Generate the rwrc executable (in ./dist)
npm run test      # Run unit tests (skipping slow E2E tests)
npm run test:all  # Run all automated tests (including E2E tests)

# Compile a source file (after build)
./dist/rwrc build my_prog.clawr --outdir .

# Alternative command (without building):
npx bun src/rwrc/index.ts build my_prog.clawr --outdir .

# Run the compiled exe (from my_prog.clawr):
./my_prog
```

## Visual Studio Code

The repository includes settings for VS Code.

### Run The Extension

Use the built-in launch configuration to run this project as a VS Code extension during development.

1. Run `npm install`.
2. Press `F5` and select **Run Clawr Extension**.
3. In the Extension Development Host window, open the Command Palette and run **Clawr: Hello**.

### Default Tasks

There is a tasks.jaon file that is set up to run the `npm` scripts from a keyboard shortcut.

- ⇧⌘U: Run unit tests (skip E2E system tests)
- ⇧⌘B: Build the rwrc exe and run the full test suite

> [!note]
> **Windows/Linux Users**
>
> The listed keyboard shortcuts are for Mac, but VS Code also runs on Windows
> and Linux. Keyboard shortcuts can often be translated between operating
> systems by replacing the command (⌘) key with `Ctrl` (or vice versa). If you
> are not on a Mac, try using `Shift+Ctrl+U` and `Shift+Ctrl+B` to run the
> tasks.
