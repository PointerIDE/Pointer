const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const tcpPortUsed = require('tcp-port-used');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const runInBackground = args.includes('--background') || args.includes('-b');
const skipChecks = args.includes('--skip-checks') || args.includes('-s');

// Default ports
const BACKEND_PORT = 23816;
const SERVER_PORT = 3000;

// Function to check if a port is in use
async function isPortInUse(port) {
  try {
    const isInUse = await tcpPortUsed.check(port, '127.0.0.1');
    return isInUse;
  } catch (error) {
    console.error(`Error checking if port ${port} is in use:`, error);
    return false;
  }
}

// Function to find an available port starting from the given base port
async function findAvailablePort(basePort, maxAttempts = 10) {
  let port = basePort;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return port;
    }
    port++;
  }
  throw new Error(`Failed to find an available port after ${maxAttempts} attempts starting from ${basePort}`);
}

// Function to start a process with logging
function startProcess(command, args, name, color, env = {}) {
  console.log(chalk[color](`Starting ${name}...`));
  
  const options = { 
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, ...env }
  };
  
  // If running in background mode and this is not the backend process
  if (runInBackground && name !== 'Backend') {
    options.detached = true;
  }
  
  const childProcess = spawn(command, args, options);
  
  childProcess.stdout.on('data', (data) => {
    console.log(chalk[color](`[${name}] ${data.toString().trim()}`));
  });
  
  childProcess.stderr.on('data', (data) => {
    console.error(chalk[color](`[${name} ERROR] ${data.toString().trim()}`));
  });
  
  childProcess.on('close', (code) => {
    console.log(chalk[color](`[${name}] process exited with code ${code}`));
  });
  
  return childProcess;
}

// Main function
async function main() {
  console.log(chalk.blue('Starting Pointer app...'));
  console.log(chalk.blue(`Mode: ${runInBackground ? 'Background' : 'Interactive'}`));
  if (skipChecks) {
    console.log(chalk.yellow('Skip checks mode enabled: bypassing connection checks'));
  }
  
  // Check if backend is already running
  let backendRunning = skipChecks ? true : await isPortInUse(BACKEND_PORT);
  
  let backendProcess = null;
  if (!backendRunning) {
    console.log(chalk.yellow('Backend not running, starting it...'));
    backendProcess = startProcess('py', ['backend/run.py'], 'Backend', 'yellow');
    // Wait for backend to start
    console.log(chalk.yellow('Waiting for backend to start...'));
    try {
      await tcpPortUsed.waitUntilUsed(BACKEND_PORT, 500, 30000);
      console.log(chalk.green('Backend started successfully!'));
    } catch (error) {
      console.error(chalk.red('Backend failed to start within timeout period.'));
      process.exit(1);
    }
  } else {
    console.log(chalk.green('Backend already running.'));
  }
  
  // Find available port for server
  console.log(chalk.blue('Finding available port for server...'));
  const serverPort = await findAvailablePort(SERVER_PORT);
  console.log(chalk.blue(`Using port ${serverPort} for the server.`));
  
  // Start server with custom port
  const serverProcess = startProcess('yarn.cmd', ['dev:server'], 'Server', 'blue', { VITE_PORT: serverPort.toString() });
  
  // Wait a bit for the server to start if not skipping checks
  if (!skipChecks) {
    console.log(chalk.blue(`Waiting for server to start on port ${serverPort}...`));
    try {
      await tcpPortUsed.waitUntilUsed(serverPort, 500, 30000);
      console.log(chalk.green('Server started successfully!'));
    } catch (error) {
      console.error(chalk.red('Server failed to start within timeout period.'));
      if (backendProcess) backendProcess.kill();
      process.exit(1);
    }
  } else {
    console.log(chalk.yellow('Skipping server startup verification'));
  }
  
  // Start electron with custom server port
  const electronProcess = startProcess('yarn.cmd', ['dev:electron'], 'Electron', 'magenta', {
    VITE_DEV_SERVER_PORT: serverPort.toString(),
    SKIP_CONNECTION_CHECKS: skipChecks ? 'true' : 'false'
  });
  
  // If running in background mode, unref the child processes to allow the parent to exit
  if (runInBackground) {
    console.log(chalk.blue('Running in background mode. Press Ctrl+C to detach terminal.'));
    console.log(chalk.blue('Processes will continue running in the background.'));
    
    if (backendProcess) backendProcess.unref();
    serverProcess.unref();
    electronProcess.unref();
    
    // Give some time for processes to stabilize before detaching
    setTimeout(() => {
      console.log(chalk.green('Detaching terminal. Pointer is running in the background.'));
      process.exit(0);
    }, 5000);
  } else {
    // Handle graceful shutdown for interactive mode
    const cleanup = () => {
      console.log(chalk.red('\nShutting down processes...'));
      
      if (backendProcess) backendProcess.kill();
      serverProcess.kill();
      electronProcess.kill();
      
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}

// Run the script
main().catch(error => {
  console.error('Error running Pointer:', error);
  process.exit(1);
}); 