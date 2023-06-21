const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const mongoose = require("mongoose");
const multer = require("multer");
// const ffmpeg = require("ffmpeg");
const { exec } = require("child_process");
require("dotenv").config();
// const sharp = require("sharp");

// Set up MongoDB connection
mongoose.connect(
  process.env.MONGODB_URI,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

// Create a video schema and model
const videoSchema = new mongoose.Schema({
  title: String,
  description: String,
  videoUrl: String,
  thumbnailUrl: String,
  createdAt: { type: Date, default: Date.now },
});

const Video = mongoose.model("Video", videoSchema);

// Set up Express app and multer storage configuration
const app = express();
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

// Start the server
app.listen(process.env.REELS_PORT, () => {
  console.log(`Reels Server is running on port ${process.env.REELS_PORT}`);
});
