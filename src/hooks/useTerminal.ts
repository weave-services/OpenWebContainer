import { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { WasmFs } from '@wasmer/wasmfs';

const wasmFs = new WasmFs();
let currentPath = '/';

export const useTerminal = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const executeCommand = useCallback(async (command: string): Promise<string> => {
    const [cmd, ...args] = command.trim().split(' ');
    
    switch (cmd) {
      case 'ls':
        try {
          const files = await wasmFs.readdir(currentPath);
          return files.join('  ');
        } catch (error) {
          return `ls: cannot access '${currentPath}': No such file or directory`;
        }
      
      case 'cd':
        const newPath = args[0] || '/';
        try {
          const stats = await wasmFs.stat(newPath);
          if (stats.isDirectory()) {
            currentPath = newPath;
            return '';
          }
          return `cd: not a directory: ${newPath}`;
        } catch {
          return `cd: no such file or directory: ${newPath}`;
        }
      
      case 'mkdir':
        if (!args[0]) return 'mkdir: missing operand';
        try {
          await wasmFs.mkdir(args[0]);
          return '';
        } catch {
          return `mkdir: cannot create directory '${args[0]}'`;
        }
      
      case 'touch':
        if (!args[0]) return 'touch: missing file operand';
        try {
          await wasmFs.writeFile(args[0], '');
          return '';
        } catch {
          return `touch: cannot touch '${args[0]}'`;
        }
      
      case 'pwd':
        return currentPath;
      
      case 'clear':
        xtermRef.current?.clear();
        return '';
      
      case 'help':
        return 'Available commands: ls, cd, mkdir, touch, pwd, clear, help';
      
      default:
        return `Command not found: ${cmd}`;
    }
  }, []);

  const initTerminal = useCallback(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selection: '#33467C',
        black: '#32344a',
        blue: '#7aa2f7',
        cyan: '#449dab',
        green: '#9ece6a',
        magenta: '#ad8ee6',
        red: '#f7768e',
        white: '#787c99',
        yellow: '#e0af68'
      }
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    return { term, fitAddon };
  }, []);

  const setupTerminal = useCallback(() => {
    if (!terminalRef.current) return;

    const result = initTerminal();
    if (!result) return;

    const { term, fitAddon } = result;
    
    term.open(terminalRef.current);
    
    // Ensure the terminal is properly sized before fitting
    setTimeout(() => {
      if (terminalRef.current) {
        fitAddon.fit();
      }
    }, 0);

    term.writeln('WebAssembly Terminal v1.0.0');
    term.writeln('Type "help" for available commands\n');
    term.write('$ ');

    let commandBuffer = '';

    term.onKey(({ key, domEvent }) => {
      const char = key;
      
      if (domEvent.keyCode === 13) { // Enter
        term.write('\r\n');
        if (commandBuffer.trim()) {
          executeCommand(commandBuffer).then(output => {
            if (output) {
              term.writeln(output);
            }
            term.write('$ ');
          });
        } else {
          term.write('$ ');
        }
        commandBuffer = '';
      } else if (domEvent.keyCode === 8) { // Backspace
        if (commandBuffer.length > 0) {
          commandBuffer = commandBuffer.slice(0, -1);
          term.write('\b \b');
        }
      } else if (char.length === 1) {
        commandBuffer += char;
        term.write(char);
      }
    });
  }, [executeCommand, initTerminal]);

  useEffect(() => {
    setupTerminal();

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (xtermRef.current) {
        xtermRef.current.dispose();
      }
    };
  }, [setupTerminal]);

  return { terminalRef };
};