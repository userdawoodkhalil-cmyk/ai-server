const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const groq = new Groq({
  apiKey: "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"
});

// ===== DATA =====
let rooms = {};
let users = {};
let friends = {};

// ===== SOCKET =====
io.on("connection", (socket) => {

  socket.on("login", (name) => {
    users[socket.id] = { name, online: true };
    io.emit("onlineUsers", Object.values(users));
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("onlineUsers", Object.values(users));
  });

  socket.on("addFriend", (friendName) => {
    if (!friends[socket.id]) friends[socket.id] = [];
    friends[socket.id].push(friendName);
    socket.emit("friendList", friends[socket.id]);
  });

  socket.on("getFriends", () => {
    socket.emit("friendList", friends[socket.id] || []);
  });

  socket.on("createRoom", (name) => {
    const id = Math.random().toString(36).substr(2, 6);

    rooms[id] = {
      players: [{ id: socket.id, name, score: 0 }],
      question: null,
      correct: 0,
      difficulty: "easy"
    };

    socket.join(id);
    socket.emit("roomCreated", id);
  });

  socket.on("joinRoom", ({ roomId, name }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].players.push({ id: socket.id, name, score: 0 });
    socket.join(roomId);

    io.to(roomId).emit("playersUpdate", rooms[roomId].players);
  });

  socket.on("chat", ({ roomId, msg, name }) => {
    io.to(roomId).emit("chat", { msg, name });
  });

  socket.on("startQuiz", async (roomId) => {
    if (!rooms[roomId]) return;

    let difficulty = "easy";

    const avg =
      rooms[roomId].players.reduce((a, b) => a + b.score, 0) /
      rooms[roomId].players.length;

    if (avg > 100) difficulty = "hard";
    else if (avg > 50) difficulty = "medium";

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `Make 1 ${difficulty} MCQ. Format: Question\nA)\nB)\nC)\nD)\nAnswer: (0-3)`
        },
        { role: "user", content: "General knowledge" }
      ]
    });

    const text = completion.choices[0].message.content;
    const correct = parseInt(text.match(/Answer:\s*(\d)/)?.[1] || 0);

    rooms[roomId].question = text;
    rooms[roomId].correct = correct;

    io.to(roomId).emit("newQuestion", text);
  });

  socket.on("answer", ({ roomId, index }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (index === room.correct) {
      player.score += 10;
    }

    io.to(roomId).emit("playersUpdate", room.players);
  });

});

// ===== AI CHAT =====
app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "Teach clearly like a smart teacher." },
        { role: "user", content: message }
      ]
    });

    res.json({ reply: completion.choices[0].message.content });

  } catch {
    res.json({ reply: "❌ Error" });
  }
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});