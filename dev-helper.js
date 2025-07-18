#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Project paths
const BACKEND_PATH = path.join(__dirname, 'smart-pos-backend');
const FRONTEND_PATH = path.join(__dirname, 'smart-pos-frontend');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function execCommand(command, cwd, description) {
  log(`\n🔄 ${description}`, 'cyan');
  log(`📁 Directory: ${cwd}`, 'yellow');
  log(`⚡ Command: ${command}`, 'blue');
  
  try {
    const output = execSync(command, { cwd, encoding: 'utf8', stdio: 'inherit' });
    log(`✅ ${description} completed successfully`, 'green');
    return true;
  } catch (error) {
    log(`❌ Error in ${description}: ${error.message}`, 'red');
    return false;
  }
}

function showHelp() {
  log('\n🚀 Smart POS Development Helper', 'bright');
  log('================================', 'cyan');
  log('\nAvailable commands:', 'yellow');
  log('  dev-helper.js frontend [command]  - Run frontend commands', 'blue');
  log('  dev-helper.js backend [command]   - Run backend commands', 'blue');
  log('  dev-helper.js status             - Show project status', 'blue');
  log('  dev-helper.js start              - Start both frontend and backend', 'blue');
  log('  dev-helper.js install            - Install dependencies for both projects', 'blue');
  log('  dev-helper.js migrate            - Run Prisma migrations', 'blue');
  log('  dev-helper.js test               - Run tests for both projects', 'blue');
  log('\nExamples:', 'yellow');
  log('  node dev-helper.js frontend dev        # Start frontend dev server', 'green');
  log('  node dev-helper.js backend dev         # Start backend dev server', 'green');
  log('  node dev-helper.js migrate             # Run database migrations', 'green');
  log('  node dev-helper.js status              # Check project status', 'green');
}

function showStatus() {
  log('\n📊 Smart POS Project Status', 'bright');
  log('===========================', 'cyan');
  
  // Check if directories exist
  const backendExists = fs.existsSync(BACKEND_PATH);
  const frontendExists = fs.existsSync(FRONTEND_PATH);
  
  log(`\n📁 Backend: ${backendExists ? '✅ Found' : '❌ Missing'}`, backendExists ? 'green' : 'red');
  log(`📁 Frontend: ${frontendExists ? '✅ Found' : '❌ Missing'}`, frontendExists ? 'green' : 'red');
  
  // Check package.json files
  if (backendExists) {
    const backendPackage = path.join(BACKEND_PATH, 'package.json');
    const hasBackendPackage = fs.existsSync(backendPackage);
    log(`📦 Backend package.json: ${hasBackendPackage ? '✅ Found' : '❌ Missing'}`, hasBackendPackage ? 'green' : 'red');
  }
  
  if (frontendExists) {
    const frontendPackage = path.join(FRONTEND_PATH, 'package.json');
    const hasFrontendPackage = fs.existsSync(frontendPackage);
    log(`📦 Frontend package.json: ${hasFrontendPackage ? '✅ Found' : '❌ Missing'}`, hasFrontendPackage ? 'green' : 'red');
  }
  
  // Check node_modules
  const backendModules = fs.existsSync(path.join(BACKEND_PATH, 'node_modules'));
  const frontendModules = fs.existsSync(path.join(FRONTEND_PATH, 'node_modules'));
  
  log(`📚 Backend dependencies: ${backendModules ? '✅ Installed' : '❌ Missing'}`, backendModules ? 'green' : 'red');
  log(`📚 Frontend dependencies: ${frontendModules ? '✅ Installed' : '❌ Missing'}`, frontendModules ? 'green' : 'red');
  
  // Check database
  const dbFile = path.join(BACKEND_PATH, 'prisma', 'dev.db');
  const hasDb = fs.existsSync(dbFile);
  log(`🗄️  Database: ${hasDb ? '✅ Found' : '❌ Missing'}`, hasDb ? 'green' : 'red');
}

function installDependencies() {
  log('\n📦 Installing Dependencies', 'bright');
  log('==========================', 'cyan');
  
  const backendSuccess = execCommand('npm install', BACKEND_PATH, 'Installing backend dependencies');
  const frontendSuccess = execCommand('npm install', FRONTEND_PATH, 'Installing frontend dependencies');
  
  if (backendSuccess && frontendSuccess) {
    log('\n🎉 All dependencies installed successfully!', 'green');
  } else {
    log('\n⚠️  Some installations failed. Check the output above.', 'yellow');
  }
}

function runMigrations() {
  log('\n🗄️  Running Database Migrations', 'bright');
  log('===============================', 'cyan');
  
  const success = execCommand('npx prisma migrate dev --name update-schema', BACKEND_PATH, 'Running Prisma migrations');
  
  if (success) {
    log('\n🎉 Database migrations completed successfully!', 'green');
  } else {
    log('\n⚠️  Migration failed. Check the output above.', 'yellow');
  }
}

function startBoth() {
  log('\n🚀 Starting Both Frontend and Backend', 'bright');
  log('=====================================', 'cyan');
  log('\n⚠️  This will start both servers. You\'ll need separate terminals to manage them.', 'yellow');
  log('Backend will run on: http://localhost:4000', 'blue');
  log('Frontend will run on: http://localhost:5173', 'blue');
  log('\nPress Ctrl+C to stop each server individually.\n', 'yellow');
  
  // Start backend in background
  log('🔄 Starting backend server...', 'cyan');
  const { spawn } = require('child_process');
  
  const backend = spawn('npm', ['run', 'dev'], { 
    cwd: BACKEND_PATH, 
    stdio: 'inherit',
    shell: true 
  });
  
  // Wait a moment then start frontend
  setTimeout(() => {
    log('🔄 Starting frontend server...', 'cyan');
    const frontend = spawn('npm', ['run', 'dev'], { 
      cwd: FRONTEND_PATH, 
      stdio: 'inherit',
      shell: true 
    });
  }, 3000);
}

function runTests() {
  log('\n🧪 Running Tests', 'bright');
  log('================', 'cyan');
  
  const backendSuccess = execCommand('npm test', BACKEND_PATH, 'Running backend tests');
  
  // Check if frontend has tests
  const frontendPackage = require(path.join(FRONTEND_PATH, 'package.json'));
  if (frontendPackage.scripts && frontendPackage.scripts.test) {
    const frontendSuccess = execCommand('npm test', FRONTEND_PATH, 'Running frontend tests');
  } else {
    log('📝 No frontend tests configured', 'yellow');
  }
}

// Main command handler
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    return;
  }
  
  const command = args[0];
  const subCommand = args.slice(1).join(' ');
  
  switch (command) {
    case 'frontend':
      if (!subCommand) {
        log('❌ Please specify a frontend command', 'red');
        log('Example: node dev-helper.js frontend dev', 'yellow');
        return;
      }
      execCommand(`npm ${subCommand}`, FRONTEND_PATH, `Running frontend command: ${subCommand}`);
      break;
      
    case 'backend':
      if (!subCommand) {
        log('❌ Please specify a backend command', 'red');
        log('Example: node dev-helper.js backend dev', 'yellow');
        return;
      }
      execCommand(`npm ${subCommand}`, BACKEND_PATH, `Running backend command: ${subCommand}`);
      break;
      
    case 'status':
      showStatus();
      break;
      
    case 'start':
      startBoth();
      break;
      
    case 'install':
      installDependencies();
      break;
      
    case 'migrate':
      runMigrations();
      break;
      
    case 'test':
      runTests();
      break;
      
    default:
      log(`❌ Unknown command: ${command}`, 'red');
      showHelp();
  }
}

// Run the script
main();
