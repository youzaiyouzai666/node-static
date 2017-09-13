const http  = require('http');
const path  = require('path');
const fs    = require('fs');
const {URL} = require('url');
const os    = require('os');
const zlib  = require('zlib');
const c     = require('child_process');

const mime   = require('./mime');
const config = require('../config/default');
const proxy = require('./proxy');


const hasTrailingSlash = url => url[url.length - 1] === '/';

class StaticServer {
    constructor() {
        //将配置文件中参数直接转换为 object对象属性，与引入第三方config对象 优缺点
        this.port          = config.port || 0; //默认服务器端口（如为0，则随机打开一个端口）
        this.root          = config.root;  //静态资源地址
        this.indexPage     = config.indexPage;  //默认页
        this.isOpenBrowser = config.isOpenBrowser || false; //是否打开默认浏览器
        this.zipMatch      = config.zipMatch; //是否是压缩资源 （正则）
        this.proxyMatch    = config.proxyMatch; //是否是代理服务器地址 （正则）
        this.proxyTarget   = config.proxyTarget; //代理服务器地址及端口
        this.maxAge        = config.maxAge  //浏览器缓存时间
    }

    /**
     * 是否是代理请求
     * @param req
     * @returns {Array|{index: number, input: string}}
     */
    hasProxy(req) {
        return req.url.match(this.proxyMatch);
    }

    routeHandler(req, res) {
        const pathName = path.join(this.root, path.normalize(req.url));
        fs.stat(pathName, (err, stat) => {
            console.log(req.url);
            if (!err) {
                const requestedPath = req.url;
                if (hasTrailingSlash(requestedPath) && stat.isDirectory()) {
                    this.respondDirectory(pathName, req, res);
                } else if (stat.isDirectory()) {//如果 目录但不是以 ‘/’结尾，则跳301
                    this.respondRedirect(req, res);
                } else {
                    this.respond(pathName, req, res);
                }
            } else {
                console.info('文件未找到', err);
                StaticServer.respondNotFile(req, res);
            }
        })
    }

    proxyHandler(req, res) {
        proxy.web(req, res, this.proxyTarget)
    }

    respond(pathName, req, res) {
        fs.stat(pathName, (err, stat) => {
            if (err) return StaticServer.respondError(req, res);

            this.setFreshHeaders(stat, res);
            if (this.isFresh(req.headers, res.getHeaders())) {
                this.respondNotModified(res);
            } else {
                this.respondFile(pathName, req, res);
            }
        })
    }

    /**
     * 判读资源是否更新 304
     * @param reqHeaders
     * @param resHeaders
     * @returns {boolean}
     */
    isFresh(reqHeaders, resHeaders) {
        const lastModified = reqHeaders['if-modified-since'];
        if (!lastModified) {
            return false;
        }
        if (lastModified && lastModified == resHeaders['last-modified']) {
            return true;
        }
        return false;
    }

    respondNotModified(res) {
        res.statusCode = 304;
        res.end();
    }

    respondFile(pathName, req, res) {
        let readStream = fs.createReadStream(pathName);
        readStream.on('error', function (err) {//流错误处理
            console.trace();
            console.error("stack:", err.stack);
            console.error("The error raised was:", err);
        });
        res.setHeader('Content-Type', mime.lookup(pathName));
        if (this.hasCompress(pathName)) {
            readStream = StaticServer.compressHandler(readStream, req, res);
        }
        readStream.pipe(res);//管道
    }

    static respondNotFile(req, res) {
        res.writeHead(404, {
            'Content-Type': 'text/html'
        });
        res.end(`<h1>Not Found</h1><p>The requested URL ${req.url} was not found on this server.</p>`);
    };

    /**
     * 处理目录
     * @param pathName
     * @param req
     * @param res
     */
    respondDirectory(pathName, req, res) {
        const indexPagePath = path.join(pathName, this.indexPage);
        //判断是否存在默认页面
        if (fs.existsSync(indexPagePath)) {
            this.respond(indexPagePath, req, res);
        } else {
            fs.readdir(pathName, (err, files) => {
                if (err) {
                    return StaticServer.respondError(res, err);
                }
                const requestPath = new URL(pathName).pathname;
                let content       = `<h1>Index of ${requestPath}</h1>`;
                files.forEach(file => {
                    let itemLink = path.join(req.url, file);
                    const stat   = fs.statSync(path.join(pathName, file));
                    if (stat && stat.isDirectory()) {
                        itemLink = path.join(itemLink, '/');
                    }
                    content += `<p><a href='${itemLink}'>${file}</a></p>`;
                });
                res.writeHead(200, {
                    'Content-Type': 'text/html'
                });
                res.end(content);
            });
        }
    }

    static respondError(res, err) {
        res.writeHead(500);
        return res.end(err);
    }

    /**
     * 目录跳301
     * @param req
     * @param res
     */
    respondRedirect(req, res) {
        const location = req.url + '/';
        res.writeHead(301, {
            'Location'    : location,
            'Content-Type': 'text/html'
        });
        res.end(`Redirecting to <a href='${location}'>${location}</a>`);
    }

    /**
     * 处理压缩
     * @param readStream
     * @param req
     * @param res
     * @returns {*}
     */
    static compressHandler(readStream, req, res) {
        const acceptEncoding = req.headers['accept-encoding'];
        if (!acceptEncoding || !acceptEncoding.match(/\b(gzip|deflate)\b/)) {//\b匹配边界
            return readStream;
        } else if (acceptEncoding.match(/\bgzip\b/)) {
            res.setHeader('Content-Encoding', 'gzip');
            return readStream.pipe(zlib.createGzip());
        } else if (acceptEncoding.match(/\bdeflate\b/)) {
            res.setHeader('Content-Encoding', 'deflate');
            return readStream.pipe(zlib.createDeflate());
        }

    }

    /**
     * 是否压缩
     * @param pathName
     * @returns {Array|{index: number, input: string}}
     */
    hasCompress(pathName) {
        return path.extname(pathName).match(this.zipMatch);
    }

    /**
     * response 中添加 缓存头
     * @param stat
     * @param res
     */
    setFreshHeaders(stat, res) {
        const lastModified = stat.mtime.toUTCString();
        res.setHeader('Cache-Control', `public,max-age=${this.maxAge * 1000}`);
        res.setHeader('Expires', (new Date(Date.now() + this.maxAge * 1000)).toUTCString());

        res.setHeader('Last-Modified', lastModified);
    }

    /**
     * 得到本地ip
     * @returns {string|string}
     */
    static getIpAddress() {
        const ifaces = os.networkInterfaces();
        let ip = '';
        for (let dev in ifaces) {
            ifaces[dev].forEach(function (details) {
                if (ip === '' && details.family === 'IPv4' && !details.internal) {
                    ip = details.address;
                    return;
                }
            });
        }
        return ip || "127.0.0.1";
    }

    start() {
        const server = http.createServer((req, res) => {

            if (this.hasProxy(req)) {//是否 代理请求
                this.proxyHandler(req, res);
            } else {
                this.routeHandler(req, res);
            }
        });
        server.listen(this.port, err => {

            if (err) {
                console.error(err);
                console.info('Failed to start server');
            } else {
                this.port = server.address().port;
                console.info(`Server startd on port ${this.port}`);

                if (this.isOpenBrowser) {
                    try {
                        c.exec(`start http://${StaticServer.getIpAddress()}:` + this.port);
                    } catch (e) {
                        console.log('Browser open fail', e);
                    }
                }

            }
        })
    }
}

module.exports = new StaticServer();
