const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const uuid = require("uuid");
const mongoose = require("mongoose");
const multer = require("multer");
// const ffmpeg = require("ffmpeg");
const { exec } = require("child_process");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Set up MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Create a video schema and model
const videoSchema = new mongoose.Schema({
  title: String,
  description: String,
  videoUrl: String,
  thumbnailUrl: String,
  createdAt: { type: Date, default: Date.now },
});

const Video = mongoose.model("Video", videoSchema);

// Store the active connections
const availableUsers = new Map();

// Serve the static files
app.use(express.static("public"));
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

const upload = multer({ dest: "uploads/" });

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Upload endpoint to save videos
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    const { title, description } = req.body;
    const inputUrl = req.file.path;
    const thumbnailUrl = req.file.path + "-thumbnail.jpg";
    const videoUrl = req.file.path + "-720p.mp4";

    const generateThumbnail = `ffmpeg -i ${inputUrl} -vf "thumbnail,scale=320:240" -vframes 1 ${thumbnailUrl}`;
    exec(generateThumbnail, async (error, stdout, stderr) => {
      if (error) {
        console.error(`Error generating thumbnail: ${error}`);
        res.status(500).send("Error generating thumbnail");
        return;
      }
      console.log("Thumbnail generated successfully");

      const convert = `ffmpeg -i ${inputUrl} -vf "scale=-1:720" ${videoUrl}`;
      exec(convert, async (error, stdout, stderr) => {
        if (error) {
          console.error(`Error converting video: ${error}`);
          res.status(500).send("Error converting video");
          return;
        }
        console.log("Video converted successfully");

        // Create a new video instance
        const newVideo = new Video({
          title,
          description,
          videoUrl,
          thumbnailUrl,
        });

        // Save the video to the database
        await newVideo.save();

        res.status(201).json({ message: "Video uploaded successfully" });

        fs.unlink(inputUrl, (error) => {
          if (error) {
            console.error(`Error deleting file: ${error}`);
            return;
          }
          console.log("File deleted successfully");
        });
      });
    });
  } catch (error) {
    res.status(500).json({ message: "Error uploading video" });
  }
});

// Retrieve latest five videos and display as reels
app.get("/reels", async (req, res) => {
  try {
    // Retrieve the latest five videos from the database
    const videos = await Video.find().sort({ createdAt: -1 }).limit(2);

    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving reels" });
  }
});

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
    const { targetSocketID, candidate } = JSON.parse(data);
    io.to(targetSocketID).emit("ice-candidate", {
      sourceSocketID: socket.id,
      candidate: candidate,
    });
  });

  socket.on("ask-increment", () => {
    const roomId = socket.data.roomId;
    socket.to(roomId).emit("ask-increment");
  });

  socket.on("reply-increment", (data) => {
    const roomId = socket.data.roomId;
    socket.to(roomId).emit("reply-increment",data);
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
server.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
