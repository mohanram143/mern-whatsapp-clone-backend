const router = require("express").Router();
const CallLog = require("../models/CallLog");
const auth = require("../middleware/auth");

// ================= GET MY CALL HISTORY =================

router.get("/", auth, async (req, res) => {
  try {
    const me = req.user.username;

    const calls = await CallLog.find({
      $or: [{ caller: me }, { receiver: me }],
    })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(
      calls.map((c) => ({
        _id: c._id,
        withUser: c.caller === me ? c.receiver : c.caller,
        direction: c.caller === me ? "outgoing" : "incoming",
        video: c.video,
        status: c.status,
        duration: c.duration,
        createdAt: c.createdAt,
      })),
    );
  } catch (error) {
    res.status(500).json({ message: "Failed to load call history" });
  }
});

module.exports = router;
