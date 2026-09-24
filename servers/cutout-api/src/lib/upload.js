const multer = require('multer');

/** multer 内存存储，限制 20MB：图片只经过内存，不落盘 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

module.exports = { upload };
