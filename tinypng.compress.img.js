/**
 * 利用网上口碑较好的https://tinypng.com/使用的算法进行压缩
 * 
 * https://segmentfault.com/a/1190000015467084
 * 
 * 大体思路：
    递归获取本地文件夹里的文件
    过滤文件，格式必须是.jpg .png,大小小于5MB.(文件夹递归)
    每次只处理一个文件（可以绕过20个的数量限制）
    处理返回数据拿到远程优化图片地址
    取回图片更新本地图片
    纯node实现不依赖任何其他代码片段
 */
const fs = require("fs");
const { Console } = require("console");
const path = require("path");
const https = require("https");
const { promises } = require("dns");
const URL = require("url").URL;

// 通用浏览器标识,防止同一标识被服务器拦截
const USER_AGENT = [
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-us) AppleWebKit/534.50 (KHTML, like Gecko) Version/5.1 Safari/534.50",
  "Mozilla/5.0 (Windows; U; Windows NT 6.1; en-us) AppleWebKit/534.50 (KHTML, like Gecko) Version/5.1 Safari/534.50",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.6; rv,2.0.1) Gecko/20100101 Firefox/4.0.1",
  "Mozilla/5.0 (Windows NT 6.1; rv,2.0.1) Gecko/20100101 Firefox/4.0.1",
  "Opera/9.80 (Macintosh; Intel Mac OS X 10.6.8; U; en) Presto/2.8.131 Version/11.11",
  "Opera/9.80 (Windows NT 6.1; U; en) Presto/2.8.131 Version/11.11",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_7_0) AppleWebKit/535.11 (KHTML, like Gecko) Chrome/17.0.963.56 Safari/535.11",
  "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1; 360SE)",
  "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1; maxthon 2.0)",
  "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 5.1; Trident/4.0; SE 2.X MetaSr 1.0; SE 2.X MetaSr 1.0; .NET CLR 2.0.50727; SE 2.X MetaSr 1.0)",
];

// 定义log,支持输出日志到文件
class Log {
  options = {
    flags: "a", // append模式
    encoding: "utf8", // utf8编码
  };

  logger = {};

  /**
   * 初始化打印配置
   */
  constructor() {
    this.logger = new Console({
      stdout: fs.createWriteStream("./log.tinypng.stdout.log", this.options),
      stderr: fs.createWriteStream("./log.tinypng.stderr.log", this.options),
    });
  }

  /**
   * log级别
   * @param {*} message 输出信息
   */
  log(message) {
    if (message) {
      this.logger.log(message);
      console.log(message);
    }
  }

  /**
   * error级别
   * @param {*} message 输出err信息
   */
  error(message) {
    if (message) {
      this.logger.error(message);
      console.error(message);
    }
  }
}

// 实例化Log对象
const Tlog = new Log();

// 定义TinyPng对象
class TinyPng {

  // 配置信息: 后缀格式和最大文件大小受接收限制不允许调整
  config = {
    files: [],
    entryFolder: "./",
    deepLoop: false,
    extension: [".jpg", ".png"],
    max: 5200000, // 5MB == 5242848.754299136
    min: 100000, // 100KB
  };

  // 成功处理计数
  successCount = 0;
  // 失败处理计数
  failCount = 0;

  /**
   * TinyPng 构造器
   * @param {*} entry 入口文件
   * @param {*} deep 是否递归
   */
  constructor(entry, deep) {
    console.log(USER_AGENT[Math.floor(Math.random() * 10)]);
    if (entry != undefined) {
      this.config.entryFolder = entry;
    }
    if (deep != undefined) {
      this.config.deepLoop = deep;
    }
    // 过滤传入入口目录中符合调整的待处理文件
    this.fileFilter(this.config.entryFolder);
    Tlog.log(`本次执行脚本的配置：`);
    Object.keys(this.config).forEach((key) => {
      if (key !== "files") {
        Tlog.log(`配置${key}：${this.config[key]}`);
      }
    });
    Tlog.log(`等待处理文件的数量：${this.config.files.length}`);
  }

  /**
   * 执行压缩
   */
  compress() {
    Tlog.log("启动图像压缩,请稍等...");
    let asyncAll = [];
    if (this.config.files.length > 0) {
      this.config.files.forEach((img) => {
        asyncAll.push(this.fileUpload(img));
      });
      Promise.all(asyncAll)
        .then(() => {
          Tlog.log(
            `处理完毕: 成功: ${this.successCount}张, 成功率${
              this.successCount / this.config.files.length
            }`
          );
        })
        .catch((error) => {
          Tlog.error(error);
        });
    }
  }

  /**
   * 过滤待处理文件夹，得到待处理文件列表
   * @param {*} folder 待处理文件夹
   * @param {*} files 待处理文件列表
   */
  fileFilter(folder) {
    // 读取文件夹
    fs.readdirSync(folder).forEach((file) => {
      let fullFilePath = path.join(folder, file);
      // 读取文件信息
      let fileStat = fs.statSync(fullFilePath);
      // 过滤文件安全性/大小限制/后缀名
      if (
        fileStat.size <= this.config.max &&
        fileStat.size >= this.config.min &&
        fileStat.isFile() &&
        this.config.extension.includes(path.extname(file))
      ) {
        this.config.files.push(fullFilePath);
      }
      // 是都要深度递归处理文件夹
      else if (this.config.deepLoop && fileStat.isDirectory()) {
        this.fileFilter(fullFilePath);
      }
    });
  }

  /**
   * TinyPng 远程压缩 HTTPS 请求的配置生成方法
   */
  getAjaxOptions() {
    return {
      method: "POST",
      hostname: "tinypng.com",
      path: "/web/shrink",
      headers: {
        rejectUnauthorized: false,
        "X-Forwarded-For": Array(4)
          .fill(1)
          .map(() => parseInt(Math.random() * 254 + 1))
          .join("."),
        "Postman-Token": Date.now(),
        "Cache-Control": "no-cache",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT[Math.floor(Math.random() * 10)],
      },
    };
  }

  /**
   * TinyPng 远程压缩 HTTPS 请求
   * @param {string} img 待处理的文件
   * @success {
   *              "input": { "size": 887, "type": "image/png" },
   *              "output": { "size": 785, "type": "image/png", "width": 81, "height": 81, "ratio": 0.885, "url": "https://tinypng.com/web/output/7aztz90nq5p9545zch8gjzqg5ubdatd6" }
   *           }
   * @error  {"error": "Bad request", "message" : "Request is invalid"}
   */
  fileUpload(imgPath) {
    return new Promise((resolve) => {
      let req = https.request(this.getAjaxOptions(), (res) => {
        res.on("data", async (buf) => {
          let obj = JSON.parse(buf.toString());
          if (obj.error) {
            Tlog.log(`压缩失败！\n 当前文件：${imgPath} \n ${obj.message}`);
          } else {
            resolve(await this.fileUpdate(imgPath, obj));
          }
        });
      });
      req.write(fs.readFileSync(imgPath), "binary");
      req.on("error", (e) => {
        Tlog.log(`请求错误! \n 当前文件：${imgPath} \n, ${e}`);
      });
      req.end();
    }).catch((error) => {
      Tlog.log(error);
    });
  }

  // 该方法被循环调用,请求图片数据
  fileUpdate(entryImgPath, obj) {
    return new Promise((resolve) => {
      let options = new URL(obj.output.url);
      let req = https.request(options, (res) => {
        let body = "";
        res.setEncoding("binary");
        res.on("data", (data) => (body += data));
        res.on("end", () => {
          fs.writeFile(entryImgPath, body, "binary", (err) => {
            if (err) {
              Tlog.log(err);
            } else {
              this.successCount++;
              let message = `压缩成功 : 优化比例: ${(
                (1 - obj.output.ratio) *
                100
              ).toFixed(2)}% ，原始大小: ${(obj.input.size / 1024).toFixed(
                2
              )}KB ，压缩大小: ${(obj.output.size / 1024).toFixed(
                2
              )}KB ，文件：${entryImgPath}`;
              Tlog.log(message);
              resolve(message);
            }
          });
        });
      });
      req.on("error", (e) => {
        Tlog.log(e);
      });
      req.end();
    }).catch((error) => {
      Tlog.log(error);
    });
  }
}

module.exports = TinyPng;
