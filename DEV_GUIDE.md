# 🚀 Smart POS Development Helper

**Project status:** [STATUS.md](./STATUS.md)

This helper script and VS Code tasks make it easy to switch between frontend and backend development without confusion about which commands to run where.

## 🎯 Quick Start

### Using the Command Line Helper

```bash
# Show project status
node dev-helper.js status

# Start frontend development server
node dev-helper.js frontend run dev

# Start backend development server  
node dev-helper.js backend run dev

# Start both servers at once
node dev-helper.js start

# Install all dependencies
node dev-helper.js install

# Run database migrations
node dev-helper.js migrate

# Run tests
node dev-helper.js test
```

### Using VS Code Tasks (Recommended)

Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) and type "Tasks: Run Task" to see all available tasks:

- **🎯 Show Project Status** - Check if everything is set up correctly
- **🚀 Start Frontend Dev Server** - Runs on http://localhost:5173
- **⚡ Start Backend Dev Server** - Runs on http://localhost:4000
- **🎬 Start Both Servers** - Starts both frontend and backend
- **🏗️ Install All Dependencies** - Installs npm packages for both projects
- **🗄️ Run Database Migration** - Updates the database schema
- **🧪 Run All Tests** - Runs tests for both projects

## 📁 Project Structure

```
POSPROJECT/
├── dev-helper.js                 # Development helper script
├── smart-pos-frontend/           # React frontend (Port 5173)
│   ├── src/
│   ├── package.json
│   └── ...
├── smart-pos-backend/            # Node.js backend (Port 4000)
│   ├── routes/
│   ├── prisma/
│   ├── package.json
│   └── ...
└── .vscode/
    └── tasks.json                # VS Code tasks configuration
```

## 🔧 Common Development Workflows

### Starting Development
1. Run **🎯 Show Project Status** to check everything is ready
2. If dependencies are missing, run **🏗️ Install All Dependencies**
3. If database needs setup, run **🗄️ Run Database Migration**
4. Run **🎬 Start Both Servers** to start development

### Working on Frontend Only
1. Run **🚀 Start Frontend Dev Server**
2. Open http://localhost:5173 in your browser
3. Make sure backend is also running for API calls

### Working on Backend Only
1. Run **⚡ Start Backend Dev Server**
2. Backend will be available at http://localhost:4000
3. Use tools like Postman to test API endpoints

### Database Changes
1. Edit `smart-pos-backend/prisma/schema.prisma`
2. Run **🗄️ Run Database Migration**
3. Restart backend server if needed

## 🚨 Troubleshooting

### "Command not found" errors
- Make sure you're in the root directory (`POSPROJECT/`)
- Check that Node.js is installed: `node --version`

### Port already in use
- Frontend (5173): Stop any other Vite servers
- Backend (4000): Stop any other Node.js servers
- Use `netstat -an | findstr :5173` (Windows) to check ports

### Database migration fails
1. Check the schema syntax in `prisma/schema.prisma`
2. Ensure Postgres is running: `cd smart-pos-backend && npm run db:up`
3. Verify `DATABASE_URL` in `.env` matches your Postgres instance
4. Check migration state: `cd smart-pos-backend && npx prisma migrate status`
5. Try **🏷️ Backend: Reset Database** if needed (destructive)

### Dependencies issues
1. Delete `node_modules` folders in both frontend and backend
2. Run **🏗️ Install All Dependencies**
3. If that fails, run installations manually in each folder

## 💡 Pro Tips

1. **Use VS Code Tasks**: They're faster than typing commands
2. **Keep both servers running**: Frontend needs backend for API calls
3. **Check status first**: Always run status check when starting work
4. **Terminal panels**: VS Code will open separate terminals for each server
5. **Hot reload**: Both frontend and backend support hot reload during development

## 📞 Need Help?

If you encounter issues:
1. Run **🎯 Show Project Status** to diagnose problems
2. Check the terminal output for specific error messages
3. Make sure all dependencies are installed
4. Verify database is properly set up

Happy coding! 🎉
