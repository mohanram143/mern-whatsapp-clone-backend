const router = require("express").Router();
const Status = require("../models/Status");
const auth = require("../middleware/auth");
const upload = require("../middleware/upload");

function emitToUser(req, username, event, payload) {
  const emit = req.app.get("emitToUser");
  if (emit) emit(username, event, payload);
}

// ================= POST A NEW STATUS =================

router.post("/", auth, upload.single("media"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Media file required" });

    const mediaType = req.file.mimetype.startsWith("video") ? "video" : "image";

    const status = await Status.create({
      user: req.user.username,
      mediaUrl: `/uploads/${req.file.filename}`,
      mediaType,
      caption: req.body.caption || "",
    });

    res.status(201).json(status);
  } catch (error) {
    console.log("Post status error:", error.message);
    res.status(500).json({ message: "Failed to post status" });
  }
});

// ================= GET ALL ACTIVE STATUSES, GROUPED BY USER =================

router.get("/", auth, async (req, res) => {
  try {
    const me = req.user.username;

    const statuses = await Status.find({}).sort({ createdAt: 1 });

    const grouped = {};
    for (const s of statuses) {
      if (!grouped[s.user]) grouped[s.user] = [];
      grouped[s.user].push(s);
    }

    const result = Object.entries(grouped).map(([user, items]) => ({
      user,
      items,
      allViewed: items.every((s) => s.viewers.some((v) => v.username === me)),
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to load statuses" });
  }
});

// ================= MARK A STATUS AS VIEWED =================

router.post("/:id/view", auth, async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: "Status not found" });

    const username = req.user.username;

    if (status.user !== username && !status.viewers.some((v) => v.username === username)) {
      status.viewers.push({ username, viewedAt: new Date() });
      await status.save();

      // let the status owner see the viewer count update live
      emitToUser(req, status.user, "status_viewed", {
        statusId: status._id,
        viewer: username,
        viewersCount: status.viewers.length,
      });
    }

    res.json({ message: "Viewed" });
  } catch (error) {
    res.status(500).json({ message: "Failed to mark viewed" });
  }
});

// ================= GET VIEWERS OF MY STATUS =================

router.get("/:id/viewers", auth, async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: "Status not found" });

    if (status.user !== req.user.username) {
      return res.status(403).json({ message: "Not your status" });
    }

    res.json(status.viewers);
  } catch (error) {
    res.status(500).json({ message: "Failed to load viewers" });
  }
});

// ================= DELETE MY STATUS =================

router.delete("/:id", auth, async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: "Status not found" });

    if (status.user !== req.user.username) {
      return res.status(403).json({ message: "Not your status" });
    }

    await status.deleteOne();
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete status" });
  }
});

module.exports = router;
