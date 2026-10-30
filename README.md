B2C-Fun — Video Conferencing and Collaboration

A learning project built with React, Vite, Node.js, Express, Socket.IO, WebRTC, and SQLite.

Features
Create and join meetings using meeting IDs
Real-time participant updates
Audio and video communication using WebRTC
Screen sharing
Collaborative whiteboard
File sharing
User authentication backed by SQLite
Technology Stack
Frontend: React and Vite
Backend: Node.js and Express
Real-time communication: Socket.IO
Media streaming: WebRTC
Database: SQLite
Running Locally
1. Install backend dependencies

From the project root:

bash
npm install

2. Install frontend dependencies
bash
cd client
npm install

3. Start the backend

From the project root:

bash
npm run start:server

4. Start the frontend

From the client directory:

bash
npm run dev


Open the local URL printed by Vite, usually http://localhost:5173/.

Notes
Configure required environment variables locally before running the application.
Create or initialize the SQLite database using the project's database setup.
WebRTC connectivity between different networks may require additional ICE/TURN server configuration.
Local media previews do not by themselves guarantee that remote participants receive media.
Project Status

Built as a full-stack learning project. Authentication, file-sharing security, deployment, and multi-device compatibility should be tested before production use.

Sample Screenshots:

<img width="944" height="479" alt="HomePage" src="https://github.com/user-attachments/assets/ebbcd5ba-0163-425a-b3d2-18c06b6f2919" />
<img width="595" height="392" alt="Whiteboard" src="https://github.com/user-attachments/assets/339a22c9-87b5-4416-8388-f141b42b210e" />
<img width="602" height="404" alt="Meeting page" src="https://github.com/user-attachments/assets/32c91b17-9e3c-4813-8fbe-ebd08fa55b28" />
<img width="929" height="401" alt="Screen sharing" src="https://github.com/user-attachments/assets/79acc39e-dca0-4e80-86ce-68d6145315c5" />


