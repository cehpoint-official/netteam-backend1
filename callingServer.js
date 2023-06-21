const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const uuid = require("uuid");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Store the active connections
const availableUsers = new Map();

// Serve the static files
app.use(express.static("public"));

app.use(cors({ origin: process.env.CLIENT_URL }));

// Handle socket.io connections
io.on("connection", (socket) => {
  const userId = uuid.v4();

  // Store the user's socket connection
  availableUsers.set(socket.id, userId);

  socket.emit("create", userId);
  console.log(`${socket.id} connected`);

  socket.on("startChat", () => {
    if (availableUsers.size < 2) {
      socket.emit("chatError", "Waiting for another user to join...");
      return;
    }
    const currentUserId = availableUsers.get(socket.id);

    // Remove the current user from the available users map
    availableUsers.delete(socket.id);

    // Select a random user from the available users map
    const [otherSocketId, otherUserId] = [...availableUsers.entries()][0];

    // Remove the selected user from the available users map
    availableUsers.delete(otherSocketId);
    // console.log(`this is other socket ${otherSocketId}`);

    // Create a chat room or session
    const roomId = uuid.v4();

    // Store the room ID in the sockets' custom properties for later use
    socket.data.roomId = roomId;
    const otherSocket = io.sockets.sockets.get(otherSocketId);
    otherSocket.data.roomId = roomId;
    // console.log(`this is other socket ${otherSocket.data.roomId}`);

    socket.join(roomId);
    otherSocket.join(roomId);

    // Notify the users about the match and the room ID
    socket.emit("chatMatched", {
      roomId: roomId,
      to: otherSocketId,
    });
  });

  // Handle offer signaling
  socket.on("call-user", (data) => {
    const { offer, targetSocketID } = JSON.parse(data);
    io.to(targetSocketID).emit("call-made", {
      sourceSocketID: socket.id,
      offer: offer,
    });
  });

  // Handle answer signaling
  socket.on("make-answer", (data) => {
    console.log("make-answer");
    const { answer, targetSocketID } = JSON.parse(data);
    io.to(targetSocketID).emit("answer-made", {
      sourceSocketID: socket.id,
      answer: answer,
    });
  });

  // Handle ICE candidate signaling
  socket.on("ice-candidate", (data) => {
    console.log("ice-candidate");
    const { targetSocketID,candidate } = JSON.parse(data);
    io.to(targetSocketID).emit("ice-candidate", {
      sourceSocketID: socket.id,
      candidate: candidate,
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    availableUsers.delete(socket.id);
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit("hangup");
      // Clean up the room data
      socket.leave(roomId);
      delete socket.data.roomId;
    }
    console.log(`${socket.id} disconnected`);
  });
});

// Start the server
server.listen(process.env.CALLING_PORT, () => {
  console.log(`Calling Server is running on port ${process.env.CALLING_PORT}`);
});
