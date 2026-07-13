const router = require("express").Router();
const User = require("../models/User");
const Message = require("../models/Message");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const upload = require("../middleware/upload");

function publicUser(u) {
  return {
    username: u.username,
    avatar: u.avatar || "",
    about: u.about || "",
  };
}

// ================= REGISTER =================

router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and Password required" });
    }

    const exists = await User.findOne({ username });

    if (exists) {
      return res.status(400).json({ error: "Username already taken" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await User.create({ username, password: hashed });

    res.json({ message: "User created!" });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= LOGIN =================

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and Password required" });
    }

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(400).json({ error: "User not Found" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ error: "Wrong Password" });
    }

    const token = jwt.sign({ id: user._id, username }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.json({
      token,
      username,
      avatar: user.avatar || "",
      about: user.about || "",
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= MY PROFILE =================

router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(publicUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/me", auth, async (req, res) => {
  try {
    const { about } = req.body;

    const user = await User.findOneAndUpdate(
      { username: req.user.username },
      { $set: { about: typeof about === "string" ? about.slice(0, 200) : undefined } },
      { new: true },
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(publicUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// upload / change avatar
router.post("/me/avatar", auth, upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const user = await User.findOneAndUpdate(
      { username: req.user.username },
      { $set: { avatar: `/uploads/${req.file.filename}` } },
      { new: true },
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(publicUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= CONVERSATIONS (sidebar list) =================
// Only users you've actually exchanged messages with — NOT every
// registered user. This is what populates the chat list.

router.get("/conversations", auth, async (req, res) => {
  try {
    const me = req.user.username;

    const partners = await Message.aggregate([
      { $match: { $or: [{ sender: me }, { receiver: me }] } },
      {
        $project: {
          partner: { $cond: [{ $eq: ["$sender", me] }, "$receiver", "$sender"] },
        },
      },
      { $group: { _id: "$partner" } },
    ]);

    const usernames = partners.map((p) => p._id);

    const users = await User.find({ username: { $in: usernames } }).select(
      "username avatar about",
    );

    res.json(users.map(publicUser));
  } catch (err) {
    console.error("CONVERSATIONS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= SEARCH USERS (start a new chat) =================

router.get("/users/search", auth, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    if (!q) return res.json([]);

    const users = await User.find({
      username: { $regex: q, $options: "i", $ne: req.user.username },
    })
      .select("username avatar about")
      .limit(15);

    res.json(users.filter((u) => u.username !== req.user.username).map(publicUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= GET A SPECIFIC USER'S PUBLIC PROFILE =================

router.get("/users/:username", auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(publicUser(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
