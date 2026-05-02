const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===== GROQ =====
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// ===== DATA =====
let rooms = {};
let users = {};
let friends = {};

// ===== HOME ROUTE =====
app.get("/", (req, res) => {
  res.send("🚀 AI Server Running Successfully");
});

// ===== SOCKET =====
io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  // ===== LOGIN =====
  socket.on("login", (name) => {
    users[socket.id] = {
      name,
      online: true
    };

    io.emit("onlineUsers", Object.values(users));
  });

  // ===== DISCONNECT =====
  socket.on("disconnect", () => {
    delete users[socket.id];

    io.emit("onlineUsers", Object.values(users));

    console.log("User disconnected:", socket.id);
  });

  // ===== ADD FRIEND =====
  socket.on("addFriend", (friendName) => {
    if (!friends[socket.id]) {
      friends[socket.id] = [];
    }

    friends[socket.id].push(friendName);

    socket.emit("friendList", friends[socket.id]);
  });

  // ===== GET FRIENDS =====
  socket.on("getFriends", () => {
    socket.emit("friendList", friends[socket.id] || []);
  });

  // ===== CREATE ROOM =====
  socket.on("createRoom", (name) => {

    const id = Math.random()
      .toString(36)
      .substr(2, 6);

    rooms[id] = {
      players: [
        {
          id: socket.id,
          name,
          score: 0
        }
      ],
      question: null,
      correct: 0,
      difficulty: "easy"
    };

    socket.join(id);

    socket.emit("roomCreated", id);

    console.log("Room created:", id);
  });

  // ===== JOIN ROOM =====
  socket.on("joinRoom", ({ roomId, name }) => {

    if (!rooms[roomId]) {
      return;
    }

    rooms[roomId].players.push({
      id: socket.id,
      name,
      score: 0
    });

    socket.join(roomId);

    io.to(roomId).emit(
      "playersUpdate",
      rooms[roomId].players
    );

    console.log(name, "joined room", roomId);
  });

  // ===== CHAT =====
  socket.on("chat", ({ roomId, msg, name }) => {

    io.to(roomId).emit("chat", {
      msg,
      name
    });

  });

  // ===== START QUIZ =====
  socket.on("startQuiz", async (roomId) => {

    if (!rooms[roomId]) {
      return;
    }

    try {

      let difficulty = "easy";

      const avg =
        rooms[roomId].players.reduce(
          (a, b) => a + b.score,
          0
        ) / rooms[roomId].players.length;

      if (avg > 100) {
        difficulty = "hard";
      } else if (avg > 50) {
        difficulty = "medium";
      }

      const completion =
        await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content:
                Make 1 ${difficulty} MCQ question.\n\nFormat exactly:\nQuestion\nA)\nB)\nC)\nD)\nAnswer: (0-3)
            },
            {
              role: "user",
              content: "General knowledge"
            }
          ]
        });

      const text =
        completion.choices[0].message.content;

      const correct = parseInt(
        text.match(/Answer:\s*(\d)/)?.[1] || 0
      );

      rooms[roomId].question = text;
      rooms[roomId].correct = correct;

      io.to(roomId).emit(
        "newQuestion",
        text
      );

    } catch (error) {

      console.log(error);

      io.to(roomId).emit(
        "newQuestion",
        "❌ Failed to generate question"
      );
    }
  });

  // ===== ANSWER =====
  socket.on("answer", ({ roomId, index }) => {

    const room = rooms[roomId];

    if (!room) {
      return;
    }

    const player = room.players.find(
      p => p.id === socket.id
    );

    if (!player) {
      return;
    }

    if (index === room.correct) {
      player.score += 10;
    }

    io.to(roomId).emit(
      "playersUpdate",
      room.players
    );

  });

});

// ===== AI CHAT API =====
app.post("/ask", async (req, res) => {

  try {

    const { message } = req.body;

    if (!message) {
      return res.json({
        reply: "❌ No message provided"
      });
    }

    const completion =
      await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "Teach clearly like a smart teacher."
          },
          {
            role: "user",
            content: message
          }
        ]
      });

    res.json({
      reply:
        completion.choices[0].message.content
    });

  } catch (error) {

    console.log(error);

    res.json({
      reply: "❌ Error generating response"
    });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(🚀 Server running on port ${PORT});
});
