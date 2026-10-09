## Backend

using Node.js, typescript, package manager npm

## Requirements


- Node.js 20+
- npm 10+
- Git

## Setup

### 1. Check if you have node, npm and git

   - Open cmd

   - node --version

   - npm --version

   - git --version

### 2. If cmd writes external command does not exist

   - Go to https://nodejs.org/en/download and install Windows Installer (.msi)

   - press okay to all

   - install git https://git-scm.com/install/windows

   - repeat step 1.

### 3. if step 1. works start here

   - choose where you want to clone the project for example:
   
     cd C:\Users\your-username\Documents

   - git clone https://github.com/vu-mif-tldr/mifplace.git

### 4. go to where you cloned the project

   - cd mifplace

   - git status 

### 5. if git status says nothing to commit, working tree clean go forward

   - cd backend

   - npm install

   - npm run build
 
   - npm start

### 6. The server should now be running at:

   http://127.0.0.1:3000

## Scripts
- `npm run build` — Compile TypeScript
- `npm run watch` — Auto-compile on changes
- `npm start` — Start the server

