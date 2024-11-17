# OpenWebContainer

A browser-based virtual container runtime that enables server-like JavaScript execution environments directly in the browser. OpenWebContainer provides a sandboxed environment with a virtual file system, process management, and shell capabilities, making it possible to run server-side JavaScript applications entirely in the browser.

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## 🚀 Features

- **Virtual File System**
  - Full directory structure support
  - File operations (create, read, write, delete)
  - Path resolution and normalization
  - Module loading capabilities

- **Process Management**
  - Multiple process types (Shell, JavaScript)
  - Process lifecycle management
  - Inter-process communication
  - Event-based architecture

- **Shell Environment**
  - UNIX-like shell commands
  - File redirection (`>`, `>>`)
  - Interactive shell support
  - Working directory management

- **JavaScript Runtime**
  - Isolated execution environments
  - ES Modules support
  - Resource management and cleanup
  - Based on QuickJS for reliable JavaScript execution

## 📦 Installation

```bash
npm install open-web-container
# or
yarn add open-web-container
```

## 🌟 Quick Start

```typescript
import { OpenWebContainer } from 'open-web-container';

async function main() {
  // Create a new container
  const container = new OpenWebContainer();

  // Create a directory and write a JavaScript file
  container.writeFile('/app/hello.js', `
    console.log('Hello from the container!');
    export const message = 'Hello World';
  `);

  // Run a shell command
  const shell = await container.spawn('sh', ['echo', 'Hello', '>', '/app/greeting.txt']);
  
  // Listen for process events
  shell.addEventListener('exit', ({ exitCode }) => {
    console.log('Shell process exited with code:', exitCode);
  });

  // Run a JavaScript file
  const jsProcess = await container.spawn('/app/hello.js');
  
  // Clean up when done
  await container.dispose();
}

main().catch(console.error);
```

## 📚 Documentation

### Creating a Container

```typescript
const container = new OpenWebContainer();
```

### File System Operations

```typescript
// Directory operations
container.createDirectory('/app');
container.listDirectory('/app');
container.deleteDirectory('/app');

// File operations
container.writeFile('/app/script.js', 'console.log("Hello")');
const content = container.readFile('/app/script.js');
container.deleteFile('/app/script.js');
```

### Process Management

```typescript
// Spawn a shell process
const shell = await container.spawn('sh', ['ls', '-l']);

// Spawn a JavaScript process
const process = await container.spawn('/app/script.js');

// Get process information
const pid = process.pid;
const state = process.state;
const exitCode = process.exitCode;

// Process events
process.addEventListener('start', (data) => { /* ... */ });
process.addEventListener('exit', (data) => { /* ... */ });
process.addEventListener('error', (data) => { /* ... */ });
process.addEventListener('message', (data) => { /* ... */ });
```

### Shell Commands

```typescript
// Interactive shell
const shell = await container.spawn('sh');
if (shell instanceof ShellProcess) {
  // Execute commands
  await shell.executeCommand('mkdir /app');
  await shell.executeCommand('echo "Hello" > /app/hello.txt');
  await shell.executeCommand('cat /app/hello.txt');
}
```

## 🛠️ Contributing

We welcome contributions! Here's how you can help:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

### Areas for Contribution

- Additional shell commands
- Pipe (`|`) support
- Environment variables
- Process signals
- File watchers
- Network simulation
- WebSocket support
- Package management simulation
- Testing utilities
- Documentation improvements

## 📝 Roadmap

- [ ] Add pipe support for shell commands
- [ ] Implement environment variables
- [ ] Add signal handling (SIGTERM, SIGKILL, etc.)
- [ ] Create process groups and job control
- [ ] Add network simulation capabilities
- [ ] Implement a package management system
- [ ] Add support for WebSocket simulation
- [ ] Create development tools and debugging capabilities

## 🧪 Testing

```bash
npm test
# or
yarn test
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Acknowledgments

- [QuickJS](https://bellard.org/quickjs/) - The JavaScript engine used in this project
- [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) - WebAssembly build of QuickJS

## 💬 Support

- Create an issue for bug reports or feature requests

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yourusername/open-web-container&type=Date)](https://star-history.com/#yourusername/open-web-container&Date)