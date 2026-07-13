const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema(
  {
    caller: { type: String, required: true },
    receiver: { type: String, required: true },
    video: { type: Boolean, default: false },

    // answered | missed | declined
    status: { type: String, enum: ["answered", "missed", "declined"], required: true },

    // seconds, only meaningful when status === "answered"
    duration: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CallLog", callLogSchema);
