const router = require("express").Router();
const Message = require("../models/Message");
const auth = require("../middleware/auth");
const upload = require("../middleware/upload");

// Emit a socket event to every online session of a user (multi-tab safe)
function emitToUser(req, username, event, payload) {
  const emit = req.app.get("emitToUser");
  if (emit) emit(username, event, payload);
}

// ================= GET CHAT HISTORY =================
// Also marks the other person's messages as delivered+seen, since
// fetching this chat means the user just opened/read it.

router.get("/:receiver", auth, async (req, res) => {
  try {
    const { receiver } = req.params;
    const sender = req.user.username;

    const messages = await Message.find({
      $or: [
        { sender, receiver },
        { sender: receiver, receiver: sender },
      ],
      deletedFor: { $ne: sender },
    }).sort({ createdAt: 1 });

    // mark incoming messages from `receiver` as seen
    const unseen = messages.filter(
      (m) => m.sender === receiver && m.receiver === sender && !m.seen,
    );

    if (unseen.length > 0) {
      await Message.updateMany(
        { _id: { $in: unseen.map((m) => m._id) } },
        { $set: { seen: true, delivered: true } },
      );

      unseen.forEach((m) => {
        m.seen = true;
        m.delivered = true;
      });

      // let the sender's open chat window flip their ticks to blue live
      emitToUser(req, receiver, "messages_seen", { chatWith: sender });
    }

    res.status(200).json(messages);
  } catch (error) {
    console.log("Get messages error:", error.message);
    res.status(500).json({ message: "Failed to get messages" });
  }
});

// ================= MARK MESSAGES AS SEEN (chat already open) =================
// The GET route above already marks things seen the moment you *open* a
// chat. This covers the case where the chat is already open and a new
// message arrives live over the socket — the tick should still go blue
// right away instead of waiting for the next full reload.

router.put("/seen/:withUser", auth, async (req, res) => {
  try {
    const { withUser } = req.params;
    const me = req.user.username;

    const result = await Message.updateMany(
      { sender: withUser, receiver: me, seen: false },
      { $set: { seen: true, delivered: true } },
    );

    if (result.modifiedCount > 0) {
      emitToUser(req, withUser, "messages_seen", { chatWith: me });
    }

    res.status(200).json({ updated: result.modifiedCount });
  } catch (error) {
    console.log("Mark seen error:", error.message);
    res.status(500).json({ message: "Failed to mark messages as seen" });
  }
});

// ================= SEND TEXT MESSAGE =================

router.post("/", auth, async (req, res) => {
  try {
    const { receiver, text } = req.body;

    if (!receiver || !text) {
      return res.status(400).json({ message: "Receiver and text required" });
    }

    const newMessage = await Message.create({
      sender: req.user.username,
      receiver,
      text,
    });

    res.status(201).json(newMessage);
  } catch (error) {
    console.log("Send message error:", error.message);
    res.status(500).json({ message: "Message sending failed" });
  }
});

// ================= UPLOAD FILE =================

router.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const { receiver } = req.body;

    if (!receiver || !req.file) {
      return res.status(400).json({ message: "Receiver and file required" });
    }

    const newMessage = await Message.create({
      sender: req.user.username,
      receiver,
      text: "",
      file: {
        url: `/uploads/${req.file.filename}`,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size,
      },
    });

    res.status(201).json(newMessage);
  } catch (error) {
    console.log("Upload error:", error.message);
    res.status(500).json({ message: "File upload failed" });
  }
});

// ================= UPDATE (EDIT) MESSAGE =================

router.put("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const username = req.user.username;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: "Text is required" });
    }

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ message: "Message not found" });

    if (message.sender !== username) {
      return res.status(403).json({ message: "You can only edit your own messages" });
    }
    if (message.deletedForEveryone) {
      return res.status(400).json({ message: "Cannot edit a deleted message" });
    }
    if (message.file?.url) {
      return res.status(400).json({ message: "Cannot edit a file message" });
    }

    message.text = text.trim();
    message.edited = true;
    await message.save();

    emitToUser(req, message.receiver, "message_edited", message);

    res.status(200).json(message);
  } catch (error) {
    console.log("Edit message error:", error.message);
    res.status(500).json({ message: "Failed to edit message" });
  }
});

// ================= CLEAR ENTIRE CHAT (for me) =================
// Registered before "/:id" so "clear" is never captured as an id.

router.delete("/clear/:withUser", auth, async (req, res) => {
  try {
    const { withUser } = req.params;
    const username = req.user.username;

    await Message.updateMany(
      {
        $or: [
          { sender: username, receiver: withUser },
          { sender: withUser, receiver: username },
        ],
      },
      { $addToSet: { deletedFor: username } },
    );

    res.status(200).json({ message: "Chat cleared" });
  } catch (error) {
    console.log("Clear chat error:", error.message);
    res.status(500).json({ message: "Failed to clear chat" });
  }
});

// ================= DELETE MESSAGE (for me / for everyone) =================

router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { mode } = req.body; // "me" | "everyone"
    const username = req.user.username;

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ message: "Message not found" });

    if (mode === "everyone") {
      if (message.sender !== username) {
        return res
          .status(403)
          .json({ message: "You can only delete your own messages for everyone" });
      }

      message.deletedForEveryone = true;
      message.text = "";
      message.file = { url: "", name: "", type: "", size: 0 };
      await message.save();

      emitToUser(req, message.receiver, "message_deleted", {
        id: message._id,
        mode: "everyone",
        chatWith: username,
      });

      return res.status(200).json({ message: "Deleted for everyone", data: message });
    }

    if (!message.deletedFor.includes(username)) {
      message.deletedFor.push(username);
      await message.save();
    }

    res.status(200).json({ message: "Deleted for me", data: { id: message._id } });
  } catch (error) {
    console.log("Delete message error:", error.message);
    res.status(500).json({ message: "Failed to delete message" });
  }
});

module.exports = router;
