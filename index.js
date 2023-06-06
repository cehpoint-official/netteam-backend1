const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Store the active connections
const activeConnections = {};

// Serve the static files
app.use(express.static("public"));

// Generate unique room ID
app.get("/", (req, res) => {
  const roomID = uuidv4();
  console.log(`Room created: ${roomID}`);
  res.json({ roomID });
});

// Handle socket.io connections
io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("msg", (msg) => {
    console.log(msg);
  });

  // Join a room
  socket.on("join", (roomID) => {
    socket.join(roomID);
    activeConnections[socket.id] = roomID;
  });

  // Handle offer signaling
  socket.on("offer", (data) => {
    const { targetSocketID, offer } = data;
    socket
      .to(targetSocketID)
      .emit("offer", { sourceSocketID: socket.id, offer });
  });

  // Handle answer signaling
  socket.on("answer", (data) => {
    const { targetSocketID, answer } = data;
    socket
      .to(targetSocketID)
      .emit("answer", { sourceSocketID: socket.id, answer });
  });

  // Handle ICE candidate signaling
  socket.on("ice-candidate", (data) => {
    const { targetSocketID, candidate } = data;
    socket
      .to(targetSocketID)
      .emit("ice-candidate", { sourceSocketID: socket.id, candidate });
  });

  // Handle hangup
  socket.on("hangup", () => {
    const roomID = activeConnections[socket.id];
    if (roomID) {
      socket.to(roomID).emit("hangup", { sourceSocketID: socket.id });
      socket.leave(roomID);
      delete activeConnections[socket.id];
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const roomID = activeConnections[socket.id];
    if (roomID) {
      socket.to(roomID).emit("hangup", { sourceSocketID: socket.id });
      socket.leave(roomID);
      delete activeConnections[socket.id];
    }
  });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
