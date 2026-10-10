## Backend

using Node.js, typescript, package manager npm

## Requirements

- Node.js 24.x (justification: Stable LTS)
- npm 11+

## Setup

### 1. Check if you have node, npm and git

```
node --version
npm --version
git --version
```

### 2. Go to mifplace folder in Command Prompt and run these commands, scripts

```
cd backend

npm install

npm run build

npm start
```

### 3. The server should now be running at:

http://127.0.0.1:3000

## Scripts

- `npm run build` — Compile TypeScript
- `npm run watch` — Auto-compile on changes
- `npm start` — Start the server
- `npm run lint` — Check code with ESLint
- `npm run format` — Format code with Prettier

## Editor Setup

### Recommended VS Code Extensions

- **ESLint** (`dbaeumer.vscode-eslint`) — for error checking
- **Prettier** (`esbenp.prettier-vscode`) — for formatting

### How to install

1. Open VS Code
2. Press `Ctrl + Shift + X`
3. Search for "dbaeumer.vscode-eslint" then Install
4. Search for "esbenp.prettier-vscode" then Install

### VS Code Settings after installing

1. Press `Ctrl + Shift + P`
2. Search for Preferences: Open Settings (UI)
3. then search format
4. Checkmark on Editor: Format on save
5. Change Editor: Default formatter on dropdown to Prettier - Code formatter
