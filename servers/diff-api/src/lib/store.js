const { nanoid } = require('nanoid');

/* ---- 内存存储（演示用，生产建议替换为 Redis / DB） ---- */
const TTL = 1000 * 60 * 30; // 30 分钟过期
const map = new Map();

/** 写入一条带 TTL 的数据，返回 id */
function put(payload) {
  const id = nanoid(10);
  map.set(id, payload);
  const timer = setTimeout(() => map.delete(id), TTL);
  if (typeof timer.unref === 'function') timer.unref();
  return id;
}

/** 读取一条数据，不存在/已过期返回 undefined */
function get(id) {
  return map.get(id);
}

module.exports = { put, get, TTL };
