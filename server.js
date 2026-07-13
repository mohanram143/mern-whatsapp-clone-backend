const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const CallLog = require("./models/CallLog");

dotenv.config();

const app = express();
const server = http.createServer(app);

// ================= MIDDLEWARE =================

// Allowed frontend origins. Add more via the FRONTEND_URL env var (comma
// separated) so you don't have to redeploy the backend every time the
// frontend URL changes.
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://mern-whatsapp-clone-frontend.vercel.app",
  ...(process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(",").map((u) => u.trim())
    : []),
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(express.json({ limit: "5mb" }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ================= ROUTES =================

app.use("/api/auth", require("./routes/auth"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/status", require("./routes/status"));
app.use("/api/calls", require("./routes/calls"));

app.get("/", (req, res) => {
  res.json({ status: "API running 🚀" });
});

// ================= SOCKET.IO =================

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  // Be forgiving of brief network hiccups (common on free hosting tiers)
  // so a slow ping isn't misread as the user going offline.
  pingInterval: 25000,
  pingTimeout: 60000,
});

// username -> Set of socket ids. A Set (not a single id) means a user with
// multiple tabs/devices open only goes "offline" once ALL of their sockets
// have disconnected.
const onlineUsers = new Map();

function addOnlineSocket(username, socketId) {
  if (!onlineUsers.has(username)) onlineUsers.set(username, new Set());
  onlineUsers.get(username).add(socketId);
}

function removeOnlineSocket(username, socketId) {
  const set = onlineUsers.get(username);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) onlineUsers.delete(username);
}

function getSocketIds(username) {
  return Array.from(onlineUsers.get(username) || []);
}

function emitToUser(username, event, payload) {
  getSocketIds(username).forEach((id) => io.to(id).emit(event, payload));
}

function broadcastOnlineUsers() {
  io.emit("online_users", Array.from(onlineUsers.keys()));
}

app.set("io", io);
app.set("onlineUsers", onlineUsers);
app.set("emitToUser", emitToUser);

// ---- in-call bookkeeping, so we can write a CallLog when a call ends ----
const pendingCalls = new Map(); // pairKey -> { caller, receiver, video, startedAt, answered, answeredAt }

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

async function finalizeCall(key, { status }) {
  const entry = pendingCalls.get(key);
  if (!entry) return;
  pendingCalls.delete(key);

  try {
    const duration = entry.answered
      ? Math.max(0, Math.round((Date.now() - entry.answeredAt) / 1000))
      : 0;

    await CallLog.create({
      caller: entry.caller,
      receiver: entry.receiver,
      video: entry.video,
      status: entry.answered ? "answered" : status,
      duration,
    });
  } catch (err) {
    console.log("CALL LOG SAVE ERROR", err.message);
  }
}

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  const username = socket.handshake.auth.username;

  if (username) {
    addOnlineSocket(username, socket.id);
    broadcastOnlineUsers();
    console.log(`${username} online (${getSocketIds(username).length} session(s))`);
  }

  // ================= MESSAGES =================

  socket.on("send_message", (message) => {
    emitToUser(message.receiver, "receive_message", message);
  });

  // ================= TYPING =================

  socket.on("typing", ({ to }) => {
    emitToUser(to, "typing", { from: username });
  });

  socket.on("stop_typing", ({ to }) => {
    emitToUser(to, "stop_typing", { from: username });
  });

  // ================= WEBRTC CALL SIGNALING =================
  // These relay signaling payloads between the two peers in a call, and
  // also keep a lightweight in-memory record so we can write a CallLog
  // once the call ends. No media ever passes through the server.

  socket.on("call_user", ({ to, video }) => {
    emitToUser(to, "incoming_call", { from: username, video });
  });

  socket.on("call_offer", ({ to, offer, video }) => {
    pendingCalls.set(pairKey(username, to), {
      caller: username,
      receiver: to,
      video: !!video,
      startedAt: Date.now(),
      answered: false,
      answeredAt: null,
    });

    emitToUser(to, "call_offer", { from: username, offer, video });
  });

  socket.on("call_answer", ({ to, answer }) => {
    const entry = pendingCalls.get(pairKey(username, to));
    if (entry) {
      entry.answered = true;
      entry.answeredAt = Date.now();
    }
    emitToUser(to, "call_answer", { from: username, answer });
  });

  socket.on("ice_candidate", ({ to, candidate }) => {
    emitToUser(to, "ice_candidate", { from: username, candidate });
  });

  socket.on("call_declined", ({ to } = {}) => {
    finalizeCall(pairKey(username, to), { status: "declined" });
    emitToUser(to, "end_call", { from: username });
  });

  socket.on("end_call", ({ to } = {}) => {
    finalizeCall(pairKey(username, to), { status: "missed" });
    emitToUser(to, "end_call", { from: username });
  });

  // ================= DISCONNECT =================

  socket.on("disconnect", () => {
    if (username) {
      removeOnlineSocket(username, socket.id);
      broadcastOnlineUsers();

      // if this user was mid-call, wrap it up so the other side isn't
      // left hanging and a log still gets written
      for (const [key, entry] of pendingCalls.entries()) {
        if (entry.caller === username || entry.receiver === username) {
          const other = entry.caller === username ? entry.receiver : entry.caller;
          finalizeCall(key, { status: "missed" });
          emitToUser(other, "end_call", { from: username });
        }
      }

      console.log(
        `Socket ${socket.id} for ${username} disconnected (${getSocketIds(username).length} session(s) left)`,
      );
    }
  });
});

// ================= DATABASE =================

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");

    server.listen(process.env.PORT || 5000, () => {
      console.log(`🚀 Server running on port ${process.env.PORT || 5000}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB Connection Error:", err);
  });
