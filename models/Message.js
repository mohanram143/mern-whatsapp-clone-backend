const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true },
    receiver: { type: String, required: true },

    text: { type: String, default: "" },

    file: {
      url: { type: String, default: "" },
      name: { type: String, default: "" },
      type: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },

    // ================= CRUD / STATUS FIELDS =================

    edited: { type: Boolean, default: false },

    deletedForEveryone: { type: Boolean, default: false },

    // usernames who have deleted this message "for me"
    deletedFor: { type: [String], default: [] },

    delivered: { type: Boolean, default: false },
    seen: { type: Boolean, default: false },
  },
  { timestamps: true },
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
