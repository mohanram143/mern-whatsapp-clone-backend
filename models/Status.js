const mongoose = require("mongoose");

const statusSchema = new mongoose.Schema(
  {
    user: { type: String, required: true },

    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ["image", "video"], required: true },
    caption: { type: String, default: "" },

    viewers: [
      {
        username: { type: String, required: true },
        viewedAt: { type: Date, default: Date.now },
      },
    ],

    // Status auto-expires 24h after creation (Mongo TTL index)
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
  },
  { timestamps: false },
);

module.exports = mongoose.model("Status", statusSchema);
