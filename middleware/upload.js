const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

function sanitizeFilename(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  const safeBase = base
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
  return `${safeBase || "file"}${safeExt}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },

  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${sanitizeFilename(file.originalname)}`);
  },
});

// No fileFilter: every file type (pdf, docx, zip, mp4, etc.) is accepted,
// just like real WhatsApp lets you send "documents" of any kind.
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

module.exports = upload;
