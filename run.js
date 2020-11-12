/**
 * 因网络原因和第三方接口防刷等技术限制导致部分图像处理失败
 */
const TinyPng = require("./tinypng.compress.img");

function getEntryPath() {
  let i = process.argv.findIndex((i) => i === "-p");
  if (i === -1 || !process.argv[i + 1])
    return err("获取命令执行入口目录：失败 node .\run.js -p C:\Users\DELL\Pictures\xxx");
  return process.argv[i + 1];
}

new TinyPng(getEntryPath(), true).compress();
