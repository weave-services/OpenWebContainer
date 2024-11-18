# Contributing to OpenWebContainer

First off, thank you for considering contributing to OpenWebContainer! It's people like you that make OpenWebContainer such a great tool.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Commit Guidelines](#commit-guidelines)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to [project maintainers].

## Project Structure

```
open-web-container/
├── apps
│   └── playground
│       ├── README.md
│       ├── eslint.config.js
│       ├── index.html
│       ├── package.json
│       ├── postcss.config.js
│       ├── public
│       │   └── vite.svg
│       ├── src
│       │   ├── App.css
│       │   ├── App.tsx
│       │   ├── assets
│       │   │   └── react.svg
│       │   ├── components
│       │   │   ├── Editor
│       │   │   │   ├── index.tsx
│       │   │   │   └── styles.css
│       │   │   ├── FileExplorer
│       │   │   │   ├── index.tsx
│       │   │   │   └── styles.css
│       │   │   └── Terminal
│       │   │       ├── index.tsx
│       │   │       └── styles.css
│       │   ├── hooks
│       │   │   ├── useContainer.ts
│       │   │   └── useFileTree.ts
│       │   ├── index.css
│       │   ├── main.tsx
│       │   └── vite-env.d.ts
│       ├── tailwind.config.js
│       ├── tsconfig.app.json
│       ├── tsconfig.json
│       ├── tsconfig.node.json
│       └── vite.config.ts
├── commitlint.config.js
├── package.json
├── packageold.json
├── packages
│   └── core
│       ├── package.json
│       ├── pnpm-lock.yaml
│       ├── src
│       │   ├── container.ts
│       │   ├── filesystem
│       │   │   └── virtual-fs.ts
│       │   ├── index.ts
│       │   ├── interfaces
│       │   │   └── index.ts
│       │   ├── process
│       │   │   ├── base.ts
│       │   │   ├── index.ts
│       │   │   ├── javascript.ts
│       │   │   ├── manager.ts
│       │   │   └── shell.ts
│       │   └── shell
│       │       └── shell.ts
│       ├── tsconfig.json
│       └── tsconfig.tsbuildinfo
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── turbo.json
├── .gitignore
└── Readme.md
```

### Key Directories

- `packages/core/`: The main container implementation
  - `filesystem/`: Virtual file system implementation
  - `process/`: Process management and types
  - `shell/`: Shell command implementation
  - `interfaces/`: Core TypeScript interfaces

- `apps/playground/`: Web playground application
  - `components/`: React components
  - `hooks/`: Custom React hooks

## Development Setup

1. **Prerequisites**
   - Node.js (v16 or higher)
   - pnpm (v8 or higher)
   - Git

2. **Initial Setup**
   ```bash
   # Clone the repository
   git clone https://github.com/yourusername/open-web-container.git
   cd open-web-container

   # Install dependencies
   pnpm install
   ```

3. **Development Commands**
   ```bash
   # Start development of all packages
   pnpm dev

   # Start only the playground
   pnpm playground

   # Build all packages
   pnpm build

   # Run tests
   pnpm test

   # Lint code
   pnpm lint
   ```

## Development Workflow

1. **Create a new branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write code
   - Add tests
   - Update documentation
   - Run tests locally

3. **Commit your changes**
   We use conventional commits. Format your commit messages as:
   ```
   type(scope): description

   [optional body]

   [optional footer]
   ```
   Types:
   - feat: New feature
   - fix: Bug fix
   - docs: Documentation
   - chore: Maintenance
   - refactor: Code restructuring
   - test: Adding tests
   - style: Formatting

4. **Create a Pull Request**

## Pull Request Process

1. Ensure your code follows our style guide and passes all tests
2. Update documentation if needed
3. Add tests for new features
4. Ensure the PR description clearly describes the problem and solution
5. Reference any relevant issues

## Commit Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/). Each commit message should be structured as:

```
type(scope): description

[optional body]

[optional footer]
```

Examples:
```
feat(shell): add pipe operator support
fix(filesystem): correct path resolution
docs(readme): update installation instructions
```

## Testing Guidelines

1. **Write tests for new features**
   ```typescript
   describe('VirtualFileSystem', () => {
     it('should create directories', () => {
       // Test code
     });
   });
   ```

2. **Run tests before submitting PR**
   ```bash
   pnpm test
   ```

3. **Ensure good test coverage**
   - Unit tests for utilities
   - Integration tests for features
   - End-to-end tests for workflows

## Documentation

1. **Code Documentation**
   - Use JSDoc comments for functions and classes
   - Explain complex logic
   - Add usage examples

2. **README Updates**
   - Keep installation instructions updated
   - Document new features
   - Update API references

3. **Example Updates**
   - Add examples for new features
   - Keep existing examples up to date

## Adding New Features

1. **Core Package**
   - Add new features in appropriate directories
   - Update interfaces if needed
   - Add tests
   - Update documentation

2. **Playground**
   - Add new components in `apps/playground/src/components`
   - Update playground to showcase new features
   - Ensure responsive design

## Debugging

1. **Core Package**
   ```typescript
   // Enable debug logs
   import { setDebugMode } from '@open-web-container/core';
   setDebugMode(true);
   ```

2. **Playground**
   - Use React DevTools
   - Check console logs
   - Use browser debugger

## Questions?

If you have questions, please:
1. Check existing issues
2. Create a new issue with the 'question' label
3. Join our community discussions

Thank you for contributing! 🎉