const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },

    // profile
    avatar: { type: String, default: "" }, // relative /uploads path
    about: { type: String, default: "Hey there! I am using WhatsApp." },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
