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
const buildOnly = args.includes('--build') || args.includes('-B');
const showHelp = args.includes('--help') || args.includes('-h');

// Default ports
const BACKEND_PORT = process.env.BACKEND_PORT || 23816;
const SERVER_PORT = process.env.SERVER_PORT || 3000;

// Display help message
if (showHelp) {
  console.log(chalk.cyan(`
╔════════════════════════════════════════════════════════════════╗
║          Pointer IDE - Development Start Script                ║
╚════════════════════════════════════════════════════════════════╝

Usage: node start-pointer.js [options]

Options:
  -b, --background              Run in background mode
  -s, --skip-checks             Skip connection checks
  -B, --build                   Build only (don't start)
  -h, --help                    Show this help message

Environment Variables:
  BACKEND_PORT                  Backend port (default: 23816)
  SERVER_PORT                   Dev server port (default: 3000)
  SKIP_CONNECTION_CHECKS        Skip connection validation

Examples:
  node start-pointer.js                    # Normal mode with checks
  node start-pointer.js --background       # Run in background
  node start-pointer.js --build            # Build only
  BACKEND_PORT=8000 node start-pointer.js  # Custom backend port

  `));
  process.exit(0);
}

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

// Function to verify project structure and dependencies
async function verifyProjectSetup(strict = false) {
  console.log(chalk.blue('\n📋 Verifying project setup...'));
  
  // Check if we're in the root directory with App subfolder
  const appDir = path.join(process.cwd(), 'App');
  const isSplitStructure = fs.existsSync(appDir);
  
  const checkDir = isSplitStructure ? appDir : process.cwd();
  
  // Essential directories - at least src should exist
  const essentialDirs = [
    'src'
  ];
  
  // Optional directories
  const optionalDirs = [
    'public',
    'backend',
    'electron',
    'server'
  ];
  
  const requiredFiles = [
    'package.json',
    'vite.config.ts',
    'tsconfig.json'
  ];
  
  // Check essential directories
  for (const dir of essentialDirs) {
    if (!fs.existsSync(path.join(checkDir, dir))) {
      throw new Error(`❌ Required directory missing: ${dir}`);
    }
  }
  
  // Check files (only if strict mode)
  if (strict) {
    for (const file of requiredFiles) {
      if (!fs.existsSync(path.join(checkDir, file))) {
        throw new Error(`❌ Required file missing: ${file}`);
      }
    }
  }
  
  if (isSplitStructure) {
    console.log(chalk.cyan('  📁 Split structure detected (App/ subdirectory)'));
  }
  
  console.log(chalk.green('✅ Project structure verified'));
}

// Function to check if node_modules exists and install if needed
function checkNodeModules(location = '.') {
  const modulePath = path.join(location, 'node_modules');
  if (!fs.existsSync(modulePath)) {
    console.log(chalk.yellow('\n⚠️  node_modules not found. Installing dependencies...'));
    const { execSync } = require('child_process');
    try {
      const cwd = location;
      console.log(chalk.blue(`   📦 Installing in: ${cwd}`));
      execSync('npm install', { stdio: 'inherit', cwd });
      console.log(chalk.green('✅ Dependencies installed'));
    } catch (error) {
      throw new Error(`Failed to install dependencies in ${location}`);
    }
  }
}

// Function to ensure script dependencies are available
function ensureScriptDependencies() {
  const requiredModules = ['tcp-port-used', 'chalk'];
  let missingModules = [];
  
  for (const module of requiredModules) {
    try {
      require.resolve(module);
    } catch (error) {
      missingModules.push(module);
    }
  }
  
  if (missingModules.length > 0) {
    console.log(chalk.yellow(`⚠️  Missing script dependencies: ${missingModules.join(', ')}`));
    console.log(chalk.yellow('   Installing...\n'));
    const { execSync } = require('child_process');
    try {
      execSync(`npm install ${missingModules.join(' ')}`, { stdio: 'inherit' });
      console.log(chalk.green('✅ Script dependencies installed\n'));
    } catch (error) {
      throw new Error('Failed to install script dependencies');
    }
  }
}

// Function to build the project
async function buildProject() {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue('\n🔨 Building project...'));
    
    // Determine build directory
    const appDir = path.join(process.cwd(), 'App');
    const buildDir = fs.existsSync(appDir) ? appDir : process.cwd();
    
    console.log(chalk.cyan(`   📁 Building in: ${buildDir}`));
    
    // Use npm instead of yarn.cmd (more reliable)
    const buildProcess = spawn('npm', ['run', 'build'], {
      stdio: 'inherit',
      shell: true,
      cwd: buildDir
    });
    
    buildProcess.on('close', (code) => {
      if (code === 0) {
        console.log(chalk.green('✅ Build completed'));
        resolve();
      } else {
        reject(new Error(`Build failed with exit code ${code}`));
      }
    });
    
    buildProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// Function to test backend connection
async function testBackendHealth(port, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { exec } = require('child_process');
      await execAsync(`curl -s http://localhost:${port}/health`, {
        timeout: 5000
      });
      return true;
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(chalk.yellow(`  ⏳ Backend health check attempt ${attempt}/${maxRetries}...`));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  return false;
}

// Function to test server connection
async function testServerHealth(port, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const inUse = await isPortInUse(port);
      if (inUse) {
        return true;
      }
      if (attempt < maxRetries) {
        console.log(chalk.yellow(`  ⏳ Server health check attempt ${attempt}/${maxRetries}...`));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  return false;
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
  console.log(chalk[color](`\n▶️  Starting ${name}...`));
  
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
    const output = data.toString().trim();
    if (output) {
      console.log(chalk[color](`[${name}] ${output}`));
    }
  });
  
  childProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.error(chalk.red(`[${name} ERROR] ${output}`));
    }
  });
  
  childProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(chalk.red(`[${name}] ⚠️  Process exited with code ${code}`));
    } else {
      console.log(chalk.green(`[${name}] ✅ Process exited cleanly`));
    }
  });
  
  childProcess.on('error', (err) => {
    console.error(chalk.red(`[${name}] Failed to start: ${err.message}`));
  });
  
  return childProcess;
}

// Main function
async function main() {
  try {
    // Ensure script dependencies first
    ensureScriptDependencies();
    
    console.log(chalk.cyan(`
╔════════════════════════════════════════════════════════════════╗
║                    Pointer IDE Starter                         ║
╚════════════════════════════════════════════════════════════════╝
    `));
    
    console.log(chalk.blue(`Mode: ${runInBackground ? '🔄 Background' : '⚡ Interactive'}`));
    if (skipChecks) {
      console.log(chalk.yellow('⚠️  Skip checks mode enabled'));
    }
    
    // Verify project setup (non-strict for build mode)
    await verifyProjectSetup(false);
    
    // Check root node_modules
    checkNodeModules('.');
    
    // Check App node_modules
    if (fs.existsSync(path.join(process.cwd(), 'App'))) {
      checkNodeModules(path.join(process.cwd(), 'App'));
    }
    
    // Build only mode
    if (buildOnly) {
      await buildProject();
      console.log(chalk.green('\n✅ Build completed successfully'));
      process.exit(0);
    }
    
    // Check if backend is already running
    console.log(chalk.blue(`\n🔍 Checking if backend is running on port ${BACKEND_PORT}...`));
    let backendRunning = skipChecks ? true : await isPortInUse(BACKEND_PORT);
    
    let backendProcess = null;
    if (!backendRunning) {
      console.log(chalk.yellow(`Backend not detected on port ${BACKEND_PORT}`));
      backendProcess = startProcess('py', ['backend/run.py'], 'Backend', 'yellow');
      
      // Wait for backend to start
      console.log(chalk.yellow('⏳ Waiting for backend to initialize...'));
      try {
        await tcpPortUsed.waitUntilUsed(BACKEND_PORT, 500, 30000);
        
        // Additional health check
        if (!skipChecks) {
          const isHealthy = await testBackendHealth(BACKEND_PORT);
          if (isHealthy) {
            console.log(chalk.green('✅ Backend is healthy'));
          } else {
            console.log(chalk.yellow('⚠️  Backend is running but health check failed'));
          }
        }
        
        console.log(chalk.green('✅ Backend started successfully!'));
      } catch (error) {
        console.error(chalk.red('❌ Backend failed to start within timeout period.'));
        console.log(chalk.red('   Try: python backend/run.py'));
        if (backendProcess) backendProcess.kill();
        process.exit(1);
      }
    } else {
      console.log(chalk.green('✅ Backend already running'));
    }
    
    // Find available port for server
    console.log(chalk.blue(`\n🔍 Finding available port for dev server (starting from ${SERVER_PORT})...`));
    const serverPort = await findAvailablePort(SERVER_PORT);
    console.log(chalk.blue(`📍 Using port ${serverPort} for dev server`));
    
    // Start server with custom port
    const serverProcess = startProcess('npm', ['run', 'dev:server'], 'Server', 'blue', { VITE_PORT: serverPort.toString() });
    
    // Wait for server to start if not skipping checks
    if (!skipChecks) {
      console.log(chalk.blue(`⏳ Waiting for dev server to initialize on port ${serverPort}...`));
      try {
        const isHealthy = await testServerHealth(serverPort);
        if (isHealthy) {
          console.log(chalk.green('✅ Dev server started successfully!'));
        } else {
          throw new Error('Server health check failed');
        }
      } catch (error) {
        console.error(chalk.red('❌ Dev server failed to start within timeout period.'));
        console.log(chalk.red('   Try: yarn dev:server'));
        if (backendProcess) backendProcess.kill();
        serverProcess.kill();
        process.exit(1);
      }
    } else {
      console.log(chalk.yellow('⏭️  Skipping server startup verification'));
    }
    
    // Start electron with custom server port
    const electronProcess = startProcess('npm', ['run', 'dev:electron'], 'Electron', 'magenta', {
      VITE_DEV_SERVER_PORT: serverPort.toString(),
      SKIP_CONNECTION_CHECKS: skipChecks ? 'true' : 'false'
    });
    
    // If running in background mode, unref the child processes to allow the parent to exit
    if (runInBackground) {
      console.log(chalk.cyan(`
╔════════════════════════════════════════════════════════════════╗
║              ✅ Pointer running in background                  ║
║              All services are now active                        ║
║              Close this terminal to detach                      ║
╚════════════════════════════════════════════════════════════════╝
      `));
      
      if (backendProcess) backendProcess.unref();
      serverProcess.unref();
      electronProcess.unref();
      
      // Give some time for processes to stabilize before detaching
      setTimeout(() => {
        console.log(chalk.green('\n🎉 Background mode activated - Terminal can be closed'));
        process.exit(0);
      }, 5000);
    } else {
      // Handle graceful shutdown for interactive mode
      const cleanup = () => {
        console.log(chalk.red('\n\n🛑 Shutting down Pointer...'));
        
        if (backendProcess) {
          console.log(chalk.yellow('  • Stopping backend...'));
          backendProcess.kill();
        }
        console.log(chalk.yellow('  • Stopping dev server...'));
        serverProcess.kill();
        console.log(chalk.yellow('  • Stopping electron...'));
        electronProcess.kill();
        
        setTimeout(() => {
          console.log(chalk.green('✅ All services stopped'));
          process.exit(0);
        }, 1000);
      };
      
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      
      console.log(chalk.cyan(`
╔════════════════════════════════════════════════════════════════╗
║                  ✅ Pointer is running                         ║
║        Backend: http://localhost:${BACKEND_PORT}                      
║        Server: http://localhost:${serverPort}                       
║      Press Ctrl+C to stop all services                          ║
╚════════════════════════════════════════════════════════════════╝
      `));
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Error starting Pointer:'));
    console.error(chalk.red(`   ${error.message}`));
    console.log(chalk.yellow('\n💡 Tips:'));
    console.log(chalk.yellow('   • Check backend/run.py is valid'));
    console.log(chalk.yellow('   • Ensure ports 23816 and 3000 are available'));
    console.log(chalk.yellow('   • Run: yarn install first'));
    console.log(chalk.yellow('   • View help: node start-pointer.js --help\n'));
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Error running Pointer:', error);
  process.exit(1);
}); 