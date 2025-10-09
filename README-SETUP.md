Nice Game Playstation - WebPOS (Dark Mode + Admin Login) - Ready for Render
========================================================================

What's inside:
- backend/  (Express + better-sqlite3) - port 3001
- frontend/ (Vite + React)

Default admin credentials:
- username: admin
- password: 123456

Local setup (quick):
1. Install Node.js (18+)
2. cd backend
   npm install
   npm start
   -> API at http://localhost:3001
3. cd frontend
   npm install
   npm run dev
   -> Frontend at http://localhost:5173

Deploy to Render (quick guide):
1. Create a GitHub repo and push this project.
2. Create a new Web Service on Render -> connect to the backend folder (set build command: 'npm install && npm run start', start command: 'npm start').
3. Create a Static Site on Render for the frontend (connect to frontend folder). Build command: 'npm install && npm run build'. Publish directory: 'dist'.
4. After both deploy, set VITE_API_BASE in frontend settings to point to backend Render URL.
