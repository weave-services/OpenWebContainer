import React from 'react';

const commands = [
  { cmd: 'ls', desc: 'List directory contents' },
  { cmd: 'cd [dir]', desc: 'Change directory' },
  { cmd: 'mkdir [name]', desc: 'Create a directory' },
  { cmd: 'touch [file]', desc: 'Create a file' },
  { cmd: 'pwd', desc: 'Print working directory' },
  { cmd: 'clear', desc: 'Clear the terminal' }
];

const CommandReference: React.FC = () => {
  return (
    <div className="bg-gray-800 rounded-lg p-6 mb-8">
      <h2 className="text-lg font-semibold mb-2">Available Commands</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {commands.map(({ cmd, desc }) => (
          <div key={cmd}>
            <code className="text-green-400">{cmd}</code>
            <span className="ml-2 text-gray-300">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CommandReference;